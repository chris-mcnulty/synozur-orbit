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
import { and, eq, inArray, lte, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  generatedEmails,
  emailCampaignVariants,
  emailRecipientLists,
  emailRecipients,
  emailSends,
  emailSendRecipients,
  emailSuppressions,
  emailSenderIdentities,
  emailSubscriptionTypes,
  emailSubscriptionPreferences,
  marketingAuditLog,
  marketingContacts,
  prospects,
  type GeneratedEmail,
  type EmailSend,
} from "@shared/schema";
import { resolveTokens, resolveTokensForEmail } from "./email-ab-test";
import { appendSectionsToBody, reRenderSectionsHtml } from "./email-sections-renderer";
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

/**
 * Resolve the name of the first non-transactional Orbit subscription type
 * from a list of type IDs. Used to pass the email category to the HubSpot
 * consent pull so per-category subscription mappings are honoured.
 * Returns undefined when the list is empty or all types are transactional.
 */
async function resolveFirstSubTypeName(tenantDomain: string, typeIds: string[]): Promise<string | undefined> {
  if (!typeIds.length) return undefined;
  const [row] = await db.select({ name: emailSubscriptionTypes.name })
    .from(emailSubscriptionTypes)
    .where(and(
      eq(emailSubscriptionTypes.tenantDomain, tenantDomain),
      inArray(emailSubscriptionTypes.id, typeIds),
      eq(emailSubscriptionTypes.isTransactional, false),
    ))
    .limit(1);
  return row?.name;
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

function injectFooter(html: string, unsubUrl: string, prefsUrl: string, mailingAddress?: string | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // CAN-SPAM requires the sender's physical mailing address in every
  // commercial email. Rendered on its own line above the unsubscribe links.
  const addressLine = mailingAddress?.trim()
    ? `${esc(mailingAddress.trim()).replace(/\n/g, ", ")}<br/>`
    : "";
  const footer = `
    <div style="margin-top:24px;padding:16px;border-top:1px solid #ddd;font-size:12px;color:#555555;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      ${addressLine}
      You're receiving this email from a campaign sent through Orbit.<br/>
      <a href="${unsubUrl}" style="color:#555555;text-decoration:underline;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="${prefsUrl}" style="color:#555555;text-decoration:underline;">Manage preferences</a>
    </div>
  `;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${html}${footer}`;
}

/**
 * Wrap a raw HTML table fragment in a full <!DOCTYPE html> document with a
 * viewport meta tag and responsive @media overrides.
 *
 * The AI email generator produces a bare table fragment (no <html>/<head>)
 * so HubSpot can embed it without conflicts. But when WE send via SendGrid,
 * we need a full document so mobile email clients know the intended width and
 * can reflow the layout. This wrapper is applied only at send time; the stored
 * htmlBody fragment is left unchanged.
 *
 * Key rules applied on screens ≤ 620 px:
 *  - Outer 560px tables become 100% wide (reflow instead of scroll/shrink).
 *  - All images scale to 100% width with auto height.
 *  - Content cells drop from 24px/32px padding to 16px so body text fills
 *    the screen edge-to-edge.
 *  - Heading font sizes step down one tier to stay readable.
 */
/**
 * Bump inline font sizes below minPx (default 16) up to minPx so body copy is
 * readable on mobile without pinch-zoom. Applies to AI-generated fragments
 * whose inline styles otherwise defeat the responsive wrapper's media queries
 * (and the HubSpot paste path, which has no media queries at all).
 *
 * Previously the guard was `n < 15`, which let 15 px slip through against a
 * stated 16 px floor. Fixed to `n < minPx` so the threshold and the
 * replacement value are always consistent.
 */
export function enforceMinimumFontSize(html: string, minPx = 16): string {
  return html.replace(/font-size:\s*(\d+)px/gi, (m, size) => {
    const n = parseInt(size, 10);
    return n > 0 && n < minPx ? `font-size:${minPx}px` : m;
  });
}

export function wrapResponsiveDocument(html: string): string {
  // Already a full document — just ensure a viewport meta tag is present.
  if (/<!DOCTYPE/i.test(html)) {
    if (!/<meta[^>]*viewport/i.test(html)) {
      return html.replace(
        /(<head[^>]*>)/i,
        '$1\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      );
    }
    return html;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!-- Opt out of dark-mode auto-inversion — this email is designed for light backgrounds -->
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title></title>
  <style type="text/css">
    :root { color-scheme: light; supported-color-schemes: light; }
    body { margin:0; padding:0; background:#ffffff; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    img { border:0; outline:none; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    /* NOTE: no dark-mode override block here on purpose. A previous
       "background-color:inherit !important" rule wiped td bgcolor on CTA
       buttons and stat cards in dark-mode clients, turning buttons into
       plain text. The color-scheme meta above is the supported opt-out. */
    @media only screen and (max-width:620px) {
      /* Outer email wrapper — switch from fixed 560px to full width */
      table[width="560"],
      table[style*="max-width:560px"] {
        width:100% !important;
        max-width:100% !important;
      }
      /* Stack multi-column table cells vertically.
         Percentage-width <td>s are the tell-tale sign of a 2-3 column layout
         (image+text side-by-side, stat cards, etc.). Make each one take the
         full row width so they reflow top-to-bottom on narrow screens. */
      td[width="50%"], td[width="33%"], td[width="25%"],
      td[style*="width:50%"], td[style*="width:33%"], td[style*="width:25%"] {
        display:block !important;
        width:100% !important;
        max-width:100% !important;
      }
      /* Images fill the column after it is stacked */
      img { max-width:100% !important; height:auto !important; width:100% !important; }
      /* Reduce side padding so body text fills narrow screens */
      td[style*="padding:24px 32px"],
      td[style*="padding: 24px 32px"] { padding:16px !important; }
      td[style*="padding:32px"],
      td[style*="padding: 32px"] { padding:16px !important; }
      /* Step heading font sizes down one tier */
      h1, td h1, td[style*="font-size:26px"], td[style*="font-size: 26px"] { font-size:22px !important; line-height:1.3 !important; }
      h2, td h2 { font-size:18px !important; }
      /* CTA button tables go full-width on mobile */
      table[style*="margin:24px auto"] { width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
${html}
</body>
</html>`;
}

function injectTextFooter(text: string, unsubUrl: string, prefsUrl: string, mailingAddress?: string | null): string {
  const addressLine = mailingAddress?.trim() ? `${mailingAddress.trim().replace(/\n/g, ", ")}\n` : "";
  return `${text}\n\n---\n${addressLine}Unsubscribe: ${unsubUrl}\nManage preferences: ${prefsUrl}`;
}

/**
 * Make CTA buttons robust across clients: the AI generator styles buttons as
 * `<td bgcolor="#xxxxxx"><a style="...">` — but some clients (notably ones
 * that rewrite or drop td bgcolor, and dark-mode transforms) lose the cell
 * background, leaving white text on a white/dark body ("invisible buttons").
 * Copy the cell's bgcolor onto the anchor itself as an inline
 * background-color so the button survives even if the cell styling is lost.
 */
export function hardenCtaButtons(html: string): string {
  return html.replace(
    /(<td[^>]*bgcolor=("|')(#[0-9a-fA-F]{3,8})\2[^>]*>\s*)<a\b([^>]*)>/gi,
    (full, tdPart, _q, color, anchorAttrs) => {
      if (/background(-color)?\s*:/i.test(anchorAttrs)) return full;
      let newAttrs: string;
      const styleMatch = anchorAttrs.match(/style=("|')([^"']*)\1/i);
      if (styleMatch) {
        const augmented = `${styleMatch[2].replace(/;?\s*$/, "")};background-color:${color};border-radius:6px`;
        newAttrs = anchorAttrs.replace(styleMatch[0], `style=${styleMatch[1]}${augmented}${styleMatch[1]}`);
      } else {
        newAttrs = `${anchorAttrs} style="background-color:${color};border-radius:6px"`;
      }
      return `${tdPart}<a${newAttrs}>`;
    },
  );
}

/**
 * Make every <img src> in the email fetchable by external recipients:
 *  - `/objects/...` (private, auth-gated) → copy the bytes into the public
 *    bucket under a deterministic `email-images/<original-id>` path (idempotent
 *    across resends) and rewrite to an absolute `/public-objects/...` URL.
 *  - `/public-objects/...` and other relative paths → prefix with baseUrl.
 * Failures are per-image and non-fatal (the src is left as-is, logged).
 */
const MAX_PUBLISHED_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Is this /objects/... path referenced by an asset the tenant owns? Guards
 * the public-publication step below so an arbitrary private object path
 * pasted into an email body cannot be leaked through /public-objects/.
 */
async function isTenantOwnedObjectPath(src: string, tenantDomain: string): Promise<boolean> {
  const { contentAssets, brandAssets } = await import("@shared/schema");
  const { or, like } = await import("drizzle-orm");
  const pattern = `%${src}%`;
  const [ca] = await db.select({ id: contentAssets.id }).from(contentAssets)
    .where(and(
      eq(contentAssets.tenantDomain, tenantDomain),
      or(like(contentAssets.fileUrl, pattern), like(contentAssets.leadImageUrl, pattern), like(contentAssets.url, pattern)),
    )).limit(1);
  if (ca) return true;
  const [ba] = await db.select({ id: brandAssets.id }).from(brandAssets)
    .where(and(
      eq(brandAssets.tenantDomain, tenantDomain),
      or(like(brandAssets.fileUrl, pattern), like(brandAssets.url, pattern)),
    )).limit(1);
  return !!ba;
}

export async function prepareEmailImages(html: string, baseUrl: string, tenantDomain?: string): Promise<string> {
  if (!html) return html;
  const base = baseUrl.replace(/\/$/, "");
  const SRC_RE = /(<img\b[^>]*\bsrc\s*=\s*)("|')([^"']+)\2/gi;
  const srcs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SRC_RE.exec(html)) !== null) {
    const src = m[3];
    if (src.startsWith("/")) srcs.add(src);
  }
  if (srcs.size === 0) return html;

  const { ObjectStorageService, objectStorageClient } = await import(
    "../replit_integrations/object_storage/objectStorage"
  );
  const svc = new ObjectStorageService();
  let out = html;
  for (const src of Array.from(srcs)) {
    try {
      let publicPath = src;
      if (src.startsWith("/objects/")) {
        // Security gate: only publish objects the tenant demonstrably owns
        // (referenced by one of its content/brand assets), and only images
        // under a sane size cap.
        if (!tenantDomain || !(await isTenantOwnedObjectPath(src, tenantDomain))) {
          console.warn(`[Email Sender] Skipping private image not owned by tenant: ${src}`);
          continue;
        }
        // Deterministic public name keyed on the private object id so repeat
        // sends reuse the same public copy.
        const objectId = src.replace(/^\/objects\//, "").replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\//g, "_");
        const publicName = `email-images/${objectId}`;
        const existing = await svc.searchPublicObject(publicName);
        if (!existing) {
          const file = await svc.getObjectEntityFile(src);
          const [meta] = await file.getMetadata();
          const contentType = String(meta.contentType || "");
          const size = Number(meta.size || 0);
          if (!contentType.startsWith("image/")) {
            console.warn(`[Email Sender] Skipping non-image object ${src} (${contentType})`);
            continue;
          }
          if (size > MAX_PUBLISHED_IMAGE_BYTES) {
            console.warn(`[Email Sender] Skipping oversized image ${src} (${size} bytes)`);
            continue;
          }
          const [buf] = await file.download();
          const publicPaths = svc.getPublicObjectSearchPaths();
          const parts = publicPaths[0].replace(/^\//, "").split("/");
          const bucketName = parts[0];
          const prefix = parts.slice(1).join("/").replace(/\/$/, "");
          await objectStorageClient.bucket(bucketName).file(`${prefix}/${publicName}`).save(buf, {
            metadata: { contentType: meta.contentType || "image/png" },
          });
        }
        publicPath = `/public-objects/${publicName}`;
      }
      const absolute = `${base}${publicPath}`;
      out = out.split(`src="${src}"`).join(`src="${absolute}"`).split(`src='${src}'`).join(`src='${absolute}'`);
    } catch (err: any) {
      console.warn(`[Email Sender] Could not prepare image ${src}:`, err?.message || err);
    }
  }
  return out;
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
  /**
   * When set, recipients are resolved from a marketing segment's materialised
   * membership table rather than a static email_recipients list.
   * Either listId or segmentId must be provided for non-test sends.
   */

  segmentId?: string | null;

  testRecipient?: string | null;

  /**
   * For workflow single-contact sends: provide recipients directly.
   * Unlike testRecipient, these go through ALL production suppression checks
   * (emailOptOut, emailSuppressions, HubSpot consent, plan access).
   * Cannot be combined with testRecipient.
   */
  workflowRecipients?: Array<{ email: string; name: string | null }>;

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
  /**
   * ID of the email_sender_identities row to use as the `from` address.
   * When null/undefined the SendGrid connector's configured from_email is used.
   */

  senderIdentityId?: string | null;
  /**
   * Subscription type IDs this send belongs to. At delivery time, recipients
   * who have opted out of any non-transactional type in this list are filtered.
   */

  subscriptionTypeIds?: string[];

  abVariantLabel?: string | null;
  /**
   * When true this send is the A/B holdback cohort (position ≥ 2×split).
   * Set by the worker when replaying a holdback send row after winner declaration.
   */

  isAbHoldback?: boolean;
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

/** Shared values used when inserting a new email_sends row. */
function baseSendValues(opts: DispatchSendOptions & { listId: string | null | undefined; queueAt: Date }) {
  return {
    tenantDomain: opts.tenantDomain,
    marketId: opts.marketId,
    generatedEmailId: opts.email.id,
    listId: opts.listId ?? null,
    testRecipient: null as null,
    status: "queued" as const,
    scheduledAt: opts.queueAt,
    trackOpens: opts.trackOpens !== false,
    trackClicks: opts.trackClicks !== false,
    excludeActiveProspects: opts.excludeActiveProspects === true,
    senderIdentityId: opts.senderIdentityId ?? null,
    subscriptionTypeIds: opts.subscriptionTypeIds ?? [],
    recipientCount: 0,
    sentCount: 0,
    failedCount: 0,
    bounceCount: 0,
    unsubscribeCount: 0,
    spamCount: 0,
    errorMessage: null as null,
    startedAt: null as null,
    completedAt: null as null,
    createdBy: opts.createdBy,
  };
}
/**
 * Top-level dispatch entry point. If `scheduledAt` is in the future the
 * send is persisted as `queued` and returned immediately; the
 * `tickEmailSendWorker()` will pick it up. Otherwise the send is delivered
 * inline (test-recipient sends always go inline).
 *
 * When the email has A/B testing enabled and a B variant exists, three send
 * rows are created: one for each cohort (A, B) and one holdback. The A/B
 * worker will flip the holdback row to "queued" after the evaluation window.
 */
export async function dispatchEmailSend(opts: DispatchSendOptions): Promise<DispatchSendResult> {
  const { tenantDomain, marketId, email, listId, segmentId, testRecipient, createdBy, baseUrl, scheduledAt } = opts;

  // All list/segment sends are queued for the worker — this gives us per-tick
  // rate shaping, retry safety, and avoids holding the request open while we
  // loop over thousands of recipients. Test recipients (single-message
  // preview sends) deliver inline so reviewers see the result immediately.
  if (testRecipient) {
    return deliverEmailSend(opts);
  }
  // Workflow single-contact sends: deliver inline with full production suppression.
  if (opts.workflowRecipients?.length) {
    return deliverEmailSend(opts);
  }
  if (!listId && !segmentId) {
    throw Object.assign(new Error("listId or segmentId is required for list sends"), { status: 400 });
  }
  const queueAt = scheduledAt && scheduledAt.getTime() > Date.now() + 1000
    ? scheduledAt
    : new Date(); // immediate: worker picks it up on next tick

  // ── A/B test dispatch ─────────────────────────────────────────────────────
  if (email.abTestEnabled) {
    const [bVariant] = await db.select().from(emailCampaignVariants)
      .where(and(
        eq(emailCampaignVariants.generatedEmailId, email.id),
        eq(emailCampaignVariants.variantLabel, "B"),
      ));
    if (bVariant) {
      const optsWithQueue = { ...opts, listId, queueAt };
      // Each dispatch gets a unique run ID so winner evaluation, holdback
      // release, and results are scoped to this test run rather than all
      // historical sends for the email.
      const abTestRunId = crypto.randomUUID();

      // Atomically reset any prior winner so the evaluator doesn't pick up
      // stale results from a previous run.
      await db.update(generatedEmails).set({
        abWinnerVariantLabel: null,
        abWinnerDeclaredAt: null,
        updatedAt: new Date(),
      }).where(eq(generatedEmails.id, email.id));

      // A variant send
      const [sendA] = await db.insert(emailSends).values({
        ...baseSendValues(optsWithQueue),
        abVariantLabel: "A",
        isAbHoldback: false,
        abTestRunId,
      }).returning();
      // B variant send
      const [sendB] = await db.insert(emailSends).values({
        ...baseSendValues(optsWithQueue),
        abVariantLabel: "B",
        isAbHoldback: false,
        abTestRunId,
      }).returning();
      // Holdback — status "ab_holdback" prevents the worker from picking it up
      const [sendHoldback] = await db.insert(emailSends).values({
        ...baseSendValues(optsWithQueue),
        status: "ab_holdback" as any,
        scheduledAt: null,
        abVariantLabel: null,
        isAbHoldback: true,
        abTestRunId,
      }).returning();
      // ── Snapshot cohort membership at dispatch ─────────────────────────────
      // Build the full recipient list and apply suppressions ONCE so A, B, and
      // holdback cohorts are derived from the same base set.  Persisting them
      // as 'pre_assigned' email_send_recipients rows guarantees exclusive,
      // immutable membership even if the list or suppressions change before the
      // delayed B/holdback deliveries are processed.
      if (listId) {
        const listRows = await db.select({ email: emailRecipients.email, name: emailRecipients.name })
          .from(emailRecipients)
          .where(and(
            eq(emailRecipients.listId, listId),
            eq(emailRecipients.tenantDomain, tenantDomain),
            eq(emailRecipients.status, "active"),
          ))
          .limit(MAX_RECIPIENTS_PER_SEND);

        let deliverable = listRows.map(r => ({ email: r.email.trim().toLowerCase(), name: r.name ?? null }));

        if (deliverable.length > 0) {
          const suppressed = await db.select({ email: emailSuppressions.email })
            .from(emailSuppressions)
            .where(and(
              eq(emailSuppressions.tenantDomain, tenantDomain),
              inArray(emailSuppressions.email, deliverable.map(r => r.email)),
            ));
          const localSuppressed = new Map(suppressed.map(s => [s.email.toLowerCase(), s.email]));
          let hubspotOptedOut = new Set<string>();
          try {
            const emailCategory = await resolveFirstSubTypeName(tenantDomain, optsWithQueue.subscriptionTypeIds ?? []);
            const consent = await pullSubscriptionStatus(tenantDomain, deliverable.map(r => r.email), emailCategory);
            hubspotOptedOut = consent.optedOut;
          } catch { /* best-effort */ }
          const supMap = reconcileSuppression({
            candidateEmails: deliverable.map(r => r.email),
            locallySuppressed: localSuppressed,
            hubspotOptedOut,
          });
          deliverable = deliverable.filter(r => !supMap.has(r.email));
        }

        const split = Math.max(1, Math.min(49, email.abTestSplit ?? 20));
        deliverable.sort((a, b) => a.email.localeCompare(b.email));
        const n = deliverable.length;
        const cutA = Math.floor(n * split / 100);
        const cutB = Math.floor(n * 2 * split / 100);
        const cohortA = deliverable.slice(0, cutA);
        const cohortB = deliverable.slice(cutA, cutB);
        const cohortHoldback = deliverable.slice(cutB);

        const writePreAssigned = async (sendId: string, cohort: typeof cohortA) => {
          if (cohort.length > 0) {
            await db.insert(emailSendRecipients).values(
              cohort.map(r => ({
                sendId,
                tenantDomain,
                email: r.email,
                name: r.name,
                // Placeholder token — delivery time generates a fresh one and
                // deletes these rows first, avoiding any token mismatch.
                unsubscribeToken: makeUnsubscribeToken(sendId, r.email),
                status: "pre_assigned" as any,
              })),
            );
          }
          await db.update(emailSends).set({ recipientCount: cohort.length }).where(eq(emailSends.id, sendId));
        };
        await Promise.all([
          writePreAssigned(sendA.id, cohortA),
          writePreAssigned(sendB.id, cohortB),
          writePreAssigned(sendHoldback.id, cohortHoldback),
        ]);
      }

      await db.insert(marketingAuditLog).values({
        tenantDomain,
        marketId,
        userId: createdBy,
        action: "email_ab_test_queued",
        entityType: "email_send",
        entityId: sendA.id,
        status: "ok",
        message: `A/B test queued — split ${email.abTestSplit}% each, ${email.abEvaluationHours}h evaluation, metric: ${email.abWinnerMetric ?? "open_rate"}`,
        details: { sendIdA: sendA.id, sendIdB: sendB.id, sendIdHoldback: sendHoldback.id, listId },
      });
      return {
        send: sendA,
        totalRecipients: 0,
        sentCount: 0,
        failedCount: 0,
        queued: true,
      };
    }
  }

  // ── Standard single-variant send ─────────────────────────────────────────
  const [send] = await db.insert(emailSends).values({
    tenantDomain,
    marketId,
    generatedEmailId: email.id,
    listId: listId ?? null,
    segmentId: segmentId ?? null,
    testRecipient: null,
    status: "queued",
    scheduledAt: queueAt,
    trackOpens: opts.trackOpens !== false,
    trackClicks: opts.trackClicks !== false,
    excludeActiveProspects: opts.excludeActiveProspects === true,
    senderIdentityId: opts.senderIdentityId ?? null,
    subscriptionTypeIds: opts.subscriptionTypeIds ?? [],
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
    details: { listId, segmentId, scheduledAt: queueAt.toISOString(), generatedEmailId: email.id },
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

  // A/B variant identity — needed early for both pre-assigned check and delivery.
  const abVariantLabel = opts.abVariantLabel ?? null;
  const isAbHoldback = opts.isAbHoldback ?? false;

  // ── Pre-assigned cohort check (A/B sends snapshot at dispatch) ────────────
  // dispatchEmailSend writes email_send_recipients rows with status='pre_assigned'
  // for each cohort when the A/B test is first queued.  Using these rows locks
  // in the exact population at dispatch time so suppression changes between the
  // delayed A, B, and holdback deliveries cannot cause overlap or omission.
  // Build recipient set.  Declared early so the pre-assigned block can push
  // into it before the normal list-load path runs.
  const recipients: Array<{ email: string; name: string | null }> = [];
  let usePreAssigned = false;

  // ── Pre-assigned cohort check (A/B sends snapshot at dispatch) ────────────
  // dispatchEmailSend writes email_send_recipients rows with status='pre_assigned'
  // for each cohort when the A/B test is first queued.  Using these rows locks
  // in the exact population at dispatch time so suppression changes between the
  // delayed A, B, and holdback deliveries cannot cause overlap or omission.
  if (!testRecipient && email.abTestEnabled && existingSendId && (abVariantLabel !== null || isAbHoldback)) {
    const preRows = await db
      .select({ email: emailSendRecipients.email, name: emailSendRecipients.name })
      .from(emailSendRecipients)
      .where(and(
        eq(emailSendRecipients.sendId, existingSendId),
        sql`${emailSendRecipients.status} = 'pre_assigned'`,
      ));
    if (preRows.length > 0) {
      // Delete the placeholder rows — fresh tokens will be generated below.
      await db.delete(emailSendRecipients)
        .where(and(
          eq(emailSendRecipients.sendId, existingSendId),
          sql`${emailSendRecipients.status} = 'pre_assigned'`,
        ));
      recipients.push(...preRows.map(r => ({ email: r.email, name: r.name ?? null })));
      usePreAssigned = true;
    }
  } else if (opts.segmentId) {
    // Resolve the saved segment to a dynamic contact list at delivery time.
    const { resolveSegmentContacts } = await import("./marketing-contact-service");
    const { contacts } = await resolveSegmentContacts(opts.segmentId, tenantDomain, MAX_RECIPIENTS_PER_SEND);
    for (const c of contacts) {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || null;
      recipients.push({ email: c.email.trim().toLowerCase(), name });
    }
  }

  // Load from list when not using a pre-assigned cohort.
  if (!usePreAssigned) {
    if (testRecipient) {
      recipients.push({ email: testRecipient.trim().toLowerCase(), name: null });
    } else if (opts.workflowRecipients?.length) {
      // Workflow single-contact sends: use provided recipients directly.
      // All production suppression checks below still apply (no testRecipient skip).
      for (const r of opts.workflowRecipients) {
        recipients.push({ email: r.email.trim().toLowerCase(), name: r.name });
      }
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
    }
  } else if (opts.segmentId) {
    // Resolve the saved segment to a dynamic contact list at delivery time.
    const { resolveSegmentContacts } = await import("./marketing-contact-service");
    const { contacts } = await resolveSegmentContacts(opts.segmentId, tenantDomain, MAX_RECIPIENTS_PER_SEND);
    for (const c of contacts) {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || null;
      recipients.push({ email: c.email.trim().toLowerCase(), name });
    }
  }

  // ── Global + per-type suppression ────────────────────────────────────────
  // Skipped for pre-assigned A/B cohorts — suppression was already applied
  // at dispatch time and cohort membership is immutable.
  if (!usePreAssigned && recipients.length > 0) {
    // Cross-channel opt-out check (marketing_contacts.emailOptOut) — first-party
    // source of truth for contacts who unsubscribed via any channel.
    // Applied to list/segment sends only — test sends are always to the sender.
    if (!testRecipient) {
      const optedOutRows = await db
        .select({ email: marketingContacts.email })
        .from(marketingContacts)
        .where(
          and(
            eq(marketingContacts.tenantDomain, tenantDomain),
            inArray(marketingContacts.email, recipients.map(r => r.email)),
            eq(marketingContacts.emailOptOut, true),
          ),
        );
      const optedOutEmails = new Set(optedOutRows.map(r => r.email.toLowerCase()));
      if (optedOutEmails.size > 0) {
        for (let i = recipients.length - 1; i >= 0; i--) {
          if (optedOutEmails.has(recipients[i].email)) {
            suppressedFromSend.push({ email: recipients[i].email, reason: "email_opt_out" });
            recipients.splice(i, 1);
          }
        }
      }
    }

    // Global suppression + HubSpot consent reconciliation.
    const suppressed = await db.select({ email: emailSuppressions.email, reason: emailSuppressions.reason })
      .from(emailSuppressions)
      .where(and(
        eq(emailSuppressions.tenantDomain, tenantDomain),
        inArray(emailSuppressions.email, recipients.map(r => r.email)),
      ));
    const localSuppressed = new Map(suppressed.map(s => [s.email.toLowerCase(), s.reason]));

    // Pull HubSpot opt-out state and reconcile. Best-effort: failure falls
    // back to local suppression only.
    let hubspotOptedOut = new Set<string>();
    if (!testRecipient) {
      // Skip the HubSpot round-trip for single-address test sends to keep
      // preview latency low; local suppression is sufficient for tests.
      try {
        const emailCategory = await resolveFirstSubTypeName(tenantDomain, opts.subscriptionTypeIds ?? []);
        const consent = await pullSubscriptionStatus(tenantDomain, recipients.map(r => r.email), emailCategory);
        hubspotOptedOut = consent.optedOut;
      } catch { /* best-effort */ }
    }

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

    // Per-subscription-type suppression: filter recipients who have opted out
    // of any of the non-transactional types tagged on this send.
    const typeIds = opts.subscriptionTypeIds ?? [];
    if (typeIds.length > 0 && recipients.length > 0) {
      const typeRows = await db.select({
        id: emailSubscriptionTypes.id,
        isTransactional: emailSubscriptionTypes.isTransactional,
      }).from(emailSubscriptionTypes)
        .where(and(
          eq(emailSubscriptionTypes.tenantDomain, tenantDomain),
          inArray(emailSubscriptionTypes.id, typeIds),
        ));
      const nonTransactionalIds = typeRows
        .filter(t => !t.isTransactional)
        .map(t => t.id);

      if (nonTransactionalIds.length > 0) {
        const optedOutRows = await db
          .selectDistinct({ email: emailSubscriptionPreferences.email })
          .from(emailSubscriptionPreferences)
          .where(and(
            eq(emailSubscriptionPreferences.tenantDomain, tenantDomain),
            inArray(emailSubscriptionPreferences.email, recipients.map(r => r.email)),
            inArray(emailSubscriptionPreferences.subscriptionTypeId, nonTransactionalIds),
            sql`${emailSubscriptionPreferences.optedOutAt} IS NOT NULL`,
          ));
        const optedOutEmails = new Set(optedOutRows.map(r => r.email.toLowerCase()));
        if (optedOutEmails.size > 0) {
          for (let i = recipients.length - 1; i >= 0; i--) {
            if (optedOutEmails.has(recipients[i].email)) {
              suppressedFromSend.push({ email: recipients[i].email, reason: "subscription_opt_out" });
              recipients.splice(i, 1);
            }
          }
        }
      }
    }

    // Prospect suppression — list sends only, applied AFTER global suppression.
    if (!testRecipient && opts.excludeActiveProspects && recipients.length > 0) {
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
      segmentId: testRecipient ? null : (opts.segmentId ?? null),
      testRecipient: testRecipient ?? null,
      status: "sending",
      trackOpens,
      trackClicks,
      subscriptionTypeIds: opts.subscriptionTypeIds ?? [],
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
    return { send, totalRecipients: 0, sentCount: 0, failedCount: 0 };
  }

  // ── A/B cohort filtering ─────────────────────────────────────────────────
  // Skipped for pre-assigned sends (cohort was fixed at dispatch time).
  // For fallback non-pre-assigned sends, slice deterministically by email.
  if (!usePreAssigned && !testRecipient && email.abTestEnabled && (abVariantLabel || isAbHoldback)) {
    const split = Math.max(1, Math.min(49, email.abTestSplit ?? 20));
    recipients.sort((a, b) => a.email.localeCompare(b.email));
    const n = recipients.length;
    const cutA = Math.floor(n * split / 100);
    const cutB = Math.floor(n * 2 * split / 100);
    let slice: typeof recipients;
    // Holdback always gets positions ≥ 2×split regardless of winner label.
    if (isAbHoldback)          slice = recipients.slice(cutB);
    else if (abVariantLabel === "A") slice = recipients.slice(0, cutA);
    else                       slice = recipients.slice(cutA, cutB); // B
    recipients.splice(0, recipients.length, ...slice);
  }

  // ── Determine effective subject / body (load B variant if needed) ────────
  // For holdback rows the AB worker writes the winner label into abVariantLabel
  // before re-queuing, so we can use that to pick the winning template.
  let effectiveSubject = email.subject;
  let effectiveHtmlBody = email.htmlBody;
  let effectiveTextBody = email.textBody ?? null;

  // Template selection is driven solely by abVariantLabel on the send row.
  // For the holdback, the evaluator writes the winning label into abVariantLabel
  // before re-queuing, making this fully run-scoped and independent of the
  // mutable email-level abWinnerVariantLabel field.
  const useVariantB = abVariantLabel === "B";
  if (useVariantB) {
    const [bVariant] = await db.select().from(emailCampaignVariants)
      .where(and(
        eq(emailCampaignVariants.generatedEmailId, email.id),
        eq(emailCampaignVariants.variantLabel, "B"),
      ));
    if (bVariant) {
      effectiveSubject = bVariant.subject;
      // A blank B body means subject-only test — fall back to A's body so
      // variant B recipients receive the campaign content unchanged.
      effectiveHtmlBody = bVariant.htmlBody?.trim() ? bVariant.htmlBody : email.htmlBody;
      effectiveTextBody = bVariant.textBody?.trim() ? bVariant.textBody : (email.textBody ?? null);
    }
  }

  // Append the deterministic sections block (case study / events / recent
  // updates), if configured, after the main message — and enforce a readable
  // minimum font size across the whole body for mobile clients.
  //
  // Re-render from the stored selection config so any changes to event dates,
  // blog post titles, or archived items are reflected in the live send rather
  // than carrying the stale snapshot saved at "Save sections" time.
  // Falls back to the stored sectionsHtml when no config is present.
  if (effectiveHtmlBody) {
    let sectionsHtml: string | null = (email as any).sectionsHtml ?? null;
    const sectionsConfig = (email as any).sections;
    if (sectionsConfig && marketId) {
      try {
        const rendered = await reRenderSectionsHtml(sectionsConfig, {
          tenantDomain,
          marketId,
        });
        if (rendered !== null) sectionsHtml = rendered;
      } catch (err) {
        console.warn("[Email Sender] sections re-render failed; using stored HTML:", err);
      }
    }
    effectiveHtmlBody = appendSectionsToBody(effectiveHtmlBody, sectionsHtml);
    effectiveHtmlBody = enforceMinimumFontSize(effectiveHtmlBody);
    // Recipients fetch images from outside the app: publish private object
    // images and absolutize relative srcs, then harden CTA button styling.
    effectiveHtmlBody = await prepareEmailImages(effectiveHtmlBody, baseUrl, tenantDomain);
    effectiveHtmlBody = hardenCtaButtons(effectiveHtmlBody);
  }

  // CAN-SPAM: the tenant's physical mailing address goes in every footer.
  let tenantMailingAddress: string | null = null;
  try {
    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.domain, tenantDomain)).limit(1);
    tenantMailingAddress = (tenantRow as any)?.mailingAddress ?? null;
  } catch { /* best-effort */ }

  // ── Correct recipientCount to reflect actual cohort size ─────────────────
  // Only needed for non-pre-assigned sends (pre-assigned counts were set at
  // dispatch); for sliced non-pre-assigned sends the count was set to the full
  // deliverable list before slicing and needs adjustment here.
  if (!usePreAssigned && existingSendId && (abVariantLabel || isAbHoldback) && !testRecipient) {
    await db.update(emailSends)
      .set({ recipientCount: recipients.length })
      .where(eq(emailSends.id, send.id));
    send = { ...send, recipientCount: recipients.length };
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
  const baseHtml = effectiveHtmlBody || "";
  const baseText = effectiveTextBody || "";
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

  // Resolve sender identity — falls back to connector's from_email if not set.
  let fromField: string | { email: string; name: string } = fromEmail;
  let replyToField: string | undefined;
  if (opts.senderIdentityId) {
    const [identity] = await db.select().from(emailSenderIdentities)
      .where(and(eq(emailSenderIdentities.id, opts.senderIdentityId), eq(emailSenderIdentities.tenantDomain, tenantDomain)));
    if (identity) {
      fromField = { email: identity.email, name: identity.name };
      if (identity.replyToEmail) replyToField = identity.replyToEmail;
    }
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const r of prepared) {
    const base = baseUrl.replace(/\/$/, "");
    const unsubUrl = `${base}/u/${r.token}`;
    const prefsUrl = `${base}/p/${r.token}`;

    // Per-recipient personalization: resolve {{token|fallback}} placeholders
    // against the matching marketing_contacts row (best-effort, no throw).
    let personalizedSubject = effectiveSubject;
    let personalizedHtml = wrappedHtml;
    let personalizedText = wrappedText;
    try {
      personalizedSubject = await resolveTokensForEmail(effectiveSubject, tenantDomain, r.email);
      personalizedHtml = wrappedHtml
        ? await resolveTokensForEmail(wrappedHtml, tenantDomain, r.email)
        : wrappedHtml;
      personalizedText = wrappedText
        ? await resolveTokensForEmail(wrappedText, tenantDomain, r.email)
        : wrappedText;
    } catch { /* best-effort: fall back to unresolved template */ }

    // Only wrap in a responsive document if there is actual HTML content.
    // If htmlBody is empty (plain-text email) don't produce an HTML part at
    // all — let the email client fall back to the text part instead of
    // showing a document that contains only the unsubscribe footer.
    const htmlWithFooter = personalizedHtml ? injectFooter(personalizedHtml, unsubUrl, prefsUrl, tenantMailingAddress) : null;
    const html = htmlWithFooter ? wrapResponsiveDocument(htmlWithFooter) : undefined;
    const text = personalizedText
      ? injectTextFooter(personalizedText, unsubUrl, prefsUrl, tenantMailingAddress)
      : `${tenantMailingAddress ? tenantMailingAddress.replace(/\n/g, ", ") + "\n" : ""}Unsubscribe: ${unsubUrl}\nManage preferences: ${prefsUrl}`;
    try {
      const [resp] = await sgMail.send({
        to: r.email,
        from: fromField,
        ...(replyToField ? { replyTo: replyToField } : {}),
        subject: personalizedSubject,
        text,
        ...(html ? { html } : {}),
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
            subject: effectiveSubject,
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
          // Preserve segment targeting captured at schedule time.
          segmentId: (row.send as any).segmentId ?? null,
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
          // Preserve the sender identity captured at schedule time.
          senderIdentityId: row.send.senderIdentityId ?? null,
          subscriptionTypeIds: row.send.subscriptionTypeIds ?? [],
          // A/B test: pass the variant label and holdback flag so deliverEmailSend
          // can apply the correct cohort filtering and variant content.
          abVariantLabel: row.send.abVariantLabel ?? null,
          isAbHoldback: row.send.isAbHoldback ?? false,
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
