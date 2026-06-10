/**
 * Schedule load helper (Task #164)
 *
 * Counts already-scheduled marketing activities (social posts, emails, content
 * briefs) per user-local calendar day. Shared by the schedule-aware
 * distribution planner (avoid clustering) and the calendar's date-advice
 * endpoint (warn when a chosen day is already crowded).
 */

import { db } from "../db";
import { generatedPosts, generatedEmails, contentBriefs } from "@shared/schema";
import { and, eq, isNotNull, ne, notInArray } from "drizzle-orm";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Bucket a stored UTC instant into the user's LOCAL calendar day (YYYY-MM-DD).
 * `tzOffsetMinutes` is the client's `Date.getTimezoneOffset()`; subtracting it
 * shifts the instant back to local wall-clock, mirroring how the distribution
 * planner places best-posting hours.
 */
export function localDayKey(dt: Date, tzOffsetMinutes = 0): string {
  const local = new Date(dt.getTime() - tzOffsetMinutes * 60_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

export interface ScheduleLoadParams {
  tenantDomain: string;
  /** When provided, scopes emails/content to this market (social has no market). */
  marketId?: string | null;
  from: Date;
  to: Date;
  tzOffsetMinutes?: number;
  /** Content briefs to exclude from the count (e.g. the ones being scheduled). */
  excludeBriefIds?: string[];
}

/**
 * Returns a Map of local-day key (YYYY-MM-DD) -> number of activities scheduled
 * on that day, across social / email / content, within [from, to].
 */
export async function getScheduledDayCounts(p: ScheduleLoadParams): Promise<Map<string, number>> {
  const tz = p.tzOffsetMinutes ?? 0;
  const counts = new Map<string, number>();
  const bump = (dt: Date | null | undefined) => {
    if (!dt) return;
    if (dt < p.from || dt > p.to) return;
    const k = localDayKey(dt, tz);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };

  // ── Social posts (tenant-scoped — generated_posts has no market) ──
  const socialRows = await db
    .select({ scheduledDate: generatedPosts.scheduledDate, publishedAt: generatedPosts.publishedAt })
    .from(generatedPosts)
    .where(and(
      eq(generatedPosts.tenantDomain, p.tenantDomain),
      ne(generatedPosts.status, "rejected"),
      ne(generatedPosts.status, "deleted"),
      ne(generatedPosts.status, "archived"),
    ));
  for (const r of socialRows) bump(r.scheduledDate ?? r.publishedAt);

  // ── Emails (tenant + market) ──
  const emailConds = [eq(generatedEmails.tenantDomain, p.tenantDomain)];
  if (p.marketId) emailConds.push(eq(generatedEmails.marketId, p.marketId));
  const emailRows = await db
    .select({ scheduledAt: generatedEmails.scheduledAt, sentAt: generatedEmails.sentAt })
    .from(generatedEmails)
    .where(and(...emailConds));
  for (const r of emailRows) bump(r.scheduledAt ?? r.sentAt);

  // ── Content briefs (tenant + market), only those already dated ──
  const briefConds = [
    eq(contentBriefs.tenantDomain, p.tenantDomain),
    ne(contentBriefs.status, "removed"),
    isNotNull(contentBriefs.scheduledAt),
  ];
  if (p.marketId) briefConds.push(eq(contentBriefs.marketId, p.marketId));
  if (p.excludeBriefIds?.length) briefConds.push(notInArray(contentBriefs.id, p.excludeBriefIds));
  const briefRows = await db
    .select({ scheduledAt: contentBriefs.scheduledAt })
    .from(contentBriefs)
    .where(and(...briefConds));
  for (const r of briefRows) bump(r.scheduledAt);

  return counts;
}
