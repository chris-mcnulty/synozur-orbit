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
  emailRecipientLists,
  emailRecipients,
  emailSuppressions,
  emailSends,
  emailSendRecipients,
  emailSenderIdentities,
  marketingAuditLog,
  prospects,
} from "@shared/schema";
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

/** Hosted single-subscription preference center page. */
function preferenceCenterHtml(token: string, email: string, subscribed: boolean, justSaved = false): string {
  const action = subscribed ? "unsubscribe" : "resubscribe";
  const buttonLabel = subscribed ? "Unsubscribe from marketing emails" : "Resubscribe to marketing emails";
  const statusLine = subscribed
    ? "You are currently <strong>subscribed</strong> to marketing emails."
    : "You are currently <strong>unsubscribed</strong> from marketing emails.";
  const saved = justSaved
    ? `<p style="color:#16a34a;font-size:14px;">Your preferences have been updated.</p>`
    : "";
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:24px;">
    <h2 style="margin-bottom:4px;">Email preferences</h2>
    <p style="color:#666;font-size:14px;">${email}</p>
    ${saved}
    <p style="font-size:15px;">${statusLine}</p>
    <form method="POST" action="/p/${encodeURIComponent(token)}">
      <input type="hidden" name="action" value="${action}" />
      <button style="background:${subscribed ? "#7c3aed" : "#16a34a"};color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;" type="submit">${buttonLabel}</button>
    </form>
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

        await db.insert(emailSuppressions).values({
          tenantDomain: recipientRow.tenantDomain,
          email: recipientRow.email,
          reason: "unsubscribe",
          source: "public_unsub",
        }).onConflictDoNothing();

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
        // Phase 3: mirror the opt-out to HubSpot subscription preferences.
        pushUnsubscribe(recipientRow.tenantDomain, recipientRow.email).catch(() => {});
      }
    } catch (err: any) {
      console.error("[Unsubscribe] Failed:", err.message);
    }
    res.status(200).send(`<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:24px;text-align:center;"><h2>You're unsubscribed</h2><p>You won't receive any more emails from this campaign.</p></body></html>`);
  });

  // Preference center (Phase 3) — a richer hosted page than the one-click
  // /u/:token. Single "Marketing" subscription in v1: lets a recipient see
  // their status and unsubscribe or resubscribe. Reuses the per-send token.
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
          eq(emailSuppressions.email, row.email),
        ));
      const subscribed = !sup;
      res.status(200).send(preferenceCenterHtml(req.params.token, escapeHtml(row.email), subscribed));
    } catch (err: any) {
      console.error("[Preferences] Load failed:", err?.message);
      res.status(500).send("Could not load your preferences");
    }
  });

  app.post("/p/:token", async (req, res) => {
    const decoded = verifyUnsubscribeToken(req.params.token);
    if (!decoded) return res.status(400).send("Invalid preferences link");
    const action = String((req.body?.action ?? "")).toLowerCase();
    try {
      const [row] = await db.select().from(emailSendRecipients)
        .where(eq(emailSendRecipients.unsubscribeToken, req.params.token));
      if (!row) return res.status(404).send("Preferences record not found");

      if (action === "unsubscribe") {
        await db.insert(emailSuppressions).values({
          tenantDomain: row.tenantDomain,
          email: row.email,
          reason: "unsubscribe",
          source: "preference_center",
        }).onConflictDoNothing();
        await db.update(emailRecipients).set({ status: "unsubscribed" })
          .where(and(eq(emailRecipients.tenantDomain, row.tenantDomain), eq(emailRecipients.email, row.email)));
        if (row.status !== "unsubscribed" && !row.unsubscribedAt) {
          await db.update(emailSendRecipients).set({ status: "unsubscribed", unsubscribedAt: new Date() })
            .where(and(eq(emailSendRecipients.id, row.id), ne(emailSendRecipients.status, "unsubscribed")));
          await db.update(emailSends).set({ unsubscribeCount: sql`${emailSends.unsubscribeCount} + 1` })
            .where(eq(emailSends.id, row.sendId));
        }
        await db.insert(marketingAuditLog).values({
          tenantDomain: row.tenantDomain, action: "email_unsubscribe",
          entityType: "email_send_recipient", entityId: row.id, status: "ok",
          message: "Preference-center unsubscribe", details: { email: row.email, sendId: row.sendId },
        });
        await pushRecipientTimeline(row, "email_unsubscribed", {}, new Date());
        pushUnsubscribe(row.tenantDomain, row.email).catch(() => {});
      } else if (action === "resubscribe") {
        // User-initiated opt-in. Clear local suppression; HubSpot stays
        // authoritative — if it blocks the resubscribe, the next pre-send
        // consent pull re-suppresses them.
        await db.delete(emailSuppressions).where(and(
          eq(emailSuppressions.tenantDomain, row.tenantDomain),
          eq(emailSuppressions.email, row.email),
          eq(emailSuppressions.reason, "unsubscribe"),
        ));
        await db.update(emailRecipients).set({ status: "active" })
          .where(and(eq(emailRecipients.tenantDomain, row.tenantDomain), eq(emailRecipients.email, row.email)));
        await db.insert(marketingAuditLog).values({
          tenantDomain: row.tenantDomain, action: "email_resubscribe",
          entityType: "email_send_recipient", entityId: row.id, status: "ok",
          message: "Preference-center resubscribe", details: { email: row.email, sendId: row.sendId },
        });
        pushSubscribe(row.tenantDomain, row.email).catch(() => {});
      }
      // Recompute the real subscribed state from the suppression table rather
      // than assuming the action succeeded — the mutation can be a no-op (e.g.
      // still suppressed for a different reason), so the page must reflect
      // whether the recipient is actually deliverable now.
      const [stillSuppressed] = await db.select({ id: emailSuppressions.id }).from(emailSuppressions)
        .where(and(
          eq(emailSuppressions.tenantDomain, row.tenantDomain),
          eq(emailSuppressions.email, row.email),
        ));
      const subscribed = !stillSuppressed;
      res.status(200).send(preferenceCenterHtml(req.params.token, escapeHtml(row.email), subscribed, true));
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
      await db.insert(emailSuppressions).values({
        tenantDomain: recipient.tenantDomain,
        email: recipient.email,
        reason: "unsubscribe",
        source: "sendgrid_event",
      }).onConflictDoNothing();
      await pushRecipientTimeline(recipient, "email_unsubscribed", {}, now);
      // Phase 3: mirror the opt-out to HubSpot subscription preferences.
      pushUnsubscribe(recipient.tenantDomain, recipient.email).catch(() => {});
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

  app.post("/api/generated-emails/:id/send", async (req, res) => {
    if (!await guardFeature(req, res, "directEmailDelivery")) return;
    const ctx = await getRequestContext(req);
    const [email] = await db.select().from(generatedEmails)
      .where(and(eq(generatedEmails.id, req.params.id), eq(generatedEmails.tenantDomain, ctx.tenantDomain)));
    if (!email) return res.status(404).json({ error: "Email not found" });

    const { listId, testRecipient, scheduledAt, trackOpens, trackClicks, excludeActiveProspects, senderIdentityId } = req.body ?? {};
    if (!listId && !testRecipient) {
      return res.status(400).json({ error: "Either listId or testRecipient is required" });
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
        testRecipient: testRecipient ?? null,
        createdBy: req.session.userId!,
        baseUrl: getBaseUrl(req),
        scheduledAt: scheduledAtDate,
        trackOpens: typeof trackOpens === "boolean" ? trackOpens : undefined,
        trackClicks: typeof trackClicks === "boolean" ? trackClicks : undefined,
        excludeActiveProspects: excludeActiveProspects === true,
        senderIdentityId: typeof senderIdentityId === "string" ? senderIdentityId : null,
      });
      res.status(201).json(result);
    } catch (err: any) {
      const status = err?.status ?? 500;
      res.status(status).json({ error: err?.message || "Failed to dispatch send" });
    }
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
}
