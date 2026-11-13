/**
 * Outreach Performance service.
 *
 * Loads a campaign's prospects and runs the conversion-first analysis core to
 * produce a performance report (funnel, reply rate, signal lift, and
 * recommendations that feed back into ICP targeting/scoring).
 */

import { db } from "../db";
import { prospects, outreachCampaigns, externalOutreachActivities } from "@shared/schema";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { analyzeOutreachPerformance, type OutreachPerformanceReport, type PerfProspect } from "./outreach-performance-core";

export async function getCampaignPerformance(
  tenantDomain: string,
  campaignId: string,
): Promise<OutreachPerformanceReport> {
  const [campaign] = await db.select().from(outreachCampaigns).where(and(
    eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.tenantDomain, tenantDomain),
  ));
  if (!campaign || campaign.tenantDomain !== tenantDomain) throw new Error("Campaign not found");

  const rows = await db
    .select({ contactId: prospects.contactId, status: prospects.status, icpScore: prospects.icpScore, scoreBreakdown: prospects.scoreBreakdown })
    .from(prospects)
    .where(and(
      eq(prospects.campaignId, campaignId),
      eq(prospects.tenantDomain, tenantDomain),
      isNull(prospects.removedAt),
      notInArray(prospects.status, ["archived", "deleted", "removed"]),
    ));

  const ids = [...new Set(rows.map(row => row.contactId).filter(Boolean))];
  const external = ids.length ? await db.select({
    contactId: externalOutreachActivities.contactId, direction: externalOutreachActivities.direction,
    outcome: externalOutreachActivities.outcome,
  }).from(externalOutreachActivities).where(and(
    eq(externalOutreachActivities.tenantDomain, tenantDomain),
    eq(externalOutreachActivities.campaignId, campaignId),
    inArray(externalOutreachActivities.contactId, ids),
  )) : [];
  const communicated = new Set(external.map(activity => activity.contactId));
  const replied = new Set(external.filter(activity => activity.direction === "inbound"
    || ["replied", "meeting_agreed"].includes(activity.outcome)).map(activity => activity.contactId));
  const perf: PerfProspect[] = rows.map((r) => ({
    status: r.status,
    icpScore: r.icpScore,
    scoreBreakdown: r.scoreBreakdown,
    externalCommunicated: communicated.has(r.contactId),
    externalReplied: replied.has(r.contactId),
  }));
  return analyzeOutreachPerformance(perf);
}
