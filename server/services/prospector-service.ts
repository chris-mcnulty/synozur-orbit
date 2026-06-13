/**
 * Prospector service.
 *
 * Researches and ICP-scores a prospect: deterministic scoring (prospector-core)
 * grounded in the campaign's ICP persona + targeting filter, plus an AI research
 * dossier grounded in strategic context. Advances the prospect state machine
 * `new -> researched` (or `-> dormant` when disqualified). The pure scoring math
 * lives in `prospector-core.ts`.
 */

import { db } from "../db";
import { prospects, outreachCampaigns, personas, type Prospect } from "@shared/schema";
import { eq } from "drizzle-orm";
import { completeForFeature } from "./ai-provider";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { buildIcpCriteria, scoreProspect, type ScoredProspect } from "./prospector-core";

const SYSTEM_PROMPT = `You are a B2B sales researcher. Write a tight, factual prospect dossier for a seller preparing 1:1 outreach. Lead with why this person fits (or doesn't) the ICP, then the few facts that would shape a first message. Be specific and cite what you're inferring from. Never fabricate — if something is unknown, say "unknown". No filler, no hype, no clichés. 180 words max.`;

export interface ResearchProspectResult {
  prospect: Prospect;
  scored: ScoredProspect;
  dossier: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
}

/**
 * Score + research one prospect. Loads the campaign's ICP persona and targeting
 * filter, scores deterministically, generates a grounded dossier, and persists
 * the result with the new state.
 */
export async function researchProspect(
  tenantDomain: string,
  prospectId: string,
  opts: { isDefaultMarket?: boolean } = {},
): Promise<ResearchProspectResult> {
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!prospect || prospect.tenantDomain !== tenantDomain) {
    throw new Error("Prospect not found");
  }

  const [campaign] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, prospect.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  // The ICP persona: prefer one flagged isIcp among the campaign's targets.
  let icpPersona: { role?: string | null; industry?: string | null; companySize?: string | null } | undefined;
  const personaIds = campaign.targetPersonaIds ?? [];
  if (personaIds.length > 0) {
    const rows = await db.select().from(personas).where(eq(personas.tenantDomain, tenantDomain));
    const inCampaign = rows.filter((p) => personaIds.includes(p.id));
    icpPersona = (inCampaign.find((p: any) => p.isIcp) ?? inCampaign[0]) as any;
  }

  const criteria = buildIcpCriteria(icpPersona, campaign.targetingFilter ?? undefined);
  const scored = scoreProspect(
    {
      title: prospect.title,
      companyName: prospect.companyName,
      // Geography/industry/segment aren't first-class prospect columns yet; the
      // research signals jsonb can carry them. Fall back to what we have.
      geography: (prospect.signals as any)?.geography ?? null,
      industry: (prospect.signals as any)?.industry ?? null,
      segment: (prospect.signals as any)?.segment ?? null,
      email: prospect.email,
      linkedinUrl: prospect.linkedinUrl,
    },
    criteria,
  );

  // Grounded dossier. Strategic context gives positioning/voice/competitive
  // intel; the prospect facts + score frame the ask.
  const strategicCtx = await loadStrategicContext(
    tenantDomain,
    campaign.marketId || undefined,
    opts.isDefaultMarket,
  );
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  const prospectBlock = [
    "## Prospect",
    `Name: ${prospect.name}`,
    prospect.title ? `Title: ${prospect.title}` : "",
    prospect.companyName ? `Company: ${prospect.companyName}` : "",
    prospect.linkedinUrl ? `LinkedIn: ${prospect.linkedinUrl}` : "",
    "",
    "## ICP fit (computed)",
    `Score: ${scored.score}/100 (threshold ${scored.breakdown.threshold}) — ${scored.disqualified ? "DISQUALIFIED" : scored.qualified ? "qualified" : "below threshold"}`,
    `Signals: ${scored.breakdown.signals.map((s) => `${s.label}=${s.matched ? "yes" : "no"}`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const goalBlock = campaign.salesGoal
    ? `## Campaign goal\n${campaign.salesGoal}`
    : "";

  const prompt = [
    "Write the prospect dossier.",
    strategicBlock,
    goalBlock,
    prospectBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("prospect_research", prompt, {
    tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 700,
  });

  const dossier = result.text.trim();
  const nextStatus = scored.disqualified ? "dormant" : "researched";

  const [updated] = await db
    .update(prospects)
    .set({
      icpScore: scored.score,
      scoreBreakdown: scored.breakdown,
      disqualifiedReason: scored.disqualifiedReason ?? null,
      researchDossier: dossier,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(prospects.id, prospectId))
    .returning();

  return {
    prospect: updated,
    scored,
    dossier,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
    provider: result.provider,
  };
}
