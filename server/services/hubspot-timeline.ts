/**
 * HubSpot contact-timeline push — marketing-email sync Phase 2.
 *
 * Mirrors marketing-email engagement to the matching HubSpot contact's
 * timeline using the CRM v3 Timeline Events API. Events are idempotent (stable
 * event id), best-effort, and never block the webhook / send path.
 *
 * Timeline event *templates* live on the HubSpot app (created out-of-band —
 * see docs/hubspot-email-phase0-setup.md). Their ids are supplied via env, one
 * per event key. This makes the whole feature dormant until an operator
 * configures the ids: an event with no configured template is skipped, so
 * nothing is pushed before the templates exist.
 *
 * Standalone-safe: no connection / missing email-sync scopes ⇒ no-op.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { emailSendRecipients } from "@shared/schema";
import { storage } from "../storage";
import { getTenantAccessToken, hasHubspotEmailScopes, HUBSPOT_REST_HOST } from "./hubspot-integration";
import { isHubspotEmailSyncEnabled } from "./hubspot-email-sync";
import { timelineEventId, type TimelineEventKey } from "./hubspot-email-sync-core";

// Env var carrying the HubSpot event-template id for each event key. Unset ⇒
// that event type is skipped.
const TEMPLATE_ENV: Record<TimelineEventKey, string> = {
  email_sent: "HUBSPOT_TLT_EMAIL_SENT",
  email_opened: "HUBSPOT_TLT_EMAIL_OPENED",
  email_clicked: "HUBSPOT_TLT_EMAIL_CLICKED",
  email_bounced: "HUBSPOT_TLT_EMAIL_BOUNCED",
  email_unsubscribed: "HUBSPOT_TLT_EMAIL_UNSUBSCRIBED",
};

export function timelineTemplateId(eventKey: TimelineEventKey): string | undefined {
  const v = process.env[TEMPLATE_ENV[eventKey]];
  return v && v.trim() ? v.trim() : undefined;
}

/** True when at least one timeline template id is configured. */
export function isTimelineSyncConfigured(): boolean {
  return (Object.keys(TEMPLATE_ENV) as TimelineEventKey[]).some((k) => !!timelineTemplateId(k));
}

export interface PushTimelineOpts {
  /** Resolved HubSpot contact id this event attaches to. */
  contactId: string;
  eventKey: TimelineEventKey;
  /** Stable id for idempotency — see timelineEventId(). */
  eventId: string;
  /** Token values rendered by the template (subject, counts, url, …). */
  tokens: Record<string, string | number>;
  /** When the engagement occurred. */
  occurredAt?: Date;
}

export type PushTimelineResult = "pushed" | "skipped" | "error";

/**
 * Push a single engagement event to a contact's HubSpot timeline. Never
 * throws — returns a coarse result for diagnostics. Skips (without error) when
 * the template is unconfigured, the tenant isn't connected, or the connection
 * lacks the email-sync scopes.
 */
export async function pushEmailTimelineEvent(
  tenantDomain: string,
  opts: PushTimelineOpts,
): Promise<PushTimelineResult> {
  try {
    if (!opts.contactId) return "skipped";
    const eventTemplateId = timelineTemplateId(opts.eventKey);
    if (!eventTemplateId) return "skipped";
    if (!(await isHubspotEmailSyncEnabled(tenantDomain))) return "skipped";

    const conn = await storage.getHubspotConnection(tenantDomain);
    if (!conn || !hasHubspotEmailScopes(conn)) return "skipped";

    const { accessToken } = await getTenantAccessToken(tenantDomain);

    // Tokens must be strings on the wire.
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.tokens)) tokens[k] = String(v);

    const res = await fetch(`${HUBSPOT_REST_HOST}/crm/v3/timeline/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventTemplateId,
        id: opts.eventId,
        objectId: opts.contactId,
        tokens,
        timestamp: (opts.occurredAt ?? new Date()).toISOString(),
      }),
    });
    // 2xx = created/updated. 409 can occur on a duplicate id (already
    // recorded) — treat as success, not error.
    if (res.ok || res.status === 409) return "pushed";
    return "error";
  } catch {
    return "error";
  }
}

const SENT_PUSH_CONCURRENCY = Number(process.env.MARKETING_HS_TIMELINE_CONCURRENCY || 5);

/**
 * Push `email_sent` timeline events for all recipients of a send that resolved
 * to a HubSpot contact. Best-effort, bounded concurrency, idempotent. Called
 * after contact resolution; no-ops when the template isn't configured.
 */
export async function pushSentEventsForSend(opts: {
  tenantDomain: string;
  sendId: string;
  subject: string;
  campaign?: string | null;
}): Promise<{ pushed: number; skipped: number; errors: number }> {
  const result = { pushed: 0, skipped: 0, errors: 0 };
  if (!timelineTemplateId("email_sent")) return result;
  if (!(await isHubspotEmailSyncEnabled(opts.tenantDomain))) return result;

  const rows = await db
    .select({ id: emailSendRecipients.id, contactId: emailSendRecipients.hubspotContactId })
    .from(emailSendRecipients)
    .where(and(
      eq(emailSendRecipients.sendId, opts.sendId),
      isNotNull(emailSendRecipients.hubspotContactId),
    ));
  if (rows.length === 0) return result;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const r = await pushEmailTimelineEvent(opts.tenantDomain, {
        contactId: row.contactId!,
        eventKey: "email_sent",
        eventId: timelineEventId(opts.sendId, row.id, "email_sent"),
        tokens: { subject: opts.subject, campaign: opts.campaign ?? "", sendId: opts.sendId },
      });
      if (r === "pushed") result.pushed += 1;
      else if (r === "skipped") result.skipped += 1;
      else result.errors += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(SENT_PUSH_CONCURRENCY, rows.length) }, worker));
  return result;
}
