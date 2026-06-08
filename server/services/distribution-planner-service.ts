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

// Briefs in these statuses are worth scheduling by default (skip removed).
export const DEFAULT_PLAN_STATUSES = ["suggested", "accepted", "in_progress", "drafted"];

export interface PlanDistributionParams {
  tenantDomain: string;
  calendarId: string;
  periodStart?: Date;
  periodEnd?: Date;
  skipWeekends?: boolean;
  statuses?: string[];
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

  const schedule = buildSchedule(
    briefs.map((b) => ({
      id: b.id,
      title: b.title,
      format: b.format,
      preferredChannels: b.channels,
    })),
    { periodStart, periodEnd, skipWeekends: params.skipWeekends ?? true },
  );

  return { schedule };
}
