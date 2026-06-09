/**
 * Distribution Planner Service
 *
 * Loads an editorial calendar's briefs and produces a deterministic
 * distribution schedule (channel + posting window per brief). Persistence into
 * the marketing planner is handled by the route via storage.createMarketingTasks.
 */

import { db } from "../db";
import { contentBriefs } from "@shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { buildSchedule, type ScheduledItem } from "./distribution-planner-core";
import { getScheduledDayCounts } from "./schedule-load";

// Briefs in these statuses are worth scheduling by default (skip removed).
export const DEFAULT_PLAN_STATUSES = ["suggested", "accepted", "in_progress", "drafted"];

export interface PlanDistributionParams {
  tenantDomain: string;
  /** Active market — scopes the "already booked" awareness for emails/content. */
  marketId?: string | null;
  calendarId: string;
  periodStart?: Date;
  periodEnd?: Date;
  skipWeekends?: boolean;
  statuses?: string[];
  tzOffsetMinutes?: number;
}

export interface PlanDistributionResult {
  schedule: ScheduledItem[];
}

export async function planDistribution(
  params: PlanDistributionParams,
): Promise<PlanDistributionResult> {
  const statuses = params.statuses?.length ? params.statuses : DEFAULT_PLAN_STATUSES;

  const briefs = await db
    .select()
    .from(contentBriefs)
    .where(
      and(
        eq(contentBriefs.calendarId, params.calendarId),
        eq(contentBriefs.tenantDomain, params.tenantDomain),
        inArray(contentBriefs.status, statuses),
      ),
    )
    .orderBy(asc(contentBriefs.sortOrder), asc(contentBriefs.createdAt));

  const periodStart = params.periodStart ?? new Date();
  const periodEnd =
    params.periodEnd ?? new Date(periodStart.getTime() + 30 * 86_400_000);

  // Read what's already booked in the window so placement can avoid clustering
  // on days that already have marketing activity. Exclude the briefs we're about
  // to schedule so they don't count against themselves.
  const existing = await getScheduledDayCounts({
    tenantDomain: params.tenantDomain,
    marketId: params.marketId,
    from: periodStart,
    to: periodEnd,
    tzOffsetMinutes: params.tzOffsetMinutes,
    excludeBriefIds: briefs.map((b) => b.id),
  });

  const schedule = buildSchedule(
    briefs.map((b) => ({
      id: b.id,
      title: b.title,
      format: b.format,
      preferredChannels: b.channels,
    })),
    {
      periodStart,
      periodEnd,
      skipWeekends: params.skipWeekends ?? true,
      tzOffsetMinutes: params.tzOffsetMinutes,
      existingDayCounts: Object.fromEntries(existing),
    },
  );

  return { schedule };
}
