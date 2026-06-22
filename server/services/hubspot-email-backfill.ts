/**
 * HubSpot marketing-email sync — backfill / retry job (Phase 4).
 *
 * Drains recipients whose contact resolution is still pending or errored
 * (transient HubSpot failures, rate limits, or a send that completed before
 * resolution ran). Re-resolves them and retries the `email_sent` timeline
 * push. Idempotent — re-resolving a resolved recipient is a no-op, and
 * timeline events dedupe on their stable id.
 *
 * Recipients marked `skipped` (no matching contact + auto-create off, or no
 * connection at send time) are intentionally NOT retried.
 *
 * Best-effort and bounded; safe to call on an interval.
 */

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { emailSendRecipients, emailSends, generatedEmails } from "@shared/schema";
import { resolveSendRecipientContacts } from "./hubspot-contact-resolver";
import { pushSentEventsForSend } from "./hubspot-timeline";

const BACKFILL_BATCH = Number(process.env.MARKETING_HS_BACKFILL_BATCH || 10);
const BACKFILL_LOOKBACK_DAYS = Number(process.env.MARKETING_HS_BACKFILL_DAYS || 7);

export interface BackfillResult {
  sends: number;
  resolved: number;
  created: number;
  timelinePushed: number;
}

let inFlight = false;

export async function tickHubspotEmailSyncBackfill(): Promise<BackfillResult> {
  const result: BackfillResult = { sends: 0, resolved: 0, created: 0, timelinePushed: 0 };
  if (inFlight) return result;
  inFlight = true;
  try {
    const since = new Date(Date.now() - BACKFILL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // Distinct recently-completed sends that still have unresolved recipients.
    const candidates = await db
      .selectDistinct({
        sendId: emailSends.id,
        tenantDomain: emailSends.tenantDomain,
        subject: generatedEmails.subject,
        label: generatedEmails.label,
        campaignId: generatedEmails.campaignId,
      })
      .from(emailSendRecipients)
      .innerJoin(emailSends, eq(emailSends.id, emailSendRecipients.sendId))
      .innerJoin(generatedEmails, eq(generatedEmails.id, emailSends.generatedEmailId))
      .where(and(
        or(
          isNull(emailSendRecipients.hsSyncStatus),
          inArray(emailSendRecipients.hsSyncStatus, ["pending", "error"]),
        ),
        inArray(emailSends.status, ["sent", "partial"]),
        gt(emailSends.completedAt, since),
      ))
      .limit(BACKFILL_BATCH);

    for (const c of candidates) {
      const r = await resolveSendRecipientContacts({ tenantDomain: c.tenantDomain, sendId: c.sendId });
      if (!r.ran) continue; // not connected — leave for when the tenant connects
      result.sends += 1;
      result.resolved += r.resolved;
      result.created += r.created;
      if (r.resolved > 0) {
        const t = await pushSentEventsForSend({
          tenantDomain: c.tenantDomain,
          sendId: c.sendId,
          subject: c.subject,
          campaign: c.label ?? c.campaignId ?? null,
        });
        result.timelinePushed += t.pushed;
      }
    }
  } catch (err: any) {
    console.error("[HubSpot Email Backfill] Tick error:", err?.message || err);
  } finally {
    inFlight = false;
  }
  return result;
}