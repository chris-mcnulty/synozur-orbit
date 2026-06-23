/**
 * Email campaign sender — Task #97
 *
 * Sends a generatedEmail to either:
 *   - a managed recipient list (excluding suppressed addresses), or
 *   - a single test recipient ("send to me")
 *
 * For each recipient we:
 *   1. Generate a stable per-send unsubscribe token (HMAC over send-id+email).
 *   2. Inject a List-Unsubscribe header + visible unsubscribe link in HTML/text.
 *   3. Wrap outbound links via marketing-links so clicks are tracked.
 *   4. Send via SendGrid with open + click tracking enabled.
 *   5. Persist an `email_send_recipients` row keyed by token for webhook joins.
 *
 * Scheduled sends are persisted with status='queued' and scheduledAt; the
 * `tickEmailSendWorker()` function wakes up due rows and runs deliverEmailSend.
 *
 * Per-tenant rate cap is in-memory for v1.
 */

import { createHmac, createVerify, randomBytes } from "crypto";
import sgMail from "@sendgrid/mail";
import { db } from "../db";
import { and, eq, inArray, lte, isNotNull, notInArray } from "drizzle-orm";
import {
  generatedEmails,
  emailRecipientLists,
  emailRecipients,
  emailSends,
  emailSendRecipients,
  emailSuppressions,
  marketingAuditLog,
  prospects,
  type GeneratedEmail,
  type EmailSend,
} from "@shared/schema";
import { wrapOutboundLinksInText } from "./marketing-links-helpers";
import { checkFeatureAccessAsync } from "./plan-policy";
import { tenants } from "@shared/schema";
import { pullSubscriptionStatus } from "./hubspot-email-sync";
import { reconcileSuppression } from "./hubspot-email-sync-core";
import { resolveSendRecipientContacts } from "./hubspot-contact-resolver";
import { pushSentEventsForSend } from "./hubspot-timeline";

async function getTenantPlan(tenantDomain: string): Promise<string> {
  try {
    const [t] = await db.select({ plan: tenants.plan }).from(tenants)
      .where(eq(tenants.domain, tenantDomain));
    return t?.plan || "free";
  } catch {
    return "free";
  }
}

async function tenantHasDeliveryAccess(tenantDomain: string): Promise<boolean> {
  const plan = await getTenantPlan(tenantDomain);
  const gate = await checkFeatureAccessAsync(plan, "directEmailDelivery");
  return gate.allowed;
}

const MAX_RECIPIENTS_PER_SEND = Number(process.env.MARKETING_MAX_RECIPIENTS_PER_SEND || 5000);
const MAX_SENDS_PER_TENANT_PER_DAY = Number(process.env.MARKETING_MAX_SENDS_PER_DAY || 25_000);

const tenantSendCounters = new Map<string, { day: string; count: number }>();

function bumpTenantSendCount(tenantDomain: string, n: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const cur = tenantSendCounters.get(tenantDomain);
  if (!cur || cur.day !== today) {
    tenantSendCounters.set(tenantDomain, { day: today, count: n });
    return n <= MAX_SENDS_PER_TENANT_PER_DAY;
  }
  if (cur.count + n > MAX_SENDS_PER_TENANT_PER_DAY) return false;
  cur.count += n;
  return true;
}

function tokenSecret(): string {
  return process.env.SESSION_SECRET || process.env.INTEGRATION_ENCRYPTION_KEY || "orbit-dev-only-token-secret";
}

export function makeUnsubscribeToken(sendId: string, email: string): string {
  const nonce = randomBytes(8).toString("hex");
  const payload = `${sendId}.${email.toLowerCase()}.${nonce}`;
  const sig = createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): { sendId: string; email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64Payload, sig] = parts;
  let payload: string;
  try { payload = Buffer.from(b64Payload, "base64url").toString("utf8"); } catch { return null; }
  const expected = createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
  if (expected !== sig) return null;
  const segs = payload.split(".");
  if (segs.length < 3) return null;
  const [sendId, email] = segs;
  if (!sendId || !email) return null;
  return { sendId, email };
}

/**
 * Verify a SendGrid Event Webhook ECDSA signature.
 *
 * SendGrid signs `timestamp + rawBody` with an ECDSA P-256 key (configured
 * in the SendGrid dashboard) and sends the public key + signature in
 * X-Twilio-Email-Event-Webhook-{Signature,Timestamp}. We expect the public
 * key (PEM) in `SENDGRID_WEBHOOK_VERIFICATION_KEY`. When that env var is
 * missing we log a warning and accept the request — production deployments
 * should configure the key.
 */
export function verifySendGridWebhook(
  rawBody: string | Buffer,
  signatureBase64: string | undefined,
  timestamp: string | undefined,
): { ok: boolean; reason?: string } {
  const pubKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  // Fail closed: a missing verification key means the public webhook is
  // unconfigured. Accepting unsigned events would let attackers forge
  // bounce/spam/unsubscribe events and pollute the suppression list.
  if (!pubKey) {
    return { ok: false, reason: "no-key-configured" };
  }
  if (!signatureBase64 || !timestamp) {
    return { ok: false, reason: "missing-signature-headers" };
  }
  try {
    const payload = Buffer.concat([
      Buffer.from(timestamp, "utf8"),
      typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody,
    ]);
    // Accept either raw PEM or base64-encoded DER public key.
    const pemKey = pubKey.includes("BEGIN PUBLIC KEY")
      ? pubKey
      : `-----BEGIN PUBLIC KEY-----\n${pubKey}\n-----END PUBLIC KEY-----`;
    const verifier = createVerify("SHA256");
    verifier.update(payload);
    verifier.end();
    const signature = Buffer.from(signatureBase64, "base64");
    const ok = verifier.verify(pemKey, signature);
    return ok ? { ok: true } : { ok: false, reason: "signature-mismatch" };
  } catch (err: any) {
    return { ok: false, reason: `verify-exception: ${err?.message || err}` };
  }
}

async function getSendGridCreds(): Promise<{ apiKey: string; fromEmail: string }> {
  // Reuse the same connector lookup as email-service.
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;
  if (!xReplitToken || !hostname) {
    throw new Error("SendGrid connector not available in this environment");
  }
  const data = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } },
  ).then(r => r.json()).catch(() => ({}));
  const item = data?.items?.[0];
  if (!item?.settings?.api_key || !item?.settings?.from_email) {
    throw new Error("SendGrid is not connected — connect it in the Connections panel");
  }
  return { apiKey: item.settings.api_key, fromEmail: item.settings.from_email };
}

function injectFooter(html: string, unsubUrl: string, prefsUrl: string): string {
  const footer = `
    <div style="margin-top:24px;padding:16px;border-top:1px solid #ddd;font-size:12px;color:#666;text-align:center;">
      You're receiving this email from a campaign sent through Orbit.<br/>
      <a href="${unsubUrl}" style="color:#666;text-decoration:underline;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="${prefsUrl}" style="color:#666;text-decoration:underline;">Manage preferences</a>
    </div>
  `;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${html}${footer}`;
}

function injectTextFooter(text: string, unsubUrl: string, prefsUrl: string): string {
  return `${text}\n\n---\nUnsubscribe: ${unsubUrl}\nManage preferences: ${prefsUrl}`;
}

/**
 * Wrap outbound links inside HTML href attributes through the marketing
 * links redirector so clicks land at /r/<slug> and are tracked. Bare URLs
 * in the body (not in href) are also wrapped via the helper. Existing
 * /r/<slug> URLs are left alone to avoid double-wrapping.
 */
async function wrapEmailLinks(opts: {
  html: string;
  text: string;
  tenantDomain: string;
  marketId: string;
  campaignId: string | null;
  userId: string;
  baseUrl: string;
  emailLabel?: string | null;
}): Promise<{ html: string; text: string }> {
  const { html, text, tenantDomain, marketId, campaignId, userId, baseUrl, emailLabel } = opts;
  const url = new URL(baseUrl);
  const utm = {
    source: "orbit-email",
    medium: "email",
    campaign: emailLabel ? emailLabel.slice(0, 60) : (campaignId ?? null),
  };
  const ctx = {
    tenantDomain,
    marketId,
    campaignId: campaignId ?? null,
    userId,
    utm,
    source: "email-wrap" as const,
    redirectBase: { protocol: url.protocol.replace(":", ""), host: url.host },
    label: emailLabel ?? null,
  };

  // Wrap text body URLs.
  const wrappedText = await wrapOutboundLinksInText(text, ctx);

  // Wrap HTML href attributes by extracting them, replacing through the
  // helper, and substituting back. We only wrap http(s) links and skip
  // mailto:, tel:, fragments, and anything already pointing at /r/<slug>.
  const HREF_RE = /\bhref=("|')(https?:\/\/[^"'\s<>]+)("|')/gi;
  const hrefs: string[] = [];
  let match: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((match = HREF_RE.exec(html)) !== null) {
    if (!/\/r\/[a-z0-9]{6,}/i.test(match[2])) hrefs.push(match[2]);
  }
  const uniqueHrefs = Array.from(new Set(hrefs));
  let wrappedHtml = html;
  if (uniqueHrefs.length > 0) {
    // Run the helper on a synthetic text containing only the unique hrefs
    // so we get back the rewritten URLs.
    const synthetic = uniqueHrefs.join("\n");
    const result = await wrapOutboundLinksInText(synthetic, ctx);
    const rewrittenLines = result.text.split("\n");
    const replacements = new Map<string, string>();
    uniqueHrefs.forEach((orig, i) => {
      const rewritten = rewrittenLines[i];
      if (rewritten && rewritten !== orig) replacements.set(orig, rewritten);
    });
    if (replacements.size > 0) {
      wrappedHtml = wrappedHtml.replace(HREF_RE, (full, q1, url, q2) => {
        const r = replacements.get(url);
        return r ? `href=${q1}${r}${q2}` : full;
      });
    }
  }

  return { html: wrappedHtml, text: wrappedText.text };
}

export interface DispatchSendOptions {
  tenantDomain: string;
  marketId: string | null;
  email: GeneratedEmail;
  /** Either listId+null testRecipient, or testRecipient set for one-off "send to me". */
  listId?: string | null;
  testRecipient?: string | null;
  createdBy: string;
  baseUrl: string;
  /** When set in the future, queue the send for the worker rather than dispatching now. */
  scheduledAt?: Date | null;
  /** Per-send open-tracking pixel toggle. Defaults to true. */
  trackOpens?: boolean;
  /** Per-send click-tracking toggle. Defaults to true. */
  trackClicks?: boolean;
  /**
   * When true, recipients who are active outreach prospects (prospect status
   * NOT 'replied' or 'dormant') are suppressed before sending and recorded
   * with suppressionReason = 'active_prospect'. Persisted on the send row so
   * the worker honours the choice made at schedule time.
   */
  excludeActiveProspects?: boolean;
}

export interface SuppressedRecipient {
  email: string;
  reason: string;
}

export interface DispatchSendResult {
  send: EmailSend;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  /** Recipients filtered out before dispatch, with reason labels. */
  suppressed?: SuppressedRecipient[];
  errorMessage?: string;
  queued?: boolean;
}

/**
 * Top-level dispatch entry point. If `scheduledAt` is in the future the
 * send is persisted as `queued` and returned immediately; the
 * `tickEmailSendWorker()` will pick it up. Otherwise the send is delivered
 * inline (test-recipient sends always go inline).
 */
export async function dispatchEmailSend(opts: DispatchSendOptions): Promise<DispatchSendResult> {
  const { tenantDomain, marketId, email, listId, testRecipient, createdBy, baseUrl, scheduledAt } = opts;

  // All list sends are queued for the worker — this gives us per-tick rate
  // shaping, retry safety, and avoids holding the request open while we
  // loop over thousands of recipients. Test recipients (single-message
  // preview sends) deliver inline so reviewers see the result immediately.
  if (testRecipient) {
    return deliverEmailSend(opts);
  }
  if (!listId) {
    throw Object.assign(new Error("listId is required for list sends"), { status: 400 });
  }
  const queueAt = scheduledAt && scheduledAt.getTime() > Date.now() + 1000
    ? scheduledAt
    : new Date(); // immediate: worker picks it up on next tick
  const [send] = await db.insert(emailSends).values({
    tenantDomain,
    marketId,
    generatedEmailId: email.id,
    listId,
    testRecipient: null,
    status: "queued",
    scheduledAt: queueAt,
    trackOpens: opts.trackOpens !== false,
    trackClicks: opts.trackClicks !== false,
    excludeActiveProspects: opts.excludeActiveProspects === true,
    recipientCount: 0,
    sentCount: 0,
    failedCount: 0,
    bounceCount: 0,
    unsubscribeCount: 0,
    spamCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdBy,
  }).returning();
  await db.insert(marketingAuditLog).values({
    tenantDomain,
    marketId,
    userId: createdBy,
    action: scheduledAt ? "email_send_scheduled" : "email_send_queued",
    entityType: "email_send",
    entityId: send.id,
    status: "ok",
    message: scheduledAt ? `Scheduled for ${scheduledAt.toISOString()}` : "Queued for immediate delivery",
    details: { listId, scheduledAt: queueAt.toISOString(), generatedEmailId: email.id },
  });
  return { send, totalRecipients: 0, sentCount: 0, failedCount: 0, queued: true };
}

/**
 * The actual send pipeline: resolve recipients, persist rows, deliver via
 * SendGrid, update aggregates. Used both for inline sends from
 * dispatchEmailSend and for queued sends from tickEmailSendWorker.
 */
async function deliverEmailSend(opts: DispatchSendOptions, existingSendId?: string): Promise<DispatchSendResult> {
  const { tenantDomain, marketId, email, listId, testRecipient, createdBy, baseUrl } = opts;
  const trackOpens = opts.trackOpens !== false;
  const trackClicks = opts.trackClicks !== false;
  const suppressedFromSend: SuppressedRecipient[] = [];

  // Re-check plan gating at delivery time so a downgrade between scheduling
  // and execution is honored. Test sends (single-message previews) skip the
  // gate so reviewers can preview without a paid plan, but list sends are
  // always plan-gated.
  if (!testRecipient && !(await tenantHasDeliveryAccess(tenantDomain))) {
    if (existingSendId) {
      await db.update(emailSends).set({
        status: "failed",
        errorMessage: "Direct email delivery is not enabled on this tenant's plan.",
        completedAt: new Date(),
      }).where(eq(emailSends.id, existingSendId));
    }
    throw Object.assign(
      new Error("Direct email delivery is not enabled on this tenant's plan."),
      { status: 403 },
    );
  }

  // Build recipient set.
  const recipients: Array<{ email: string; name: string | null }> = [];
  if (testRecipient) {
    recipients.push({ email: testRecipient.trim().toLowerCase(), name: null });
  } else if (listId) {
    const rows = await db.select().from(emailRecipients)
      .where(and(
        eq(emailRecipients.listId, listId),
        eq(emailRecipients.tenantDomain, tenantDomain),
        eq(emailRecipients.status, "active"),
      ))
      .limit(MAX_RECIPIENTS_PER_SEND);
    for (const r of rows) {
      recipients.push({ email: r.email.trim().toLowerCase(), name: r.name ?? null });
    }
    // Filter against suppression list + HubSpot consent (HubSpot opt-out wins).
    if (recipients.length > 0) {
      const suppressed = await db.select({ email: emailSuppressions.email, reason: emailSuppressions.reason })
        .from(emailSuppressions)
        .where(and(
          eq(emailSuppressions.tenantDomain, tenantDomain),
          inArray(emailSuppressions.email, recipients.map(r => r.email)),
        ));
      const localSuppressed = new Map(suppressed.map(s => [s.email.toLowerCase(), s.reason]));
      // Pull HubSpot opt-out state and reconcile so contacts who unsubscribed
      // in HubSpot are excluded even if Orbit never recorded it. Best-effort:
      // no connection / missing scopes / failure ⇒ local suppression only.
      let hubspotOptedOut = new Set<string>();
      try {
        const consent = await pullSubscriptionStatus(tenantDomain, recipients.map(r => r.email));
        hubspotOptedOut = consent.optedOut;
      } catch { /* best-effort: fall back to local suppression */ }
      const supMap = reconcileSuppression({
        candidateEmails: recipients.map(r => r.email),
        locallySuppressed: localSuppressed,
        hubspotOptedOut,
      });
      for (let i = recipients.length - 1; i >= 0; i--) {
        const reason = supMap.get(recipients[i].email);
        if (reason) {
          suppressedFromSend.push({ email: recipients[i].email, reason });
          recipients.splice(i, 1);
        }
      }

      // Prospect suppression — applied AFTER standard suppression so we only
      // check emails that would otherwise be delivered. Active prospects have
      // a status that is NOT 'replied' (cadence concluded) or 'dormant'
      // (sequence exhausted / disqualified).
      if (opts.excludeActiveProspects && recipients.length > 0) {
        const candidateEmails = recipients.map(r => r.email);
        const activeProspectRows = await db
          .select({ email: prospects.email })
          .from(prospects)
          .where(and(
            eq(prospects.tenantDomain, tenantDomain),
            inArray(prospects.email, candidateEmails),
            notInArray(prospects.status, ["replied", "dormant"]),
          ));
        const activeProspectEmails = new Set(
          activeProspectRows.map(p => (p.email ?? "").trim().toLowerCase()).filter(Boolean),
        );
        if (activeProspectEmails.size > 0) {
          for (let i = recipients.length - 1; i >= 0; i--) {
            if (activeProspectEmails.has(recipients[i].email)) {
              suppressedFromSend.push({ email: recipients[i].email, reason: "active_prospect" });
              recipients.splice(i, 1);
            }
          }
        }
      }
    }
  }

  // ── Create / update the send row BEFORE writing suppressed rows ──────────
  // This must happen before the empty-recipient early-return so that we always
  // have a send.id to attach suppressed-prospect audit rows to, even when ALL
  // recipients have been excluded.
  if (recipients.length === 0 && suppressedFromSend.filter(s => s.reason === "active_prospect").length === 0) {
    // Genuinely empty: no deliverable recipients and no prospect suppression.
    // Update the existing row (worker path) and throw so the caller knows.
    if (existingSendId) {
      await db.update(emailSends).set({
        status: "failed",
        errorMessage: "No deliverable recipients (list empty or all suppressed).",
        completedAt: new Date(),
      }).where(eq(emailSends.id, existingSendId));
    }
    throw Object.assign(new Error("No deliverable recipients (list empty or all suppressed)."), { status: 400 });
  }
  if (recipients.length > 0 && !bumpTenantSendCount(tenantDomain, recipients.length)) {
    throw Object.assign(new Error(`Daily send cap of ${MAX_SENDS_PER_TENANT_PER_DAY} reached for this tenant.`), { status: 429 });
  }

  // Insert or update send row
  let send: EmailSend;
  if (existingSendId) {
    const [updated] = await db.update(emailSends).set({
      status: "sending",
      recipientCount: recipients.length,
      startedAt: new Date(),
    }).where(eq(emailSends.id, existingSendId)).returning();
    send = updated;
  } else {
    const [inserted] = await db.insert(emailSends).values({
      tenantDomain,
      marketId,
      generatedEmailId: email.id,
      listId: testRecipient ? null : (listId ?? null),
      testRecipient: testRecipient ?? null,
      status: "sending",
      trackOpens,
      trackClicks,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      bounceCount: 0,
      unsubscribeCount: 0,
      spamCount: 0,
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null,
      createdBy,
    }).returning();
    send = inserted;
  }

  // Write suppressed active-prospect rows now that we have send.id. This is
  // done before the deliverable-recipient check so that even when ALL
  // recipients were excluded as active prospects the audit trail is persisted.
  // The token is required because unsubscribeToken is NOT NULL UNIQUE; it is
  // never used for delivery.
  const activeProspectSuppressed = suppressedFromSend.filter(s => s.reason === "active_prospect");
  if (activeProspectSuppressed.length > 0) {
    await db.insert(emailSendRecipients).values(
      activeProspectSuppressed.map(s => ({
        sendId: send.id,
        tenantDomain,
        email: s.email,
        name: null,
        unsubscribeToken: makeUnsubscribeToken(send.id, `suppressed:${s.email}`),
        status: "suppressed" as const,
        suppressionReason: "active_prospect",
      })),
    );
  }

  // If all recipients were excluded as active prospects, complete the send
  // gracefully with 0 delivered (not "failed") so the operator sees an accurate
  // summary rather than a generic error.
  if (recipients.length === 0) {
    const msg = `All ${activeProspectSuppressed.length} recipient${activeProspectSuppressed.length !== 1 ? "s" : ""} excluded as active sales prospects.`;
    await db.update(emailSends).set({
      status: "completed",
      errorMessage: msg,
      sentCount: 0,
      completedAt: new Date(),
    }).where(eq(emailSends.id, send.id));
    return { sentCount: 0, failedCount: 0 };
  }

  // Pre-create per-recipient rows with unsubscribe tokens.
  const prepared = recipients.map(r => ({
    ...r,
    token: makeUnsubscribeToken(send.id, r.email),
  }));
  if (prepared.length > 0) {
    await db.insert(emailSendRecipients).values(prepared.map(p => ({
      sendId: send.id,
      tenantDomain,
      email: p.email,
      name: p.name,
      unsubscribeToken: p.token,
      status: "queued" as const,
    })));
  }

  // Wrap outbound links once per send (not per recipient) so we don't
  // multiply slug rows by N recipients.
  const baseHtml = email.htmlBody || "";
  const baseText = email.textBody || "";
  let wrappedHtml = baseHtml;
  let wrappedText = baseText;
  if (marketId) {
    try {
      const wrapped = await wrapEmailLinks({
        html: baseHtml,
        text: baseText,
        tenantDomain,
        marketId,
        campaignId: email.campaignId ?? null,
        userId: createdBy,
        baseUrl,
        emailLabel: email.label ?? null,
      });
      wrappedHtml = wrapped.html;
      wrappedText = wrapped.text;
    } catch (err: any) {
      console.warn("[Email Sender] Link wrapping failed; sending unwrapped:", err?.message || err);
    }
  }

  // Send loop. We use individual sends so per-recipient tokens / failures are
  // tracked. Batch-personalization could be a v2 optimization.
  const { apiKey, fromEmail } = await getSendGridCreds();
  sgMail.setApiKey(apiKey);

  let sentCount = 0;
  let failedCount = 0;

  for (const r of prepared) {
    const base = baseUrl.replace(/\/$/, "");
    const unsubUrl = `${base}/u/${r.token}`;
    const prefsUrl = `${base}/p/${r.token}`;
    const html = injectFooter(wrappedHtml, unsubUrl, prefsUrl);
    const text = wrappedText
      ? injectTextFooter(wrappedText, unsubUrl, prefsUrl)
      : `Unsubscribe: ${unsubUrl}\nManage preferences: ${prefsUrl}`;
    try {
      const [resp] = await sgMail.send({
        to: r.email,
        from: fromEmail,
        subject: email.subject,
        text,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>, <mailto:unsubscribe@${tenantDomain}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        customArgs: {
          orbit_send_id: send.id,
          orbit_unsub_token: r.token,
          orbit_tenant: tenantDomain,
        },
        trackingSettings: {
          // Per-send pixel + link tracking are configurable so privacy-first
          // sends can disable them without code changes.
          openTracking: { enable: trackOpens },
          clickTracking: { enable: trackClicks, enableText: false },
          subscriptionTracking: { enable: false },
        },
      });
      const sgMessageId = (resp?.headers as Record<string, string> | undefined)?.["x-message-id"] ?? null;
      await db.update(emailSendRecipients).set({
        status: "sent",
        sentAt: new Date(),
        sgMessageId,
      }).where(eq(emailSendRecipients.unsubscribeToken, r.token));
      sentCount += 1;
    } catch (err: any) {
      failedCount += 1;
      await db.update(emailSendRecipients).set({
        status: "failed",
        errorMessage: err?.message || String(err),
      }).where(eq(emailSendRecipients.unsubscribeToken, r.token));
    }
  }

  const finalStatus = failedCount === 0 ? "sent" : sentCount === 0 ? "failed" : "partial";
  const [updated] = await db.update(emailSends).set({
    status: finalStatus,
    sentCount,
    failedCount,
    completedAt: new Date(),
    errorMessage: failedCount > 0 && sentCount === 0 ? "All recipients failed" : null,
  }).where(eq(emailSends.id, send.id)).returning();

  // Only flip the parent generated_email to "sent" for an actual approved
  // list send that delivered to at least one recipient. Test sends and
  // total-failure sends must NOT mutate approval state — otherwise a
  // single test-send to a draft email would silently satisfy the later
  // approval gate (`allowedStatuses = ['approved','sent']`) and let an
  // unapproved draft be blasted to the full list.
  if (!testRecipient && sentCount > 0) {
    await db.update(generatedEmails).set({
      sentAt: new Date(),
      status: "sent",
      updatedAt: new Date(),
    }).where(eq(generatedEmails.id, email.id));
  }

  await db.insert(marketingAuditLog).values({
    tenantDomain,
    marketId,
    userId: createdBy,
    action: "email_send",
    entityType: "email_send",
    entityId: send.id,
    status: failedCount === 0 ? "ok" : (sentCount === 0 ? "error" : "warning"),
    message: `${sentCount}/${recipients.length} delivered`,
    details: { listId, testRecipient, generatedEmailId: email.id },
  });

  // HubSpot Phase 1: resolve recipients to CRM contacts so later phases can
  // attach engagement to the right timeline. List sends only (test previews
  // are excluded), best-effort, and after delivery so it never affects the
  // send result.
  if (!testRecipient && sentCount > 0) {
    try {
      const r = await resolveSendRecipientContacts({ tenantDomain, sendId: send.id });
      if (r.ran) {
        await db.insert(marketingAuditLog).values({
          tenantDomain,
          marketId,
          userId: createdBy,
          action: "hubspot_contact_resolve",
          entityType: "email_send",
          entityId: send.id,
          status: r.errors > 0 ? "warning" : "ok",
          message: `${r.resolved} resolved, ${r.created} created, ${r.skipped} unmatched`,
          details: { resolved: r.resolved, created: r.created, skipped: r.skipped, errors: r.errors },
        });
        // Phase 2: mirror an `email_sent` event to each resolved contact's
        // HubSpot timeline. No-ops unless a timeline template is configured.
        if (r.resolved > 0) {
          const t = await pushSentEventsForSend({
            tenantDomain,
            sendId: send.id,
            subject: email.subject,
            campaign: email.label ?? email.campaignId ?? null,
          });
          if (t.pushed > 0 || t.errors > 0) {
            await db.insert(marketingAuditLog).values({
              tenantDomain,
              marketId,
              userId: createdBy,
              action: "hubspot_timeline_push",
              entityType: "email_send",
              entityId: send.id,
              status: t.errors > 0 ? "warning" : "ok",
              message: `email_sent → ${t.pushed} timelines (${t.errors} errors)`,
              details: { event: "email_sent", ...t },
            });
          }
        }
      }
    } catch { /* best-effort: sync never blocks the send result */ }
  }

  return {
    send: updated,
    totalRecipients: recipients.length,
    sentCount,
    failedCount,
    suppressed: suppressedFromSend.length > 0 ? suppressedFromSend : undefined,
    errorMessage: finalStatus === "failed" ? "All recipients failed" : undefined,
  };
}

/**
 * Compute a deliverability preview for a list+tenant pair without actually
 * sending. The send dialog uses this to surface "X deliverable / Y suppressed"
 * before the user confirms, with reason labels for each suppressed address.
 */
export async function previewListDeliverability(opts: {
  tenantDomain: string;
  listId: string;
}): Promise<{ deliverable: number; suppressed: SuppressedRecipient[] }> {
  const { tenantDomain, listId } = opts;
  const rows = await db.select({ email: emailRecipients.email })
    .from(emailRecipients)
    .where(and(
      eq(emailRecipients.listId, listId),
      eq(emailRecipients.tenantDomain, tenantDomain),
      eq(emailRecipients.status, "active"),
    ))
    .limit(MAX_RECIPIENTS_PER_SEND);
  if (rows.length === 0) return { deliverable: 0, suppressed: [] };
  const normalized = rows.map(r => r.email.trim().toLowerCase());
  const sup = await db.select({ email: emailSuppressions.email, reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(and(
      eq(emailSuppressions.tenantDomain, tenantDomain),
      inArray(emailSuppressions.email, normalized),
    ));
  const supMap = new Map(sup.map(s => [s.email.toLowerCase(), s.reason]));
  const suppressedOut: SuppressedRecipient[] = [];
  let deliverable = 0;
  for (const e of normalized) {
    const reason = supMap.get(e);
    if (reason) suppressedOut.push({ email: e, reason });
    else deliverable += 1;
  }
  return { deliverable, suppressed: suppressedOut };
}

const EMAIL_WORKER_BATCH = 5;
let emailWorkerInFlight = false;

/**
 * Process queued email_sends whose scheduledAt has elapsed. Called from
 * scheduled-jobs on a short interval; per-tick batch is bounded.
 */
export async function tickEmailSendWorker(opts: { baseUrl: string }): Promise<{ processed: number; sent: number; failed: number }> {
  if (emailWorkerInFlight) return { processed: 0, sent: 0, failed: 0 };
  emailWorkerInFlight = true;
  let processed = 0;
  let sent = 0;
  let failed = 0;
  try {
    const now = new Date();
    const due = await db.select({ send: emailSends, email: generatedEmails })
      .from(emailSends)
      .innerJoin(generatedEmails, eq(generatedEmails.id, emailSends.generatedEmailId))
      .where(and(
        eq(emailSends.status, "queued"),
        isNotNull(emailSends.scheduledAt),
        lte(emailSends.scheduledAt, now),
      ))
      .limit(EMAIL_WORKER_BATCH);
    for (const row of due) {
      processed += 1;
      try {
        const result = await deliverEmailSend({
          tenantDomain: row.send.tenantDomain,
          marketId: row.send.marketId ?? null,
          email: row.email,
          listId: row.send.listId ?? null,
          testRecipient: null,
          createdBy: row.send.createdBy,
          baseUrl: opts.baseUrl,
          // Preserve the per-send tracking choice that was captured when the
          // send was originally queued; otherwise the worker would silently
          // re-enable tracking on a privacy-disabled scheduled send.
          trackOpens: row.send.trackOpens,
          trackClicks: row.send.trackClicks,
          // Preserve the prospect-suppression choice captured at schedule time.
          excludeActiveProspects: row.send.excludeActiveProspects,
        }, row.send.id);
        sent += result.sentCount;
        failed += result.failedCount;
      } catch (err: any) {
        failed += 1;
        await db.update(emailSends).set({
          status: "failed",
          errorMessage: err?.message || String(err),
          completedAt: new Date(),
        }).where(eq(emailSends.id, row.send.id));
      }
    }
  } finally {
    emailWorkerInFlight = false;
  }
  return { processed, sent, failed };
}
