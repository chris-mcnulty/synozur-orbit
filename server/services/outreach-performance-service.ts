/**
 * Outreach Performance service.
 *
 * Loads a campaign's prospects and runs the conversion-first analysis core to
 * produce a performance report (funnel, reply rate, signal lift, and
 * recommendations that feed back into ICP targeting/scoring).
 */

import { db } from "../db";
import { prospects, outreachCampaigns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { analyzeOutreachPerformance, type OutreachPerformanceReport, type PerfProspect } from "./outreach-performance-core";

export async function getCampaignPerformance(
  tenantDomain: string,
  campaignId: string,
): Promise<OutreachPerformanceReport> {
  const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign || campaign.tenantDomain !== tenantDomain) throw new Error("Campaign not found");

  const rows = await db
    .select({ status: prospects.status, icpScore: prospects.icpScore, scoreBreakdown: prospects.scoreBreakdown })
    .from(prospects)
    .where(eq(prospects.campaignId, campaignId));

  const perf: PerfProspect[] = rows.map((r) => ({
    status: r.status,
    icpScore: r.icpScore,
    scoreBreakdown: r.scoreBreakdown,
  }));
  return analyzeOutreachPerformance(perf);
}
