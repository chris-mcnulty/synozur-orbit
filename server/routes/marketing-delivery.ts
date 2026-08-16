/**
 * Marketing Delivery Routes — Task #97
 *
 * Endpoints for direct social publishing & email campaign delivery:
 *   - POST   /api/social-accounts/:id/oauth/connect       → returns redirect URL
 *   - GET    /api/social-accounts/oauth/callback          → completes OAuth
 *   - POST   /api/social-accounts/:id/disconnect          → wipes tokens
 *   - POST   /api/generated-posts/:id/publish             → publish-now
 *   - GET    /api/generated-posts/:id/publish-attempts    → audit trail
 *   - GET    /api/email-recipient-lists                   → list/create/edit
 *   - POST   /api/email-recipient-lists
 *   - PATCH  /api/email-recipient-lists/:id
 *   - DELETE /api/email-recipient-lists/:id
 *   - GET    /api/email-recipient-lists/:id/recipients
 *   - POST   /api/email-recipient-lists/:id/recipients    (single + bulk)
 *   - DELETE /api/email-recipient-lists/:id/recipients/:rid
 *   - GET    /api/email-suppressions
 *   - POST   /api/email-suppressions
 *   - DELETE /api/email-suppressions/:id
 *   - GET    /api/email-sends                              (Sends tab)
 *   - GET    /api/email-sends/:id
 *   - POST   /api/generated-emails/:id/send                (dispatch send)
 *   - GET    /u/:token                                     (public unsub – HTML)
 *   - POST   /u/:token                                     (public unsub – action)
 *   - POST   /api/webhooks/sendgrid                        (delivery events)
 *   - GET    /api/marketing-audit-log                      (admin audit)
 *
 * The `/u/:token` and `/api/webhooks/sendgrid` handlers are PUBLIC — they
 * must be registered BEFORE the auth middleware in the main routes file.
 * Everything else is gated by `directPublishing` / `directEmailDelivery`
 * via `checkFeatureAccessAsync`.
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { and, eq, ne, desc, inArray, sql, notInArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  socialAccounts,
  socialPublishAttempts,
  generatedPosts,
  generatedEmails,
  emailCampaignVariants,
  emailRecipientLists,
  emailRecipients,
  emailSuppressions,
  emailSends,
  emailSendRecipients,
  emailSenderIdentities,
  emailSubscriptionTypes,
  emailSubscriptionPreferences,
  marketingAuditLog,
  marketingContacts,
  prospects,
} from "@shared/schema";
import { resolveTokensPreview, KNOWN_TOKENS } from "../services/email-ab-test";
import { getRequestContext } from "../context";
import { storage } from "../storage";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { encryptSecret } from "../utils/encryption";
import { getPublisher } from "../services/social-publishers";
import { publishPostNow } from "../services/marketing-publish-worker";
import {
  dispatchEmailSend,
  previewListDeliverability,
  verifyUnsubscribeToken,
  verifySendGridWebhook,
} from "../services/email-campaign-sender";
import { LinkedInPublisher } from "../services/social-publishers/linkedin";
import { decryptSecret } from "../utils/encryption";
import { pushEmailTimelineEvent } from "../services/hubspot-timeline";
import { timelineEventId, type TimelineEventKey } from "../services/hubspot-email-sync-core";
import { pushUnsubscribe, pushSubscribe } from "../services/hubspot-email-sync";

/**
 * Resolve the Orbit email subscription type name for a given send so the
 * per-category HubSpot subscription mapping can be applied when mirroring
 * unsubscribes / resubscribes. Returns the first non-transactional type name,
 * or undefined when the send has no subscription type tags.
 */
async function resolveEmailCategoryForSend(
  tenantDomain: string,
  sendId: string,
): Promise<string | undefined> {
  const [send] = await db.select({ subscriptionTypeIds: emailSends.subscriptionTypeIds })
    .from(emailSends)
    .where(and(eq(emailSends.id, sendId), eq(emailSends.tenantDomain, tenantDomain)));
  const typeIds = (send?.subscriptionTypeIds ?? []) as string[];
  if (!typeIds.length) return undefined;
  const [type] = await db.select({ name: emailSubscriptionTypes.name })
    .from(emailSubscriptionTypes)
    .where(and(
      eq(emailSubscriptionTypes.tenantDomain, tenantDomain),
      inArray(emailSubscriptionTypes.id, typeIds),
      eq(emailSubscriptionTypes.isTransactional, false),
    ))
    .limit(1);
  return type?.name;
}

/** Build the per-subscription-type preference center page. */
function preferenceCenterHtml(
  token: string,
  email: string,
  types: Array<{ id: string; name: string; description: string | null; isTransactional: boolean; optedOut: boolean }>,
  justSaved = false,
  globallyUnsubscribed = false,
): string {
  const saved = justSaved
    ? `<p style="color:#16a34a;font-size:14px;margin-bottom:16px;">✓ Your preferences have been saved.</p>`
    : "";

  const enc = encodeURIComponent(token);

  // When the contact has a global opt-out, show a prominent notice and a
  // single "Resubscribe" action.  We do NOT show per-type checkboxes because
  // the global suppression overrides them all — showing them would be
  // misleading.
  if (globallyUnsubscribed) {
    return `<!doctype html><html><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Email Preferences</title>
    </head><body style="font-family:sans-serif;max-width:520px;margin:48px auto;padding:24px;color:#111;">
      <h2 style="margin-bottom:4px;">Email Preferences</h2>
      <p style="color:#666;font-size:14px;margin-top:0;margin-bottom:20px;">${escapeHtml(email)}</p>
      ${saved}
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:20px;">
        <strong style="color:#dc2626;">You are unsubscribed from all emails.</strong>
        <p style="margin:6px 0 0;font-size:13px;color:#555;">You will not receive any marketing emails from us. Transactional emails (receipts, security notices) may still be sent.</p>
      </div>
      <form method="POST" action="/p/${enc}">
        <input type="hidden" name="action" value="resubscribe_all" />
        <button type="submit" style="background:#7c3aed;color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;">
          Resubscribe and manage preferences
        </button>
      </form>
    </body></html>`;
  }

  const typeRows = types.length === 0
    ? `<p style="color:#666;font-size:14px;">No subscription categories are configured yet.</p>`
    : types.map(t => {
        const checked = !t.optedOut ? "checked" : "";
        const disabled = t.isTransactional ? "disabled" : "";
        const badge = t.isTransactional
          ? `<span style="font-size:11px;background:#f3f4f6;color:#6b7280;border-radius:4px;padding:1px 6px;margin-left:6px;">Always delivered</span>`
          : "";
        const desc = t.description
          ? `<div style="font-size:12px;color:#888;margin-top:2px;">${escapeHtml(t.description)}</div>`
          : "";
        return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #eee;">
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;">${escapeHtml(t.name)}${badge}</div>${desc}
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;cursor:${t.isTransactional ? "default" : "pointer"};">
            <input type="checkbox" name="optedin_${escapeHtml(t.id)}" ${checked} ${disabled}
              style="width:16px;height:16px;accent-color:#7c3aed;" />
            <span>${t.isTransactional ? "Always on" : "Subscribed"}</span>
          </label>
        </div>`;
      }).join("");

  return `<!doctype html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Email Preferences</title>
  </head><body style="font-family:sans-serif;max-width:520px;margin:48px auto;padding:24px;color:#111;">
    <h2 style="margin-bottom:4px;">Email Preferences</h2>
    <p style="color:#666;font-size:14px;margin-top:0;margin-bottom:20px;">${escapeHtml(email)}</p>
    ${saved}
    <p style="font-size:14px;color:#555;margin-bottom:12px;">Choose which types of email you receive from us.</p>
    <form method="POST" action="/p/${enc}">
      ${typeRows}
      ${types.some(t => !t.isTransactional)
        ? `<button type="submit" style="margin-top:20px;background:#7c3aed;color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;">Save preferences</button>`
        : ""}
    </form>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
      Want to stop all email?
      <a href="/u/${enc}" style="color:#7c3aed;">Unsubscribe from everything</a>
    </div>
  </body></html>`;
}

/**
 * Best-effort mirror of a recipient engagement event to its HubSpot contact
 * timeline (marketing-email sync Phase 2). No-ops when the recipient has no
 * resolved contact or no timeline template is configured. Never throws.
 */
async function pushRecipientTimeline(
  recipient: any,
  eventKey: TimelineEventKey,
  tokens: Record<string, string | number>,
  occurredAt: Date,
): Promise<void> {
  if (!recipient?.hubspotContactId || !recipient?.sendId) return;
  try {
    await pushEmailTimelineEvent(recipient.tenantDomain, {
      contactId: recipient.hubspotContactId,
      eventKey,
      eventId: timelineEventId(recipient.sendId, recipient.id, eventKey),
      tokens: { sendId: recipient.sendId, ...tokens },
      occurredAt,
    });
  } catch { /* best-effort */ }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getTenantPlan(tenantDomain: string): Promise<string> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  return tenant?.plan ?? "free";
}

async function guardFeature(req: Request, res: Response, feature: string): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  try {
    const ctx = await getRequestContext(req);
    const plan = await getTenantPlan(ctx.tenantDomain);
    const gate = await checkFeatureAccessAsync(plan, feature);
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason, upgradeRequired: gate.upgradeRequired, requiredPlan: gate.requiredPlan });
      return false;
    }
    return true;
  } catch (err: any) {
    const status = (err && typeof err === "object" && "status" in err) ? (err.status as number) : 500;
    res.status(status).json({ error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Internal server error" });
    return false;
  }
}

function getBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

// In-memory store of CSRF state for OAuth flow. The per-state record is
// short-lived; if the user takes longer than 10 minutes the flow expires.
// codeVerifier is set for PKCE flows (Twitter/X).
const oauthStates = new Map<string, { tenantDomain: string; userId: string; socialAccountId: string; expiresAt: number; redirectUri: string; codeVerifier?: string }>();
/** Exported for test seeding only — do not use in application code. */
export const _oauthStates = oauthStates;
function purgeExpiredStates() {
  const now = Date.now();
  oauthStates.forEach((v, k) => {
    if (v.expiresAt < now) oauthStates.delete(k);
  });
}

// ─── public/auth-less routes ─────────────────────────────────────────────────
// These must be registered BEFORE auth/Vite catch-alls.

export function registerMarketingDeliveryPublicRoutes(app: Express) {
  // Public unsubscribe page — minimal HTML; supports List-Unsubscribe one-click
  // (POST) per RFC 8058 and a clickable confirmation page (GET).
  app.get("/u/:token", async (req, res) => {
    const decoded = verifyUnsubscribeToken(req.params.token);
    if (!decoded) {
      res.status(400).send(`<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Invalid unsubscribe link</h2><p>This link is not valid or has expired.</p></body></html>`);
      return;
    }
    res.status(200).send(`<!doctype html><html><head><title>Unsubscribe</title></head><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:24px;text-align:center;">
      <h2>Unsubscribe ${escapeHtml(decoded.email)}</h2>
      <p>Click the button below to stop receiving emails from this campaign.</p>
      <form method="POST" action="/u/${encodeURIComponent(req.params.token)}">
        <button style="background:#7c3aed;color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;" type="submit">Confirm unsubscribe</button>
      </form>
    </body></html>`);
  });

  app.post("/u/:token", async (req, res) => {
    const decoded = verifyUnsubscribeToken(req.params.token);
    if (!decoded) {
      res.status(400).send("Invalid unsubscribe link");
      return;
    }
    try {
      const [recipientRow] = await db.select().from(emailSendRecipients)
        .where(eq(emailSendRecipients.unsubscribeToken, req.params.token));
      if (!recipientRow) {
        res.status(404).send("Unsubscribe record not found");
        return;
      }
      // Idempotent: only stamp + increment the first time. Re-clicking the
      // unsubscribe button or replaying the POST must not double-count.
      if (recipientRow.status !== "unsubscribed" && !recipientRow.unsubscribedAt) {
        await db.update(emailSendRecipients).set({
          status: "unsubscribed",
          unsubscribedAt: new Date(),
        }).where(and(
          eq(emailSendRecipients.unsubscribeToken, req.params.token),
          // Re-check transition state inside the WHERE so two concurrent
          // requests cannot both succeed at the increment step.
          ne(emailSendRecipients.status, "unsubscribed"),
        ));

        // writeGlobalOptOut creates the email_suppressions row AND upserts
        // opt-outs for every enabled non-transactional type so per-type
        // suppression stays in sync with the global choice.
        await writeGlobalOptOut(recipientRow.tenantDomain, recipientRow.email);

        await db.update(emailRecipients).set({ status: "unsubscribed" })
          .where(and(
            eq(emailRecipients.tenantDomain, recipientRow.tenantDomain),
            eq(emailRecipients.email, recipientRow.email),
          ));

        await db.update(emailSends).set({
          unsubscribeCount: sql`${emailSends.unsubscribeCount} + 1`,
        }).where(eq(emailSends.id, recipientRow.sendId));

        await db.insert(marketingAuditLog).values({
          tenantDomain: recipientRow.tenantDomain,
          action: "email_unsubscribe",
          entityType: "email_send_recipient",
          entityId: recipientRow.id,
          status: "ok",
          message: "Public unsubscribe",
          details: { email: recipientRow.email, sendId: recipientRow.sendId },
        });
        await pushRecipientTimeline(recipientRow, "email_unsubscribed", {}, new Date());
        // Mirror the opt-out to HubSpot using the send's subscription category so
        // the correct per-category subscription mapping is applied.
        resolveEmailCategoryForSend(recipientRow.tenantDomain, recipientRow.sendId)
          .then(cat => pushUnsubscribe(recipientRow.tenantDomain, recipientRow.email, undefined, cat))
          .catch(() => {});
      }
    } catch (err: any) {
      console.error("[Unsubscribe] Failed:", err.message);
    }
    res.status(200).send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:24px;text-align:center;"><h2>You're unsubscribed</h2><p>You won't receive any more emails from this campaign.</p></body></html>`);
  });

  // Preference center (Phase 3) — a richer hosted page than the one-click
  // /u/:token. Single "Marketing" subscription in v1: lets a recipient see
  // their status and unsubscribe or resubscribe. Reuses the per-send token.
  // ── Preference center helpers ────────────────────────────────────────────

  /** Load tenant subscription types with opted-out state for a given email. */
  async function loadPreferenceState(tenantDomain: string, email: string) {
    const allTypes = await db.select().from(emailSubscriptionTypes)
      .where(and(
        eq(emailSubscriptionTypes.tenantDomain, tenantDomain),
        eq(emailSubscriptionTypes.isEnabled, true),
      ))
      .orderBy(emailSubscriptionTypes.sortOrder, emailSubscriptionTypes.name);

    if (allTypes.length === 0) return [];

    const prefs = await db.select().from(emailSubscriptionPreferences)
      .where(and(
        eq(emailSubscriptionPreferences.tenantDomain, tenantDomain),
        eq(emailSubscriptionPreferences.email, email.toLowerCase()),
        inArray(emailSubscriptionPreferences.subscriptionTypeId, allTypes.map(t => t.id)),
      ));
    const prefMap = new Map(prefs.map(p => [p.subscriptionTypeId, p]));

    return allTypes.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      isTransactional: t.isTransactional,
      hubspotTypeId: t.hubspotTypeId,
      // opted out = preference row exists AND optedOutAt is set
      optedOut: !t.isTransactional && (prefMap.get(t.id)?.optedOutAt != null),
    }));
  }

  app.get("/p/:token", async (req, res) => {
    const decoded = verifyUnsubscribeToken(req.params.token);
    if (!decoded) return res.status(400).send("Invalid preferences link");
    try {
      const [row] = await db.select().from(emailSendRecipients)
        .where(eq(emailSendRecipients.unsubscribeToken, req.params.token));
      if (!row) return res.status(404).send("Preferences record not found");

      const [sup] = await db.select({ id: emailSuppressions.id }).from(emailSuppressions)
        .where(and(
          eq(emailSuppressions.tenantDomain, row.tenantDomain),
          eq(emailSuppressions.email, row.email.toLowerCase()),
        ));
      const globallyUnsubscribed = !!sup;
      const types = await loadPreferenceState(row.tenantDomain, row.email);
      res.status(200).send(preferenceCenterHtml(req.params.token, row.email, types, false, globallyUnsubscribed));
    } catch (err: any) {
      console.error("[Preferences] Load failed:", err?.message);
      res.status(500).send("Could not load your preferences");
    }
  });

  app.post("/p/:token", async (req, res) => {
    const decoded = verifyUnsubscribeToken(req.params.token);
    if (!decoded) return res.status(400).send("Invalid preferences link");
    try {
      const [row] = await db.select().from(emailSendRecipients)
        .where(eq(emailSendRecipients.unsubscribeToken, req.params.token));
      if (!row) return res.status(404).send("Preferences record not found");

      const email = row.email.toLowerCase();
      const body = req.body ?? {};
      const action = String(body.action ?? "").toLowerCase();
      const now = new Date();

      // ── Resubscribe from global opt-out ──────────────────────────────────
      // The globally-unsubscribed page has a single "Resubscribe" button that
      // posts action=resubscribe_all.  Clear the global suppression and all
      // per-type opt-outs so the per-type form is shown next.
      if (action === "resubscribe_all") {
        await db.delete(emailSuppressions).where(and(
          eq(emailSuppressions.tenantDomain, row.tenantDomain),
          eq(emailSuppressions.email, email),
          eq(emailSuppressions.reason, "unsubscribe"),
        ));
        await db.update(emailSubscriptionPreferences).set({ optedOutAt: null, updatedAt: now })
          .where(and(
            eq(emailSubscriptionPreferences.tenantDomain, row.tenantDomain),
            eq(emailSubscriptionPreferences.email, email),
          ));
        await db.update(emailRecipients).set({ status: "active" })
          .where(and(
            eq(emailRecipients.tenantDomain, row.tenantDomain),
            eq(emailRecipients.email, email),
          ));
        // Clear the first-party opt-out flag so the contact is eligible for
        // future list sends again. Must be atomic with the suppression delete.
        await db.update(marketingContacts)
          .set({ emailOptOut: false, emailOptOutAt: null, emailOptOutSource: null, updatedAt: now })
          .where(and(
            eq(marketingContacts.tenantDomain, row.tenantDomain),
            eq(marketingContacts.email, email),
          ));
        pushSubscribe(row.tenantDomain, email).catch(() => {});
        const types = await loadPreferenceState(row.tenantDomain, email);
        return res.status(200).send(preferenceCenterHtml(req.params.token, email, types, true, false));
      }

      // ── Global unsubscribe (from preference-center "Unsubscribe all" path) ─
      if (action === "unsubscribe") {
        await writeGlobalOptOut(row.tenantDomain, email);
        await db.update(emailRecipients).set({ status: "unsubscribed" })
          .where(and(eq(emailRecipients.tenantDomain, row.tenantDomain), eq(emailRecipients.email, email)));
        if (row.status !== "unsubscribed" && !row.unsubscribedAt) {
          await db.update(emailSendRecipients).set({ status: "unsubscribed", unsubscribedAt: now })
            .where(and(eq(emailSendRecipients.id, row.id), ne(emailSendRecipients.status, "unsubscribed")));
          await db.update(emailSends).set({ unsubscribeCount: sql`${emailSends.unsubscribeCount} + 1` })
            .where(eq(emailSends.id, row.sendId));
        }
        await pushRecipientTimeline(row, "email_unsubscribed", {}, now);
        pushUnsubscribe(row.tenantDomain, email).catch(() => {});
        const types = await loadPreferenceState(row.tenantDomain, email);
        return res.status(200).send(preferenceCenterHtml(req.params.token, email, types, true, true));
      }

      // ── Per-type preferences (normal form submit) ─────────────────────────
      // Block per-type saves for globally suppressed contacts — they must
      // resubscribe first so their intent is unambiguous.
      const [sup] = await db.select({ id: emailSuppressions.id }).from(emailSuppressions)
        .where(and(
          eq(emailSuppressions.tenantDomain, row.tenantDomain),
          eq(emailSuppressions.email, email),
        ));
      if (sup) {
        const types = await loadPreferenceState(row.tenantDomain, email);
        return res.status(200).send(preferenceCenterHtml(req.params.token, email, types, false, true));
      }

      // Load all enabled non-transactional types for the tenant.
      const allTypes = await db.select({
        id: emailSubscriptionTypes.id,
        name: emailSubscriptionTypes.name,
        isTransactional: emailSubscriptionTypes.isTransactional,
      }).from(emailSubscriptionTypes)
        .where(and(
          eq(emailSubscriptionTypes.tenantDomain, row.tenantDomain),
          eq(emailSubscriptionTypes.isEnabled, true),
        ));

      const nonTransactional = allTypes.filter(t => !t.isTransactional);

      // For each non-transactional type: checkbox checked → opted in; unchecked → opted out.
      for (const type of nonTransactional) {
        const isOptedIn = !!body[`optedin_${type.id}`];
        const optedOutAt = isOptedIn ? null : now;

        await db.insert(emailSubscriptionPreferences).values({
          tenantDomain: row.tenantDomain,
          email,
          subscriptionTypeId: type.id,
          optedOutAt,
        }).onConflictDoUpdate({
          target: [
            emailSubscriptionPreferences.tenantDomain,
            emailSubscriptionPreferences.email,
            emailSubscriptionPreferences.subscriptionTypeId,
          ],
          set: { optedOutAt, updatedAt: now },
        });

        // Mirror to HubSpot using the category-mapped subscription ID. Pass
        // undefined for the subscriptionIdOverride so the resolver looks up
        // hubspot_subscription_mappings by type name (4th arg), falling back
        // to the tenant's global default subscription ID.
        if (!isOptedIn) {
          pushUnsubscribe(row.tenantDomain, email, undefined, type.name).catch(() => {});
        } else {
          pushSubscribe(row.tenantDomain, email, undefined, type.name).catch(() => {});
        }
      }

      // Audit log
      await db.insert(marketingAuditLog).values({
        tenantDomain: row.tenantDomain,
        action: "email_preferences_updated",
        entityType: "email_send_recipient",
        entityId: row.id,
        status: "ok",
        message: "Preference-center per-type update",
        details: { email, sendId: row.sendId },
      });

      const types = await loadPreferenceState(row.tenantDomain, email);
      res.status(200).send(preferenceCenterHtml(req.params.token, email, types, true, false));
    } catch (err: any) {
      console.error("[Preferences] Update failed:", err?.message);
      res.status(500).send("Could not update your preferences");
    }
  });

  // SendGrid Event Webhook — bounce/dropped/spam/unsubscribe/open/click events.
  // SendGrid posts a JSON array of events. We match by `orbit_unsub_token`
  // custom arg; if missing, fall back to email + tenant. Signed events are
  // verified using SENDGRID_WEBHOOK_VERIFICATION_KEY (ECDSA P-256 PEM).
  app.post("/api/webhooks/sendgrid", async (req, res) => {
    const sigHeader = req.headers["x-twilio-email-event-webhook-signature"] as string | undefined;
    const tsHeader = req.headers["x-twilio-email-event-webhook-timestamp"] as string | undefined;
    const raw = (req as any).rawBody as Buffer | undefined;
    const verifyResult = verifySendGridWebhook(
      raw ?? JSON.stringify(req.body ?? []),
      sigHeader,
      tsHeader,
    );
    if (!verifyResult.ok) {
      console.warn(`[SendGrid Webhook] Signature verification failed: ${verifyResult.reason}`);
      return res.status(403).json({ error: "Invalid signature", reason: verifyResult.reason });
    }
    const events = Array.isArray(req.body) ? req.body : [];
    for (const ev of events) {
      try {
        await handleSendGridEvent(ev);
      } catch (err: any) {
        console.error("[SendGrid Webhook] Event handling error:", err.message);
      }
    }
    res.status(200).json({ received: events.length });
  });
}

/**
 * Write a global opt-out: adds an email_suppressions row AND upserts
 * opt-out preferences for every enabled non-transactional type so
 * per-type and global suppression stay in sync. Used by every code path
 * that records a "unsubscribe from everything" choice.
 */
async function writeGlobalOptOut(tenantDomain: string, email: string): Promise<void> {
  const normalEmail = email.toLowerCase();
  const now = new Date();

  // Fetch the non-transactional types outside the transaction so we keep the
  // transaction as short as possible (reads-only before the write boundary).
  const types = await db.select({ id: emailSubscriptionTypes.id })
    .from(emailSubscriptionTypes)
    .where(and(
      eq(emailSubscriptionTypes.tenantDomain, tenantDomain),
      eq(emailSubscriptionTypes.isEnabled, true),
      eq(emailSubscriptionTypes.isTransactional, false),
    ));

  // Wrap suppression insert + all preference upserts in a single transaction
  // so a failure cannot leave global and per-type suppression out of sync.
  await db.transaction(async (tx) => {
    await tx.insert(emailSuppressions).values({
      tenantDomain,
      email: normalEmail,
      reason: "unsubscribe",
      source: "public_unsub",
    }).onConflictDoNothing();

    if (types.length > 0) {
      await tx.insert(emailSubscriptionPreferences)
        .values(types.map(type => ({
          tenantDomain,
          email: normalEmail,
          subscriptionTypeId: type.id,
          optedOutAt: now,
        })))
        .onConflictDoUpdate({
          target: [
            emailSubscriptionPreferences.tenantDomain,
            emailSubscriptionPreferences.email,
            emailSubscriptionPreferences.subscriptionTypeId,
          ],
          set: { optedOutAt: now, updatedAt: now },
        });
    }

    // Stamp the marketing_contacts opt-out flag so the email sender has a
    // first-party suppression source without needing a separate backfill run.
    await tx.update(marketingContacts)
      .set({
        emailOptOut: true,
        emailOptOutAt: now,
        emailOptOutSource: "public_unsub",
        updatedAt: now,
      })
      .where(and(
        eq(marketingContacts.tenantDomain, tenantDomain),
        eq(marketingContacts.email, normalEmail),
      ));
  });
}
async function handleSendGridEvent(ev: any) {
  const token = ev.orbit_unsub_token as string | undefined;
  const email = (ev.email as string | undefined)?.toLowerCase();
  const evtType = ev.event as string | undefined;
  if (!evtType) return;

  let recipient: any = null;
  if (token) {
    [recipient] = await db.select().from(emailSendRecipients)
      .where(eq(emailSendRecipients.unsubscribeToken, token));
  }
  if (!recipient && email && ev.orbit_send_id) {
    [recipient] = await db.select().from(emailSendRecipients)
      .where(and(
        eq(emailSendRecipients.sendId, ev.orbit_send_id),
        eq(emailSendRecipients.email, email),
      ));
  }
  if (!recipient) return;

  const now = new Date();
  switch (evtType) {
    case "delivered":
      if (!recipient.deliveredAt) {
        await db.update(emailSendRecipients).set({ status: "delivered", deliveredAt: now })
          .where(eq(emailSendRecipients.id, recipient.id));
        await db.update(emailSends).set({
          deliveredCount: sql`${emailSends.deliveredCount} + 1`,
        }).where(eq(emailSends.id, recipient.sendId));
      }
      break;
    case "bounce":
    case "blocked": {
      // Idempotent: gate the WHERE on prior state so a retried webhook
      // delivery cannot increment bounceCount twice. .returning() tells us
      // whether the transition actually fired.
      const updated = await db.update(emailSendRecipients).set({
        status: "bounced",
        bouncedAt: now,
        errorMessage: ev.reason || ev.response || null,
      }).where(and(
        eq(emailSendRecipients.id, recipient.id),
        ne(emailSendRecipients.status, "bounced"),
      )).returning({ id: emailSendRecipients.id });
      if (updated.length > 0) {
        await db.update(emailSends).set({
          bounceCount: sql`${emailSends.bounceCount} + 1`,
        }).where(eq(emailSends.id, recipient.sendId));
        await db.insert(emailSuppressions).values({
          tenantDomain: recipient.tenantDomain,
          email: recipient.email,
          reason: "bounce",
          source: "sendgrid_event",
          notes: ev.reason || null,
        }).onConflictDoNothing();
        await db.insert(marketingAuditLog).values({
          tenantDomain: recipient.tenantDomain,
          action: "email_bounce",
          entityType: "email_send_recipient",
          entityId: recipient.id,
          status: "warning",
          message: ev.reason || "Bounced",
          details: { email: recipient.email, sendId: recipient.sendId },
        });
        await pushRecipientTimeline(recipient, "email_bounced", { reason: ev.reason || ev.response || "" }, now);
      }
      break;
    }
    case "dropped": {
      const updated = await db.update(emailSendRecipients).set({
        status: "dropped",
        errorMessage: ev.reason || null,
      }).where(and(
        eq(emailSendRecipients.id, recipient.id),
        ne(emailSendRecipients.status, "dropped"),
      )).returning({ id: emailSendRecipients.id });
      if (updated.length > 0) {
        await db.update(emailSends).set({
          failedCount: sql`${emailSends.failedCount} + 1`,
        }).where(eq(emailSends.id, recipient.sendId));
      }
      break;
    }
    case "spamreport": {
      const updated = await db.update(emailSendRecipients).set({ status: "spam" })
        .where(and(
          eq(emailSendRecipients.id, recipient.id),
          ne(emailSendRecipients.status, "spam"),
        )).returning({ id: emailSendRecipients.id });
      if (updated.length > 0) {
        await db.update(emailSends).set({
          spamCount: sql`${emailSends.spamCount} + 1`,
        }).where(eq(emailSends.id, recipient.sendId));
        await db.insert(emailSuppressions).values({
          tenantDomain: recipient.tenantDomain,
          email: recipient.email,
          reason: "spam",
          source: "sendgrid_event",
        }).onConflictDoNothing();
        // Stamp the contact opt-out flag so the sender suppresses this address
        // on future list sends without requiring a backfill run.
        await db.update(marketingContacts)
          .set({
            emailOptOut: true,
            emailOptOutAt: now,
            emailOptOutSource: "sendgrid_event",
            updatedAt: now,
          })
          .where(and(
            eq(marketingContacts.tenantDomain, recipient.tenantDomain),
            eq(marketingContacts.email, recipient.email.toLowerCase()),
          ));
      }
      break;
    }
    case "open": {
      // First-open semantics: only stamp + increment on the very first
      // open per recipient. Webhook retries (and subsequent opens) are
      // ignored so the per-send openCount remains a stable "unique opens"
      // figure that does not drift upward on SendGrid replays.
      if (recipient.openedAt) break;
      const updated = await db.update(emailSendRecipients).set({
        openedAt: now,
        openCount: 1,
        ...(recipient.deliveredAt ? {} : { status: "delivered", deliveredAt: now }),
      }).where(and(
        eq(emailSendRecipients.id, recipient.id),
        sql`${emailSendRecipients.openedAt} IS NULL`,
      )).returning({ id: emailSendRecipients.id });
      if (updated.length > 0) {
        await db.update(emailSends).set({
          openCount: sql`${emailSends.openCount} + 1`,
          ...(recipient.deliveredAt ? {} : { deliveredCount: sql`${emailSends.deliveredCount} + 1` }),
        }).where(eq(emailSends.id, recipient.sendId));
        await pushRecipientTimeline(recipient, "email_opened", { openCount: 1 }, now);
      }
      break;
    }
    case "click": {
      // First-click semantics, mirroring open. Per-link engagement detail
      // lives in the marketing-links redirect handler / audit log.
      if (recipient.clickedAt) break;
      const updated = await db.update(emailSendRecipients).set({
        clickedAt: now,
        clickCount: 1,
      }).where(and(
        eq(emailSendRecipients.id, recipient.id),
        sql`${emailSendRecipients.clickedAt} IS NULL`,
      )).returning({ id: emailSendRecipients.id });
      if (updated.length > 0) {
        await db.update(emailSends).set({
          clickCount: sql`${emailSends.clickCount} + 1`,
        }).where(eq(emailSends.id, recipient.sendId));
        await db.insert(marketingAuditLog).values({
          tenantDomain: recipient.tenantDomain,
          action: "email_click",
          entityType: "email_send_recipient",
          entityId: recipient.id,
          status: "ok",
          message: typeof ev.url === "string" ? `Clicked ${ev.url}` : "Clicked link",
          details: { email: recipient.email, sendId: recipient.sendId, url: ev.url },
        });
        await pushRecipientTimeline(
          recipient,
          "email_clicked",
          { clickCount: 1, url: typeof ev.url === "string" ? ev.url : "" },
          now,
        );
      }
      break;
    }
    case "unsubscribe":
    case "group_unsubscribe": {
      const updated = await db.update(emailSendRecipients).set({
        status: "unsubscribed",
        unsubscribedAt: now,
      }).where(and(
        eq(emailSendRecipients.id, recipient.id),
        ne(emailSendRecipients.status, "unsubscribed"),
      )).returning({ id: emailSendRecipients.id });
      if (updated.length === 0) break;
      await db.update(emailSends).set({
        unsubscribeCount: sql`${emailSends.unsubscribeCount} + 1`,
      }).where(eq(emailSends.id, recipient.sendId));
      // writeGlobalOptOut creates the email_suppressions row AND upserts
      // opt-outs for every non-transactional type so per-type suppression
      // stays in sync with this global choice.
      await writeGlobalOptOut(recipient.tenantDomain, recipient.email);
      await pushRecipientTimeline(recipient, "email_unsubscribed", {}, now);
      // Mirror the opt-out to HubSpot using the send's subscription category.
      resolveEmailCategoryForSend(recipient.tenantDomain, recipient.sendId)
        .then(cat => pushUnsubscribe(recipient.tenantDomain, recipient.email, undefined, cat))
        .catch(() => {});
      break;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!));
}

// ─── authenticated routes ────────────────────────────────────────────────────

export function registerMarketingDeliveryRoutes(app: Express) {
  // ───── Social OAuth Connect ─────
  app.post("/api/social-accounts/:id/oauth/connect", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, req.params.id), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));
    if (!account) return res.status(404).json({ error: "Account not found" });

    const publisher = getPublisher(account.platform);
    if (!publisher || !publisher.supported || !publisher.getOAuthAuthorizeUrl) {
      return res.status(400).json({ error: `Direct publishing is not supported for ${account.platform} yet.` });
    }
    if (!await publisher.oauthConfigured(ctx.tenantDomain)) {
      // Every platform uses a single Synozur-owned OAuth app (the
      // Buffer/Hootsuite model) — tenants never register their own. When a
      // platform isn't connectable yet it's because Synozur hasn't configured
      // and enabled the shared app, not because the tenant is missing setup.
      const error = account.platform === "linkedin"
        ? "LinkedIn direct posting isn't available yet — it's pending LinkedIn's app review. We'll turn on one-click Connect as soon as it's approved."
        : `${account.platform} posting isn't available on Orbit yet — Synozur is finishing setup of the shared ${account.platform} app. We'll turn on one-click Connect as soon as it's approved.`;
      return res.status(503).json({
        error,
        // Tenants can no longer self-configure OAuth apps, so never redirect
        // them to a credentials page — this is a platform-level state.
        configureRequired: false,
        platform: account.platform,
      });
    }

    purgeExpiredStates();
    const state = randomBytes(24).toString("base64url");
    const redirectUri = `${getBaseUrl(req)}/api/social-accounts/oauth/callback`;
    let authorize: string | { url: string; codeVerifier?: string };
    try {
      authorize = await publisher.getOAuthAuthorizeUrl({
        redirectUri,
        state,
        tenantDomain: ctx.tenantDomain,
      });
    } catch (err: any) {
      return res.status(503).json({ error: err.message || "OAuth connect is not available for this platform." });
    }
    // Publishers may return a plain URL or { url, codeVerifier } for PKCE.
    const url = typeof authorize === "string" ? authorize : authorize.url;
    const codeVerifier = typeof authorize === "string" ? undefined : authorize.codeVerifier;
    oauthStates.set(state, {
      tenantDomain: ctx.tenantDomain,
      userId: req.session.userId!,
      socialAccountId: account.id,
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
      codeVerifier,
    });
    res.json({ authorizeUrl: url });
  });

  app.get("/api/social-accounts/oauth/callback", async (req, res) => {
    const { state, code, error: errParam, error_description } = req.query as Record<string, string | undefined>;
    if (!state || !oauthStates.has(state)) {
      return res.status(400).send("Invalid or expired OAuth state");
    }
    const ctx = oauthStates.get(state)!;
    oauthStates.delete(state);
    if (errParam) {
      return res.status(400).send(`OAuth error: ${escapeHtml(error_description || errParam)}`);
    }
    if (!code) return res.status(400).send("Missing authorization code");

    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, ctx.socialAccountId), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));
    if (!account) return res.status(404).send("Account not found");

    const publisher = getPublisher(account.platform);
    if (!publisher?.exchangeOAuthCode) {
      return res.status(400).send("Platform does not support OAuth");
    }
    try {
      const result = await publisher.exchangeOAuthCode(code, ctx.redirectUri, {
        tenantDomain: ctx.tenantDomain,
        codeVerifier: ctx.codeVerifier,
      });
      await db.update(socialAccounts).set({
        encryptedAccessToken: encryptSecret(result.accessToken),
        encryptedRefreshToken: result.refreshToken ? encryptSecret(result.refreshToken) : null,
        tokenExpiresAt: result.expiresAt ?? null,
        tokenScope: result.scope ?? null,
        authorMode: result.authorMode,
        authorUrn: result.authorUrn,
        // Persist the list of identities the user can publish as so the
        // author-picker UI and /linkedin/select-author endpoint have data
        // to work with without re-querying LinkedIn on every page load.
        availableAuthors: result.availableAuthors ?? null,
        accountId: result.accountId ?? account.accountId,
        accountName: result.accountName ?? account.accountName,
        profileUrl: result.profileUrl ?? account.profileUrl,
        connectedAt: new Date(),
        connectedBy: ctx.userId,
        lastPublishError: null,
        status: "active",
        updatedAt: new Date(),
      }).where(eq(socialAccounts.id, account.id));

      await db.insert(marketingAuditLog).values({
        tenantDomain: ctx.tenantDomain,
        userId: ctx.userId,
        action: "social_oauth_connect",
        entityType: "social_account",
        entityId: account.id,
        status: "ok",
        message: `Connected ${account.platform}`,
        details: { authorUrn: result.authorUrn },
      });
      res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:24px;text-align:center;">
        <h2>Connected!</h2>
        <p>${escapeHtml(account.platform)} account is now connected. You can close this window and return to Orbit.</p>
        <script>setTimeout(()=>{ try { window.close(); } catch{} window.location.href='/app/marketing/social-accounts'; }, 1500);</script>
      </body></html>`);
    } catch (err: any) {
      console.error("[OAuth Callback] Failed:", err.message);
      await db.insert(marketingAuditLog).values({
        tenantDomain: ctx.tenantDomain,
        userId: ctx.userId,
        action: "social_oauth_connect",
        entityType: "social_account",
        entityId: account.id,
        status: "error",
        message: err.message || "OAuth callback failed",
      });
      res.status(500).send(`OAuth callback failed: ${escapeHtml(err.message || "unknown")}`);
    }
  });

  app.post("/api/social-accounts/:id/disconnect", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, req.params.id), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));
    if (!account) return res.status(404).json({ error: "Account not found" });
    await db.update(socialAccounts).set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      tokenScope: null,
      authorMode: null,
      authorUrn: null,
      connectedAt: null,
      connectedBy: null,
      lastPublishError: null,
      updatedAt: new Date(),
    }).where(eq(socialAccounts.id, account.id));
    res.json({ success: true });
  });

  // ───── Publish now / attempts log ─────
  app.post("/api/generated-posts/:id/publish", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const [post] = await db.select().from(generatedPosts)
      .where(and(eq(generatedPosts.id, req.params.id), eq(generatedPosts.tenantDomain, ctx.tenantDomain)));
    if (!post) return res.status(404).json({ error: "Post not found" });
    // Approval gating — only approved or previously-failed posts can be
    // published. Drafts/rejected/already-published posts must not bypass
    // the review workflow.
    if (post.status !== "approved" && post.status !== "publish_failed") {
      return res.status(409).json({
        error: `Post must be approved before publishing (current status: ${post.status}).`,
        status: post.status,
      });
    }
    const result = await publishPostNow(post.id, req.session.userId!);
    if (!result.success) {
      return res.status(502).json({ error: result.errorMessage || "Publish failed" });
    }
    res.json({ success: true, publishedUrl: result.publishedUrl });
  });

  // ───── LinkedIn organization picker (author selection) ─────
  // Returns the available author identities (personal + admin orgs) the
  // user can publish as. The list is captured at OAuth time and cached on
  // the social_account row; this endpoint also supports a live-refresh
  // by re-querying LinkedIn's organizationAcls when ?refresh=1.
  app.get("/api/social-accounts/:id/linkedin/authors", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, req.params.id), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (account.platform !== "linkedin") {
      return res.status(400).json({ error: "Only LinkedIn accounts support author selection" });
    }
    if (req.query.refresh === "1" && account.encryptedAccessToken) {
      try {
        const accessToken = decryptSecret(account.encryptedAccessToken);
        const publisher = new LinkedInPublisher();
        const orgs = await publisher.fetchAdminOrganizations(accessToken);
        const personal = (account.availableAuthors ?? []).find(a => a.mode === "person")
          || (account.authorUrn?.startsWith("urn:li:person:")
            ? { mode: "person" as const, urn: account.authorUrn, name: account.accountName ?? "Personal" }
            : null);
        const refreshed = personal ? [personal, ...orgs] : orgs;
        await db.update(socialAccounts).set({
          availableAuthors: refreshed,
          updatedAt: new Date(),
        }).where(eq(socialAccounts.id, account.id));
        return res.json({ authors: refreshed, current: { mode: account.authorMode, urn: account.authorUrn } });
      } catch (err: any) {
        console.warn("[LinkedIn authors] refresh failed:", err?.message);
      }
    }
    res.json({
      authors: account.availableAuthors ?? [],
      current: { mode: account.authorMode, urn: account.authorUrn },
    });
  });

  // Switch which author identity this account publishes as. The new mode
  // and URN must match an entry in availableAuthors.
  app.post("/api/social-accounts/:id/linkedin/select-author", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const { authorUrn } = req.body ?? {};
    if (typeof authorUrn !== "string" || !authorUrn.startsWith("urn:li:")) {
      return res.status(400).json({ error: "authorUrn is required (urn:li:person:... or urn:li:organization:...)" });
    }
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, req.params.id), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));
    if (!account) return res.status(404).json({ error: "Account not found" });
    const candidate = (account.availableAuthors ?? []).find(a => a.urn === authorUrn);
    if (!candidate) {
      return res.status(400).json({ error: "Selected author is not in this account's available authors list" });
    }
    await db.update(socialAccounts).set({
      authorMode: candidate.mode,
      authorUrn: candidate.urn,
      accountName: candidate.name,
      updatedAt: new Date(),
    }).where(eq(socialAccounts.id, account.id));
    await db.insert(marketingAuditLog).values({
      tenantDomain: ctx.tenantDomain,
      userId: req.session.userId!,
      action: "social_author_change",
      entityType: "social_account",
      entityId: account.id,
      status: "ok",
      message: `Now publishing as ${candidate.name} (${candidate.mode})`,
      details: { authorUrn: candidate.urn, mode: candidate.mode },
    });
    res.json({ success: true, current: { mode: candidate.mode, urn: candidate.urn, name: candidate.name } });
  });

  // ───── Bluesky app-password connect (non-OAuth) ─────
  // Bluesky uses atproto app-passwords rather than OAuth. The user generates
  // an app password in their Bluesky settings, hands it to us, and we
  // validate by creating a session. The password is stored encrypted under
  // `encryptedAccessToken` because the publisher re-creates a session on
  // every publish.
  app.post("/api/social-accounts/:id/bluesky/connect", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const [account] = await db.select().from(socialAccounts)
      .where(and(eq(socialAccounts.id, req.params.id), eq(socialAccounts.tenantDomain, ctx.tenantDomain)));
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (account.platform !== "bluesky") {
      return res.status(400).json({ error: "This route is for Bluesky accounts only" });
    }
    const { identifier, appPassword } = req.body ?? {};
    if (typeof identifier !== "string" || typeof appPassword !== "string" || !identifier.trim() || !appPassword.trim()) {
      return res.status(400).json({ error: "identifier and appPassword are required" });
    }
    try {
      const { BlueskyPublisher } = await import("../services/social-publishers/bluesky");
      const publisher = new BlueskyPublisher();
      const result = await publisher.connectWithAppPassword(identifier, appPassword);
      await db.update(socialAccounts).set({
        encryptedAccessToken: encryptSecret(result.accessToken),
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        tokenScope: null,
        authorMode: result.authorMode,
        authorUrn: result.authorUrn,
        availableAuthors: result.availableAuthors ?? null,
        accountId: result.accountId ?? account.accountId,
        accountName: result.accountName ?? account.accountName,
        profileUrl: result.profileUrl ?? account.profileUrl,
        connectedAt: new Date(),
        connectedBy: req.session.userId!,
        lastPublishError: null,
        status: "active",
        updatedAt: new Date(),
      }).where(eq(socialAccounts.id, account.id));
      await db.insert(marketingAuditLog).values({
        tenantDomain: ctx.tenantDomain,
        userId: req.session.userId!,
        action: "social_oauth_connect",
        entityType: "social_account",
        entityId: account.id,
        status: "ok",
        message: "Connected Bluesky (app password)",
        details: { handle: result.accountName },
      });
      res.json({ success: true, accountName: result.accountName });
    } catch (err: any) {
      console.error("[Bluesky Connect] Failed:", err.message);
      await db.insert(marketingAuditLog).values({
        tenantDomain: ctx.tenantDomain,
        userId: req.session.userId!,
        action: "social_oauth_connect",
        entityType: "social_account",
        entityId: account.id,
        status: "error",
        message: err.message || "Bluesky connect failed",
      });
      res.status(400).json({ error: err.message || "Bluesky connect failed" });
    }
  });

  // NOTE: Per-tenant platform OAuth credentials have been removed. Social
  // platforms now use a single Synozur-owned OAuth app each (managed by a
  // Global Admin at Admin → Platform Credentials, see server/routes/admin.ts).
  // Tenants connect one-click from the Social Accounts page; they never
  // register their own app or paste credentials.

  app.get("/api/generated-posts/:id/publish-attempts", async (req, res) => {
    if (!await guardFeature(req, res, "directPublishing")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(socialPublishAttempts)
      .where(and(
        eq(socialPublishAttempts.postId, req.params.id),
        eq(socialPublishAttempts.tenantDomain, ctx.tenantDomain),
      ))
      .orderBy(desc(socialPublishAttempts.attemptedAt))
      .limit(20);
    res.json(rows);
  });

  // ───── Recipient Lists ─────
  app.get("/api/email-recipient-lists", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(emailRecipientLists)
      .where(and(
        eq(emailRecipientLists.tenantDomain, ctx.tenantDomain),
        eq(emailRecipientLists.marketId, ctx.marketId),
      ))
      .orderBy(desc(emailRecipientLists.createdAt));
    res.json(rows);
  });

  app.post("/api/email-recipient-lists", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const { name, description } = req.body ?? {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "Name is required" });
    const [row] = await db.insert(emailRecipientLists).values({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      name: name.trim(),
      description: description ?? null,
      createdBy: req.session.userId!,
    }).returning();
    res.status(201).json(row);
  });

  app.patch("/api/email-recipient-lists/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const updates: any = {};
    if (typeof req.body?.name === "string") updates.name = req.body.name.trim();
    if (typeof req.body?.description === "string") updates.description = req.body.description;
    updates.updatedAt = new Date();
    await db.update(emailRecipientLists).set(updates)
      .where(and(
        eq(emailRecipientLists.id, req.params.id),
        eq(emailRecipientLists.tenantDomain, ctx.tenantDomain),
      ));
    res.json({ success: true });
  });

  app.delete("/api/email-recipient-lists/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    await db.delete(emailRecipientLists)
      .where(and(
        eq(emailRecipientLists.id, req.params.id),
        eq(emailRecipientLists.tenantDomain, ctx.tenantDomain),
      ));
    res.json({ success: true });
  });

  // ───── HubSpot lists as send audiences ─────
  // Browse the tenant's HubSpot contact lists, annotated with any linked
  // Orbit segment (import status, last sync, member count).
  app.get("/api/marketing/hubspot-lists", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    try {
      const { listHubspotContactLists } = await import("../services/hubspot-integration");
      const { marketingSegments, marketingSegmentMembers } = await import("@shared/schema");
      const lists = await listHubspotContactLists(ctx.tenantDomain);

      const linked = await db
        .select()
        .from(marketingSegments)
        .where(and(
          eq(marketingSegments.tenantDomain, ctx.tenantDomain),
          eq(marketingSegments.source, "hubspot_list"),
        ));
      const memberCounts = linked.length > 0
        ? await db
            .select({
              segmentId: marketingSegmentMembers.segmentId,
              memberCount: sql<number>`count(*)::int`,
            })
            .from(marketingSegmentMembers)
            .where(inArray(marketingSegmentMembers.segmentId, linked.map(s => s.id)))
            .groupBy(marketingSegmentMembers.segmentId)
        : [];
      const countMap = new Map(memberCounts.map(c => [c.segmentId, Number(c.memberCount)]));
      const linkedByListId = new Map(linked.map(s => [s.hubspotListId, s]));

      res.json(lists.map(l => {
        const seg = linkedByListId.get(l.listId);
        return {
          ...l,
          linkedSegment: seg ? {
            id: seg.id,
            name: seg.name,
            syncStatus: seg.hubspotSyncStatus,
            syncError: seg.hubspotSyncError,
            lastSyncedAt: seg.lastHubspotSyncAt,
            memberCount: countMap.get(seg.id) ?? 0,
          } : null,
        };
      }));
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "Failed to fetch HubSpot lists" });
    }
  });

  // Import (or re-link) a HubSpot list as an Orbit segment. Creates/finds the
  // linked segment immediately and runs the membership sync through the job
  // queue; the client polls the segment's sync status via the browse endpoint.
  app.post("/api/marketing/hubspot-lists/:listId/import", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    try {
      const { listHubspotContactLists } = await import("../services/hubspot-integration");
      const { ensureHubspotListSegment, enqueueHubspotListSegmentSync } =
        await import("../services/hubspot-list-segment-service");

      // Validate the list exists in the tenant's HubSpot (also gets its name).
      const lists = await listHubspotContactLists(ctx.tenantDomain);
      const list = lists.find(l => l.listId === String(req.params.listId));
      if (!list) return res.status(404).json({ error: "HubSpot list not found" });

      const { segment, created } = await ensureHubspotListSegment({
        tenantDomain: ctx.tenantDomain,
        listId: list.listId,
        listName: list.name,
        createdBy: req.session.userId!,
      });

      // Kick off the sync in the background (job queue) — don't block the
      // request on a potentially large import.
      enqueueHubspotListSegmentSync(segment).catch(err =>
        console.warn(`[HubSpot List Segment] Import sync failed for ${segment.id}: ${err?.message ?? err}`));

      res.status(created ? 201 : 200).json({ segment, created, syncing: true });
    } catch (err: any) {
      const status = err?.status ?? 502;
      res.status(status).json({ error: err?.message || "Failed to import HubSpot list" });
    }
  });

  // Re-sync a linked segment's membership from HubSpot on demand.
  app.post("/api/marketing-segments/:id/hubspot-sync", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    try {
      const { marketingSegments } = await import("@shared/schema");
      const [segment] = await db
        .select()
        .from(marketingSegments)
        .where(and(
          eq(marketingSegments.id, req.params.id),
          eq(marketingSegments.tenantDomain, ctx.tenantDomain),
        ));
      if (!segment) return res.status(404).json({ error: "Segment not found" });
      if (segment.source !== "hubspot_list" || !segment.hubspotListId) {
        return res.status(400).json({ error: "Segment is not linked to a HubSpot list" });
      }
      const { enqueueHubspotListSegmentSync } = await import("../services/hubspot-list-segment-service");
      enqueueHubspotListSegmentSync(segment).catch(err =>
        console.warn(`[HubSpot List Segment] Manual sync failed for ${segment.id}: ${err?.message ?? err}`));
      res.status(202).json({ syncing: true, segmentId: segment.id });
    } catch (err: any) {
      const status = err?.status ?? 500;
      res.status(status).json({ error: err?.message || "Failed to start sync" });
    }
  });

  app.get("/api/email-recipient-lists/:id/recipients", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(emailRecipients)
      .where(and(
        eq(emailRecipients.listId, req.params.id),
        eq(emailRecipients.tenantDomain, ctx.tenantDomain),
      ))
      .orderBy(desc(emailRecipients.createdAt))
      .limit(2000);
    res.json(rows);
  });

  app.post("/api/email-recipient-lists/:id/recipients", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const [list] = await db.select().from(emailRecipientLists)
      .where(and(eq(emailRecipientLists.id, req.params.id), eq(emailRecipientLists.tenantDomain, ctx.tenantDomain)));
    if (!list) return res.status(404).json({ error: "List not found" });

    // Accept either { email, name } or { entries: "email,name\nemail2..." } CSV-ish.
    const incoming: Array<{ email: string; name: string | null }> = [];
    if (Array.isArray(req.body?.recipients)) {
      for (const r of req.body.recipients) {
        if (typeof r?.email === "string" && r.email.includes("@")) {
          incoming.push({ email: r.email.trim().toLowerCase(), name: typeof r.name === "string" ? r.name : null });
        }
      }
    } else if (typeof req.body?.bulkText === "string") {
      for (const line of req.body.bulkText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [emailRaw, nameRaw] = trimmed.split(",");
        if (emailRaw && emailRaw.includes("@")) {
          incoming.push({ email: emailRaw.trim().toLowerCase(), name: nameRaw?.trim() || null });
        }
      }
    } else if (typeof req.body?.email === "string" && req.body.email.includes("@")) {
      incoming.push({ email: req.body.email.trim().toLowerCase(), name: typeof req.body.name === "string" ? req.body.name : null });
    }
    if (incoming.length === 0) return res.status(400).json({ error: "No valid email addresses provided" });

    // Count only rows actually inserted by checking the returning() result
    // length — duplicates suppressed by onConflictDoNothing return zero rows.
    let inserted = 0;
    let skipped = 0;
    for (const r of incoming) {
      try {
        const result = await db.insert(emailRecipients).values({
          listId: list.id,
          tenantDomain: ctx.tenantDomain,
          email: r.email,
          name: r.name,
          status: "active",
        }).onConflictDoNothing().returning({ id: emailRecipients.id });
        if (result.length > 0) inserted += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
      }
    }
    // Recompute count.
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(emailRecipients)
      .where(eq(emailRecipients.listId, list.id));
    await db.update(emailRecipientLists).set({ recipientCount: c, updatedAt: new Date() })
      .where(eq(emailRecipientLists.id, list.id));
    res.status(201).json({ inserted, skipped, total: c });
  });

  // Update a recipient's name, email, and/or status.
  app.patch("/api/email-recipient-lists/:id/recipients/:rid", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);

    const [existing] = await db.select().from(emailRecipients).where(and(
      eq(emailRecipients.id, req.params.rid),
      eq(emailRecipients.listId, req.params.id),
      eq(emailRecipients.tenantDomain, ctx.tenantDomain),
    ));
    if (!existing) return res.status(404).json({ error: "Recipient not found" });

    const VALID_STATUSES = ["active", "unsubscribed", "bounced", "manual_remove"];
    const updates: Record<string, unknown> = {};

    if (typeof req.body?.name === "string") updates.name = req.body.name.trim() || null;
    if (req.body?.name === null) updates.name = null;

    if (typeof req.body?.email === "string") {
      const newEmail = req.body.email.trim().toLowerCase();
      if (!newEmail.includes("@")) return res.status(400).json({ error: "Invalid email address" });
      if (newEmail !== existing.email) {
        // Check uniqueness within the list.
        const [conflict] = await db.select({ id: emailRecipients.id }).from(emailRecipients)
          .where(and(
            eq(emailRecipients.listId, req.params.id),
            eq(emailRecipients.tenantDomain, ctx.tenantDomain),
            eq(emailRecipients.email, newEmail),
          ));
        if (conflict) return res.status(409).json({ error: "That email address is already in this list" });
        updates.email = newEmail;
      }
    }

    if (typeof req.body?.status === "string") {
      if (!VALID_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
      }
      updates.status = req.body.status;
    }

    if (Object.keys(updates).length === 0) return res.json(existing);

    const [updated] = await db.update(emailRecipients).set(updates)
      .where(and(
        eq(emailRecipients.id, req.params.rid),
        eq(emailRecipients.listId, req.params.id),
        eq(emailRecipients.tenantDomain, ctx.tenantDomain),
      ))
      .returning();
    res.json(updated);
  });

  app.delete("/api/email-recipient-lists/:id/recipients/:rid", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    await db.delete(emailRecipients)
      .where(and(
        eq(emailRecipients.id, req.params.rid),
        eq(emailRecipients.listId, req.params.id),
        eq(emailRecipients.tenantDomain, ctx.tenantDomain),
      ));
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(emailRecipients)
      .where(eq(emailRecipients.listId, req.params.id));
    await db.update(emailRecipientLists).set({ recipientCount: c, updatedAt: new Date() })
      .where(eq(emailRecipientLists.id, req.params.id));
    res.json({ success: true, total: c });
  });

  // ───── Suppressions ─────
  app.get("/api/email-suppressions", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(emailSuppressions)
      .where(eq(emailSuppressions.tenantDomain, ctx.tenantDomain))
      .orderBy(desc(emailSuppressions.createdAt))
      .limit(500);
    res.json(rows);
  });

  app.post("/api/email-suppressions", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const { email, reason, notes } = req.body ?? {};
    if (typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    const [row] = await db.insert(emailSuppressions).values({
      tenantDomain: ctx.tenantDomain,
      email: email.trim().toLowerCase(),
      reason: reason || "manual",
      source: "admin_ui",
      notes: notes ?? null,
    }).onConflictDoNothing().returning();
    res.status(201).json(row || { success: true });
  });

  app.delete("/api/email-suppressions/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    await db.delete(emailSuppressions)
      .where(and(eq(emailSuppressions.id, req.params.id), eq(emailSuppressions.tenantDomain, ctx.tenantDomain)));
    res.json({ success: true });
  });

  // ───── Sender Identities ─────
  app.get("/api/email-sender-identities", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(emailSenderIdentities)
      .where(eq(emailSenderIdentities.tenantDomain, ctx.tenantDomain))
      .orderBy(desc(emailSenderIdentities.isDefault), emailSenderIdentities.name);
    res.json(rows);
  });

  app.post("/api/email-sender-identities", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const { name, email, replyToEmail, isDefault } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    // If marking default, clear any existing default first.
    if (isDefault) {
      await db.update(emailSenderIdentities).set({ isDefault: false })
        .where(eq(emailSenderIdentities.tenantDomain, ctx.tenantDomain));
    }
    const [row] = await db.insert(emailSenderIdentities).values({
      tenantDomain: ctx.tenantDomain,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      replyToEmail: typeof replyToEmail === "string" && replyToEmail.includes("@") ? replyToEmail.trim().toLowerCase() : null,
      isDefault: isDefault === true,
    }).returning();
    res.status(201).json(row);
  });

  app.patch("/api/email-sender-identities/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const [existing] = await db.select().from(emailSenderIdentities)
      .where(and(eq(emailSenderIdentities.id, req.params.id), eq(emailSenderIdentities.tenantDomain, ctx.tenantDomain)));
    if (!existing) return res.status(404).json({ error: "Sender identity not found" });
    const updates: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
    if (typeof req.body?.email === "string" && req.body.email.includes("@")) updates.email = req.body.email.trim().toLowerCase();
    if (typeof req.body?.replyToEmail === "string") {
      updates.replyToEmail = req.body.replyToEmail.includes("@") ? req.body.replyToEmail.trim().toLowerCase() : null;
    }
    if (req.body?.replyToEmail === null) updates.replyToEmail = null;
    if (req.body?.isDefault === true) {
      await db.update(emailSenderIdentities).set({ isDefault: false })
        .where(and(eq(emailSenderIdentities.tenantDomain, ctx.tenantDomain), ne(emailSenderIdentities.id, req.params.id)));
      updates.isDefault = true;
    } else if (req.body?.isDefault === false) {
      updates.isDefault = false;
    }
    if (Object.keys(updates).length === 0) return res.json(existing);
    const [updated] = await db.update(emailSenderIdentities).set(updates)
      .where(and(eq(emailSenderIdentities.id, req.params.id), eq(emailSenderIdentities.tenantDomain, ctx.tenantDomain)))
      .returning();
    res.json(updated);
  });

  app.delete("/api/email-sender-identities/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    await db.delete(emailSenderIdentities)
      .where(and(eq(emailSenderIdentities.id, req.params.id), eq(emailSenderIdentities.tenantDomain, ctx.tenantDomain)));
    res.json({ success: true });
  });

  // ───── Sends (Sends tab) ─────
  // Project the columns the Sends UI expects: include the email subject from
  // generated_emails and alias recipient_count → totalRecipients so the
  // client component can render without an extra round-trip.
  app.get("/api/email-sends", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const rows = await db.select({
      id: emailSends.id,
      emailId: emailSends.generatedEmailId,
      subject: generatedEmails.subject,
      listId: emailSends.listId,
      testRecipient: emailSends.testRecipient,
      status: emailSends.status,
      scheduledAt: emailSends.scheduledAt,
      totalRecipients: emailSends.recipientCount,
      sentCount: emailSends.sentCount,
      failedCount: emailSends.failedCount,
      bounceCount: emailSends.bounceCount,
      unsubscribeCount: emailSends.unsubscribeCount,
      spamCount: emailSends.spamCount,
      openCount: emailSends.openCount,
      clickCount: emailSends.clickCount,
      deliveredCount: emailSends.deliveredCount,
      errorMessage: emailSends.errorMessage,
      startedAt: emailSends.startedAt,
      completedAt: emailSends.completedAt,
      createdAt: emailSends.createdAt,
    }).from(emailSends)
      .leftJoin(generatedEmails, eq(generatedEmails.id, emailSends.generatedEmailId))
      .where(and(
        eq(emailSends.tenantDomain, ctx.tenantDomain),
        eq(emailSends.marketId, ctx.marketId),
      ))
      .orderBy(desc(emailSends.createdAt))
      .limit(100);
    res.json(rows);
  });

  app.get("/api/email-sends/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    // Project the same shape the list endpoint returns so the drill-down
    // dialog can reuse the EmailSend interface (subject, totalRecipients,
    // openCount, …) without remapping raw column names.
    const [send] = await db.select({
      id: emailSends.id,
      emailId: emailSends.generatedEmailId,
      subject: generatedEmails.subject,
      listId: emailSends.listId,
      testRecipient: emailSends.testRecipient,
      status: emailSends.status,
      scheduledAt: emailSends.scheduledAt,
      totalRecipients: emailSends.recipientCount,
      sentCount: emailSends.sentCount,
      failedCount: emailSends.failedCount,
      bounceCount: emailSends.bounceCount,
      unsubscribeCount: emailSends.unsubscribeCount,
      spamCount: emailSends.spamCount,
      openCount: emailSends.openCount,
      clickCount: emailSends.clickCount,
      deliveredCount: emailSends.deliveredCount,
      errorMessage: emailSends.errorMessage,
      startedAt: emailSends.startedAt,
      completedAt: emailSends.completedAt,
      createdAt: emailSends.createdAt,
    }).from(emailSends)
      .leftJoin(generatedEmails, eq(generatedEmails.id, emailSends.generatedEmailId))
      .where(and(eq(emailSends.id, req.params.id), eq(emailSends.tenantDomain, ctx.tenantDomain)));
    if (!send) return res.status(404).json({ error: "Send not found" });
    const recipients = await db.select({
      id: emailSendRecipients.id,
      email: emailSendRecipients.email,
      name: emailSendRecipients.name,
      status: emailSendRecipients.status,
      suppressionReason: emailSendRecipients.suppressionReason,
      errorMessage: emailSendRecipients.errorMessage,
      sentAt: emailSendRecipients.sentAt,
      deliveredAt: emailSendRecipients.deliveredAt,
      bouncedAt: emailSendRecipients.bouncedAt,
      unsubscribedAt: emailSendRecipients.unsubscribedAt,
      openedAt: emailSendRecipients.openedAt,
      clickedAt: emailSendRecipients.clickedAt,
      openCount: emailSendRecipients.openCount,
      clickCount: emailSendRecipients.clickCount,
      hubspotContactId: emailSendRecipients.hubspotContactId,
      hsSyncStatus: emailSendRecipients.hsSyncStatus,
    }).from(emailSendRecipients)
      .where(eq(emailSendRecipients.sendId, send.id))
      .orderBy(emailSendRecipients.email)
      .limit(500);
    // HubSpot sync reconciliation summary (Phase 4): how many recipients
    // resolved to a contact vs unmatched/pending/errored.
    const syncRows = await db.select({
      status: emailSendRecipients.hsSyncStatus,
      count: sql<number>`count(*)::int`,
    }).from(emailSendRecipients)
      .where(eq(emailSendRecipients.sendId, send.id))
      .groupBy(emailSendRecipients.hsSyncStatus);
    const hubspotSync = { resolved: 0, skipped: 0, pending: 0, error: 0 };
    for (const row of syncRows) {
      const key = (row.status ?? "pending") as keyof typeof hubspotSync;
      if (key in hubspotSync) hubspotSync[key] += Number(row.count);
      else hubspotSync.pending += Number(row.count);
    }
    // Count recipients suppressed as active prospects for the send summary.
    const [prospectSuppressedRow] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(emailSendRecipients)
      .where(and(
        eq(emailSendRecipients.sendId, send.id),
        eq(emailSendRecipients.suppressionReason, "active_prospect"),
      ));
    const suppressedProspectCount = Number(prospectSuppressedRow?.count ?? 0);
    // Flag recipients who are active sales prospects (not replied/dormant) so
    // the marketing team gets the same cross-awareness the sales rep has.
    const recipientEmails = recipients.map(r => r.email).filter(Boolean) as string[];
    let activeProspectEmailSet = new Set<string>();
    if (recipientEmails.length > 0) {
      const activeProspectRows = await db
        .select({ email: prospects.email })
        .from(prospects)
        .where(and(
          eq(prospects.tenantDomain, ctx.tenantDomain),
          inArray(prospects.email, recipientEmails),
          notInArray(prospects.status, ["replied", "dormant"]),
        ));
      for (const p of activeProspectRows) {
        if (p.email) activeProspectEmailSet.add(p.email.toLowerCase());
      }
    }
    const recipientsWithProspectFlag = recipients.map(r => ({
      ...r,
      isActiveProspect: r.email ? activeProspectEmailSet.has(r.email.toLowerCase()) : false,
    }));
    res.json({ ...send, recipients: recipientsWithProspectFlag, hubspotSync, suppressedProspectCount });
  });

  // Prospect check — UI calls this when a list is selected so we can warn the
  // operator if any recipients are currently in an active sales cadence.
  // Active prospect = status NOT IN ('replied', 'dormant').
  // Read-only; no state changes.
  app.post("/api/email-prospect-check", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const { listId } = req.body ?? {};
    if (!listId || typeof listId !== "string") {
      return res.status(400).json({ error: "listId is required" });
    }
    try {
      // Load all active recipients from the list.
      const recipients = await db
        .select({ email: emailRecipients.email })
        .from(emailRecipients)
        .where(and(
          eq(emailRecipients.listId, listId),
          eq(emailRecipients.tenantDomain, ctx.tenantDomain),
          eq(emailRecipients.status, "active"),
        ))
        .limit(5000);
      if (recipients.length === 0) {
        return res.json({ count: 0, emails: [] });
      }
      const candidateEmails = recipients.map(r => r.email.trim().toLowerCase());
      const activeProspects = await db
        .select({
          email: prospects.email,
          name: prospects.name,
          companyName: prospects.companyName,
          status: prospects.status,
        })
        .from(prospects)
        .where(and(
          eq(prospects.tenantDomain, ctx.tenantDomain),
          inArray(prospects.email, candidateEmails),
          notInArray(prospects.status, ["replied", "dormant"]),
        ));
      res.json({
        count: activeProspects.length,
        emails: activeProspects.map(p => p.email),
        prospects: activeProspects.map(p => ({
          email: p.email,
          name: p.name,
          companyName: p.companyName,
          status: p.status,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to check prospects" });
    }
  });

  // Pre-send suppression preview — UI calls this when the operator selects a
  // list so we can surface "X deliverable / Y suppressed (with reasons)"
  // before the user confirms the send. Read-only; no state changes.
  app.get("/api/email-recipient-lists/:listId/deliverability", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    try {
      const preview = await previewListDeliverability({
        tenantDomain: ctx.tenantDomain,
        listId: req.params.listId,
      });
      res.json(preview);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to preview deliverability" });
    }
  });

  // ── Mark an email as sent externally (e.g. via HubSpot) ───────────────────
  app.post("/api/generated-emails/:id/mark-sent", async (req, res) => {
    if (!await guardFeature(req, res, "emailNewsletters")) return;
    try {
      const ctx = await getRequestContext(req);
      const [email] = await db.select().from(generatedEmails)
        .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
      if (!email) return res.status(404).json({ error: "Email not found" });
      const { sentAt: sentAtRaw, hubspotEmailId, hubspotEmailUrl } = req.body ?? {};
      const sentAt = sentAtRaw ? new Date(sentAtRaw) : (email.sentAt ?? new Date());
      // Optional link to the HubSpot marketing email this was sent as.
      // Accept a pasted URL and/or a raw numeric id; derive the id from the
      // URL when possible (e.g. .../marketing-email/12345/... or ?emailId=).
      let hsId: string | null = typeof hubspotEmailId === "string" && /^\d{1,20}$/.test(hubspotEmailId.trim()) ? hubspotEmailId.trim() : null;
      // Server-side URL validation: only persist HTTPS links on HubSpot-owned
      // hosts. A pasted javascript:/data: URL must never reach an <a href>.
      let hsUrl: string | null = null;
      if (typeof hubspotEmailUrl === "string" && hubspotEmailUrl.trim()) {
        try {
          const u = new URL(hubspotEmailUrl.trim());
          const hostOk = u.hostname === "hubspot.com" || u.hostname.endsWith(".hubspot.com");
          if (u.protocol !== "https:" || !hostOk) {
            return res.status(400).json({ error: "The HubSpot link must be an https:// URL on a hubspot.com domain." });
          }
          hsUrl = u.toString().slice(0, 2000);
        } catch {
          return res.status(400).json({ error: "The HubSpot link is not a valid URL." });
        }
      }
      if (!hsId && hsUrl) {
        const m = hsUrl.match(/(?:marketing-email|email)\/(?:[a-z-]+\/)?(\d{5,})/i) ?? hsUrl.match(/[?&]emailId=(\d+)/i);
        if (m) hsId = m[1];
      }
      // Cancel any not-yet-delivered Orbit (SendGrid) sends for this email so an
      // external "already sent via HubSpot" flag can't race a queued delivery
      // into a duplicate. In-flight ("sending") rows are left alone — they are
      // already being delivered and terminalize on their own.
      const cancelled = await db.update(emailSends)
        .set({ status: "failed", errorMessage: "Cancelled — email was marked as sent externally (e.g. via HubSpot).", completedAt: new Date() })
        .where(and(
          eq(emailSends.generatedEmailId, email.id),
          eq(emailSends.tenantDomain, ctx.tenantDomain),
          inArray(emailSends.status, ["pending", "queued"]),
        ))
        .returning({ id: emailSends.id });
      await db.update(generatedEmails)
        .set({
          status: "sent", sentAt, updatedAt: new Date(),
          ...(hsId ? { hubspotEmailId: hsId } : {}),
          ...(hsUrl ? { hubspotEmailUrl: hsUrl } : {}),
        })
        .where(and(eq(generatedEmails.id, email.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
      res.json({ ok: true, sentAt: sentAt.toISOString(), cancelledQueuedSends: cancelled.length });
    } catch (err: any) {
      console.error("[mark-sent]", err.message);
      res.status(500).json({ error: err.message || "Failed to mark email as sent" });
    }
  });

  app.post("/api/generated-emails/:id/send", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const [email] = await db.select().from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });

    const { listId, segmentId, testRecipient, scheduledAt, trackOpens, trackClicks, excludeActiveProspects, senderIdentityId, subscriptionTypeIds } = req.body ?? {};
    if (!listId && !segmentId && !testRecipient) {
      return res.status(400).json({ error: "Either listId, segmentId, or testRecipient is required" });
    }

    // Validate segmentId belongs to this tenant before dispatching.
    if (segmentId && !testRecipient) {
      const { marketingSegments } = await import("@shared/schema");
      const [seg] = await db.select({ id: marketingSegments.id })
        .from(marketingSegments)
        .where(and(eq(marketingSegments.id, segmentId), eq(marketingSegments.tenantDomain, ctx.tenantDomain)));
      if (!seg) return res.status(404).json({ error: "Segment not found" });
    }

    // Approval gating — only approved emails (or already-sent ones being
    // re-sent to a different list) may be dispatched. Test sends to the
    // creator are exempt so reviewers can preview without a state change.
    const allowedStatuses = new Set(["approved", "sent"]);
    if (!testRecipient && !allowedStatuses.has(email.status)) {
      return res.status(409).json({
        error: `Email must be approved before sending (current status: ${email.status}).`,
        status: email.status,
      });
    }

    let scheduledAtDate: Date | null = null;
    if (scheduledAt) {
      const d = new Date(scheduledAt);
      if (isNaN(d.getTime())) return res.status(400).json({ error: "Invalid scheduledAt" });
      scheduledAtDate = d;
    }

    try {
      const result = await dispatchEmailSend({
        tenantDomain: ctx.tenantDomain,
        marketId: ctx.marketId,
        email,
        listId: listId ?? null,
        segmentId: segmentId ?? null,
        testRecipient: testRecipient ?? null,
        createdBy: req.session.userId!,
        baseUrl: getBaseUrl(req),
        scheduledAt: scheduledAtDate,
        trackOpens: typeof trackOpens === "boolean" ? trackOpens : undefined,
        trackClicks: typeof trackClicks === "boolean" ? trackClicks : undefined,
        excludeActiveProspects: excludeActiveProspects === true,
        senderIdentityId: typeof senderIdentityId === "string" ? senderIdentityId : null,
        subscriptionTypeIds: Array.isArray(subscriptionTypeIds) ? subscriptionTypeIds.filter((x: any) => typeof x === "string") : [],
      });
      res.status(201).json(result);
    } catch (err: any) {
      const status = err?.status ?? 500;
      res.status(status).json({ error: err?.message || "Failed to dispatch send" });
    }
  });

  // ───── Subscription Types ─────

  app.get("/api/email-subscription-types", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(emailSubscriptionTypes)
      .where(eq(emailSubscriptionTypes.tenantDomain, ctx.tenantDomain))
      .orderBy(emailSubscriptionTypes.sortOrder, emailSubscriptionTypes.name);
    res.json(rows);
  });

  app.post("/api/email-subscription-types", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const caller = await storage.getUser(req.session.userId!);
    if (!caller || !["Global Admin", "Domain Admin"].includes(caller.role)) {
      return res.status(403).json({ error: "Domain Admin access required" });
    }
    const { name, description, isTransactional, hubspotTypeId, isEnabled, sortOrder } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    try {
      const [row] = await db.insert(emailSubscriptionTypes).values({
        tenantDomain: ctx.tenantDomain,
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        isTransactional: isTransactional === true,
        hubspotTypeId: hubspotTypeId ? String(hubspotTypeId).trim() : null,
        isEnabled: isEnabled !== false,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        createdBy: req.session.userId!,
      }).returning();
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(409).json({ error: "A subscription type with that name already exists" });
      throw err;
    }
  });

  app.patch("/api/email-subscription-types/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const caller = await storage.getUser(req.session.userId!);
    if (!caller || !["Global Admin", "Domain Admin"].includes(caller.role)) {
      return res.status(403).json({ error: "Domain Admin access required" });
    }
    const { name, description, isTransactional, hubspotTypeId, isEnabled, sortOrder } = req.body ?? {};
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = String(name).trim();
    if (description !== undefined) update.description = description ? String(description).trim() : null;
    if (isTransactional !== undefined) update.isTransactional = isTransactional === true;
    if (hubspotTypeId !== undefined) update.hubspotTypeId = hubspotTypeId ? String(hubspotTypeId).trim() : null;
    if (isEnabled !== undefined) update.isEnabled = isEnabled !== false;
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
    const [updated] = await db.update(emailSubscriptionTypes).set(update as any)
      .where(and(
        eq(emailSubscriptionTypes.id, req.params.id),
        eq(emailSubscriptionTypes.tenantDomain, ctx.tenantDomain),
      )).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/email-subscription-types/:id", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const caller = await storage.getUser(req.session.userId!);
    if (!caller || !["Global Admin", "Domain Admin"].includes(caller.role)) {
      return res.status(403).json({ error: "Domain Admin access required" });
    }
    const deleted = await db.delete(emailSubscriptionTypes)
      .where(and(
        eq(emailSubscriptionTypes.id, req.params.id),
        eq(emailSubscriptionTypes.tenantDomain, ctx.tenantDomain),
      )).returning({ id: emailSubscriptionTypes.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  // ───── Audit log ─────
  app.get("/api/marketing-audit-log", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const rows = await db.select().from(marketingAuditLog)
      .where(eq(marketingAuditLog.tenantDomain, ctx.tenantDomain))
      .orderBy(desc(marketingAuditLog.createdAt))
      .limit(200);
    res.json(rows);
  });

  // ───── A/B Test variant management ──────────────────────────────────────

  /** List variants for an email (currently only B). */
  app.get("/api/generated-emails/:id/variants", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const [email] = await db.select({ id: generatedEmails.id }).from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });
    const variants = await db.select().from(emailCampaignVariants)
      .where(eq(emailCampaignVariants.generatedEmailId, req.params.id));
    res.json(variants);
  });

  /** Create or update the B variant. */
  app.put("/api/generated-emails/:id/variants/B", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const [email] = await db.select().from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });
    const { subject, htmlBody, textBody } = req.body ?? {};
    if (!subject || typeof subject !== "string") {
      return res.status(400).json({ error: "subject is required" });
    }
    const [existing] = await db.select({ id: emailCampaignVariants.id }).from(emailCampaignVariants)
      .where(and(
        eq(emailCampaignVariants.generatedEmailId, req.params.id),
        eq(emailCampaignVariants.variantLabel, "B"),
      ));
    if (existing) {
      const [updated] = await db.update(emailCampaignVariants).set({
        subject,
        htmlBody: htmlBody ?? "",
        textBody: textBody ?? null,
        updatedAt: new Date(),
      }).where(eq(emailCampaignVariants.id, existing.id)).returning();
      return res.json(updated);
    }
    const [created] = await db.insert(emailCampaignVariants).values({
      generatedEmailId: req.params.id,
      tenantDomain: ctx.tenantDomain,
      variantLabel: "B",
      subject,
      htmlBody: htmlBody ?? "",
      textBody: textBody ?? null,
    }).returning();
    res.status(201).json(created);
  });

  /** Delete the B variant (also disables A/B on the parent email). */
  app.delete("/api/generated-emails/:id/variants/B", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const [email] = await db.select({ id: generatedEmails.id }).from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });
    await db.delete(emailCampaignVariants)
      .where(and(
        eq(emailCampaignVariants.generatedEmailId, req.params.id),
        eq(emailCampaignVariants.variantLabel, "B"),
      ));
    await db.update(generatedEmails).set({
      abTestEnabled: false,
      updatedAt: new Date(),
    }).where(eq(generatedEmails.id, req.params.id));
    res.json({ ok: true });
  });

  /** Update A/B test configuration on the email (split %, metric, hours). */
  app.patch("/api/generated-emails/:id/ab-config", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const [email] = await db.select().from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });
    const { abTestEnabled, abTestSplit, abWinnerMetric, abEvaluationHours } = req.body ?? {};
    const patch: Partial<typeof email> = { updatedAt: new Date() } as any;
    if (typeof abTestEnabled === "boolean") (patch as any).abTestEnabled = abTestEnabled;
    if (typeof abTestSplit === "number") (patch as any).abTestSplit = Math.max(5, Math.min(49, abTestSplit));
    if (abWinnerMetric === "open_rate" || abWinnerMetric === "click_rate") (patch as any).abWinnerMetric = abWinnerMetric;
    if (typeof abEvaluationHours === "number" && abEvaluationHours >= 1) (patch as any).abEvaluationHours = abEvaluationHours;
    const [updated] = await db.update(generatedEmails).set(patch as any).where(eq(generatedEmails.id, req.params.id)).returning();
    res.json(updated);
  });

  /** Get A/B test results (open/click rates per variant). */
  app.get("/api/generated-emails/:id/ab-results", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const [email] = await db.select().from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });

    // Scope to the most recent test run: find the holdback row (one per run)
    // ordered by creation time and use its abTestRunId to pull the A/B sends.
    const [latestHoldback] = await db.select({ runId: emailSends.abTestRunId })
      .from(emailSends)
      .where(and(
        eq(emailSends.generatedEmailId, req.params.id),
        eq(emailSends.isAbHoldback, true),
        sql`${emailSends.abTestRunId} IS NOT NULL`,
      ))
      .orderBy(desc(emailSends.createdAt))
      .limit(1);

    const sends = latestHoldback?.runId
      ? await db.select().from(emailSends)
          .where(and(
            eq(emailSends.abTestRunId, latestHoldback.runId),
            eq(emailSends.isAbHoldback, false),
            sql`${emailSends.abVariantLabel} IS NOT NULL`,
          ))
      : [];

    const sendA = sends.find(s => s.abVariantLabel === "A");
    const sendB = sends.find(s => s.abVariantLabel === "B");
    const [bVariant] = await db.select({ subject: emailCampaignVariants.subject }).from(emailCampaignVariants)
      .where(and(
        eq(emailCampaignVariants.generatedEmailId, req.params.id),
        eq(emailCampaignVariants.variantLabel, "B"),
      ));
    res.json({
      abTestEnabled: email.abTestEnabled,
      abWinnerMetric: email.abWinnerMetric ?? "open_rate",
      abEvaluationHours: email.abEvaluationHours,
      abTestSplit: email.abTestSplit,
      winnerVariantLabel: email.abWinnerVariantLabel ?? null,
      winnerDeclaredAt: email.abWinnerDeclaredAt ?? null,
      variantA: sendA ? {
        subjectLine: email.subject,
        recipientCount: sendA.recipientCount,
        openCount: sendA.openCount,
        clickCount: sendA.clickCount,
        openRate: sendA.recipientCount > 0 ? sendA.openCount / sendA.recipientCount : 0,
        clickRate: sendA.recipientCount > 0 ? sendA.clickCount / sendA.recipientCount : 0,
        status: sendA.status,
      } : null,
      variantB: sendB ? {
        subjectLine: bVariant?.subject ?? "",
        recipientCount: sendB.recipientCount,
        openCount: sendB.openCount,
        clickCount: sendB.clickCount,
        openRate: sendB.recipientCount > 0 ? sendB.openCount / sendB.recipientCount : 0,
        clickRate: sendB.recipientCount > 0 ? sendB.clickCount / sendB.recipientCount : 0,
        status: sendB.status,
      } : null,
    });
  });

  /** Preview email with personalization tokens resolved from a sample contact. */
  app.post("/api/generated-emails/:id/preview-tokens", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const ctx = await getRequestContext(req);
    const [email] = await db.select().from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });
    const { contactId, variant } = req.body ?? {};
    let subject = email.subject;
    let htmlBody = email.htmlBody;
    if (variant === "B") {
      const [bVariant] = await db.select().from(emailCampaignVariants)
        .where(and(
          eq(emailCampaignVariants.generatedEmailId, req.params.id),
          eq(emailCampaignVariants.variantLabel, "B"),
        ));
      if (bVariant) { subject = bVariant.subject; htmlBody = bVariant.htmlBody; }
    }
    // Resolve tokens — if no contactId use synthetic example values
    const resolvedSubject = await resolveTokensPreview(subject, ctx.tenantDomain, contactId ?? null);
    const resolvedHtml = await resolveTokensPreview(htmlBody, ctx.tenantDomain, contactId ?? null);
    // Fetch sample contact for display
    let sampleContact: any = null;
    if (contactId) {
      const [c] = await db.select({ email: marketingContacts.email, firstName: marketingContacts.firstName, company: marketingContacts.company })
        .from(marketingContacts)
        .where(and(eq(marketingContacts.id, contactId), eq(marketingContacts.tenantDomain, ctx.tenantDomain)));
      sampleContact = c ?? null;
    }
    res.json({ subject: resolvedSubject, htmlBody: resolvedHtml, sampleContact, knownTokens: KNOWN_TOKENS });
  });

  /** List available personalization tokens (for the token picker). */
  app.get("/api/email-personalization-tokens", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    res.json(KNOWN_TOKENS);
  });
}
