/**
 * Relationship Report Service
 *
 * Generates an on-demand 12-month relationship plan describing how the
 * baseline company should engage with another company in their market.
 * The plan covers cooperation, selling, competing, talking, and walking-
 * away postures, structured as quarterly milestones.
 *
 * Default target: a tracked competitor for the active tenant + market.
 * Future expansion: any external company by ad-hoc lookup.
 */

import { storage, type ContextFilter } from "../storage";
import { AI_FEATURES, type CompanyProfile, type Competitor, type Battlecard, type Activity, type GroundingDocument } from "@shared/schema";
import { completeForFeature } from "./ai-provider";

export interface RelationshipReportInput {
  ctx: ContextFilter;
  /** Tracked competitor as the target (mutually exclusive with targetProfile). */
  competitor?: Competitor;
  /** Cross-market baseline company as the target (mutually exclusive with competitor). */
  targetProfile?: CompanyProfile;
  baseline: CompanyProfile | null;
  customGuidance?: string;
  posture?: string; // 'cooperate'|'compete'|'sell_to'|'steer_clear'|'observe' or undefined for AI-recommended
  focus?: string[]; // optional focus areas: ['engage','cooperate','sell_to','compete','speak_to','steer_clear']
  isB2C?: boolean;
}

export interface RelationshipReportResult {
  content: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  provider?: string;
}

const POSTURE_LABELS: Record<string, string> = {
  cooperate: "Cooperate / Partner",
  compete: "Compete / Differentiate",
  sell_to: "Sell To / Pursue as Customer",
  steer_clear: "Steer Clear / Avoid",
  observe: "Observe / Hold Steady",
};

function describeFocus(focus?: string[]): string {
  if (!focus || focus.length === 0) {
    return "All postures: engage, cooperate, sell to, compete, speak to, and when to steer clear.";
  }
  const labels: Record<string, string> = {
    engage: "general engagement",
    cooperate: "cooperation and partnership",
    sell_to: "selling to them as a customer",
    compete: "competing against them",
    speak_to: "how to speak to them (talking points, channels, do's and don'ts)",
    steer_clear: "when and why to steer clear",
  };
  return focus.map(f => labels[f] || f).join(", ");
}

function summarizeBattlecard(bc: Battlecard): string {
  const lines: string[] = [];
  const strengths = bc.strengths as string[] | null;
  const weaknesses = bc.weaknesses as string[] | null;
  const advantages = bc.ourAdvantages as string[] | null;
  const objections = bc.objections as { objection: string; response: string }[] | null;
  if (strengths?.length) lines.push(`Their strengths: ${strengths.slice(0, 5).join("; ")}`);
  if (weaknesses?.length) lines.push(`Their weaknesses: ${weaknesses.slice(0, 5).join("; ")}`);
  if (advantages?.length) lines.push(`Our advantages: ${advantages.slice(0, 5).join("; ")}`);
  if (objections?.length) {
    const obj = objections.slice(0, 3).map(o => `"${o.objection}" → ${o.response}`).join(" | ");
    lines.push(`Common objections: ${obj}`);
  }
  return lines.join("\n");
}

function summarizeActivity(activities: Activity[]): string {
  if (activities.length === 0) return "";
  return activities
    .slice(0, 8)
    .map(a => `- [${a.type}/${a.impact}] ${a.description}${a.summary ? ` — ${a.summary.slice(0, 200)}` : ""}`)
    .join("\n");
}

// Trim verbose markdown to fit a budget without truncating mid-sentence too
// awkwardly; we keep section headers and lists intact at the edges.
function truncateText(text: string, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s+\S*$/, "") + "\n…(truncated)";
}

function summarizeBaselineGroundingDocs(docs: GroundingDocument[]): string {
  // Baseline-only docs: docs without a competitorId, since competitor-tagged
  // docs describe the target / other companies, not the perspective.
  const baselineDocs = docs.filter(d => !d.competitorId);
  if (baselineDocs.length === 0) return "";
  const blocks = baselineDocs.slice(0, 8).map(d => {
    const body = (d.extractedText || "").trim();
    if (!body) return null;
    return `### ${d.name}${d.useCase ? ` (${d.useCase})` : ""}\n${truncateText(body, 2500)}`;
  }).filter(Boolean) as string[];
  return blocks.join("\n\n");
}

export async function generateRelationshipReport(
  input: RelationshipReportInput,
): Promise<RelationshipReportResult> {
  const { ctx, competitor, targetProfile, baseline, customGuidance, posture, focus, isB2C } = input;

  if (!competitor && !targetProfile) {
    throw new Error("Either competitor or targetProfile must be supplied.");
  }

  // Pull supporting intelligence only when the target is a tracked competitor.
  let battlecard: Battlecard | undefined;
  let recentActivity: Activity[] = [];
  if (competitor) {
    const battlecards = await storage.getBattlecardsByContext(ctx);
    battlecard = battlecards.find(b => b.competitorId === competitor.id);
    try {
      recentActivity = (await storage.getActivityByTenantForPeriod(ctx.tenantDomain, 90, ctx.marketId || undefined))
        .filter(a => a.competitorId === competitor.id);
    } catch {
      // Activity is best-effort; absence shouldn't block report generation.
    }
  }

  // Anchor the perspective: load the baseline company's own messaging
  // framework + GTM plan, plus any grounding documents that describe the
  // baseline company itself. These let the AI speak in the company's voice
  // and stay grounded in the company's own positioning rather than inventing
  // a generic point of view.
  const [messagingRec, gtmRec, allGroundingDocs] = await Promise.all([
    baseline
      ? storage.getLongFormRecommendationByType("messaging_framework", undefined, baseline.id).catch(() => undefined)
      : Promise.resolve(undefined),
    baseline
      ? storage.getLongFormRecommendationByType("gtm_plan", undefined, baseline.id).catch(() => undefined)
      : Promise.resolve(undefined),
    storage.getGroundingDocumentsByContext(ctx, "executive_summary").catch(() => [] as GroundingDocument[]),
  ]);

  const messagingFrameworkText = messagingRec?.status === "generated" && messagingRec.content
    ? truncateText(messagingRec.content, 6000)
    : "";
  const gtmPlanText = gtmRec?.status === "generated" && gtmRec.content
    ? truncateText(gtmRec.content, 4500)
    : "";
  const baselineGroundingText = summarizeBaselineGroundingDocs(allGroundingDocs);

  const baselineAnalysis = (baseline?.analysisData as any) || {};
  const baselineBlock = baseline
    ? `Name: ${baseline.companyName}
Website: ${baseline.websiteUrl || "N/A"}
Description: ${baseline.description || "N/A"}
Value Proposition: ${baselineAnalysis.valueProposition || "N/A"}
Target Audience: ${baselineAnalysis.targetAudience || "N/A"}
Industry: ${baseline.industry || "N/A"}
Headquarters: ${baseline.headquarters || "N/A"}`
    : "No baseline company profile is configured. Treat the perspective as a generic player in this market.";

  // Build the target block from whichever target type was supplied.
  const resolvedTarget = competitor ?? targetProfile!;
  const targetName = competitor ? competitor.name : targetProfile!.companyName;
  const targetAnalysis = (resolvedTarget.analysisData as any) || {};

  const targetBlock = competitor
    ? `Name: ${competitor.name}
Website: ${competitor.url || "N/A"}
Industry: ${competitor.industry || "N/A"}
Headquarters: ${competitor.headquarters || "N/A"}
Founded: ${competitor.founded || "N/A"}
Size: ${competitor.employeeCount || "N/A"}
Funding: ${competitor.fundingRaised || "N/A"}
Revenue band: ${competitor.revenue || "N/A"}
Summary: ${targetAnalysis.summary || "No AI summary available"}`
    : `Name: ${targetProfile!.companyName}
Website: ${targetProfile!.websiteUrl || "N/A"}
Industry: ${targetProfile!.industry || "N/A"}
Headquarters: ${targetProfile!.headquarters || "N/A"}
Founded: ${targetProfile!.founded || "N/A"}
Size: ${targetProfile!.employeeCount || "N/A"}
Funding: ${targetProfile!.fundingRaised || "N/A"}
Revenue band: ${targetProfile!.revenue || "N/A"}
Description: ${targetProfile!.description || "N/A"}
Value Proposition: ${targetAnalysis.valueProposition || "N/A"}
Target Audience: ${targetAnalysis.targetAudience || "N/A"}
Note: This is another market's baseline company within the same organisation — not a tracked competitor. No battlecard or signal history is available; rely on the profile data above and any grounding documents.`;

  const battlecardBlock = battlecard
    ? `Existing battlecard insights:\n${summarizeBattlecard(battlecard)}`
    : competitor
      ? "No existing battlecard for this competitor."
      : "No battlecard available — this target is a cross-market baseline company, not a tracked competitor.";

  const activityBlock = recentActivity.length > 0
    ? `Recent signals (last 90 days):\n${summarizeActivity(recentActivity)}`
    : competitor
      ? "No recent monitored signals from this competitor."
      : "No signal history available for this target.";

  const postureLine = posture
    ? `The user has indicated a preferred posture: **${POSTURE_LABELS[posture] || posture}**. Frame the plan around that posture, but still cover when each of the other postures becomes appropriate.`
    : "No preferred posture was supplied. Recommend the primary posture (cooperate / compete / sell to / steer clear / observe) in the Posture Assessment section, and explain the trade-offs.";

  const focusLine = `Focus areas requested: ${describeFocus(focus)}`;

  const b2cGuidance = isB2C
    ? `\nThis is a B2C market — frame messaging around brand, lifestyle and emotional connection rather than enterprise procurement.`
    : "";

  // Source-of-truth ordering for our own positioning:
  //   1. Official grounding documents uploaded by the team about the
  //      baseline company (highest authority — these are the real MPF and
  //      brand docs the customer trusts).
  //   2. The system-generated messaging framework recommendation (a useful
  //      suggestion, but yields to anything in the official docs above).
  //   3. The system-generated GTM plan recommendation (same rule).
  // The prompt makes that precedence explicit so the model never substitutes
  // its own suggestion for an official statement that contradicts it.

  const baselineGroundingBlock = baselineGroundingText
    ? `## Official Baseline Grounding Documents (about ${baseline?.companyName || "our company"}) — HIGHEST AUTHORITY
These documents were uploaded by the team as the official source of truth about our own company — including any official messaging & positioning framework (MPF), brand guidelines, voice docs, board decks, or one-pagers. Treat them as PRIMARY source material. Quote facts, positioning language, value proposition phrasing, taglines, and proof points from them verbatim where helpful.

PRECEDENCE RULE: When anything in these official documents conflicts with the system-generated Messaging Framework or GTM Plan that follow, the official documents win. The AI-generated frameworks are working drafts; the official documents are the company's actual position. Do not paper over conflicts — if you spot one, follow the official document and call out the conflict in "Risks & Open Questions" so the team can reconcile their internal artifacts.

${baselineGroundingText}`
    : "";

  const messagingFrameworkBlock = messagingFrameworkText
    ? `## System-Generated Messaging & Positioning Framework (suggestion — yields to official docs above)
This is an AI-generated messaging framework draft saved in Orbit. Use it to fill in any gaps left by the official grounding documents above (positioning, value proposition, messaging pillars, tone of voice, do's-and-don'ts). However, if the official baseline grounding documents above describe positioning or voice differently, follow the official documents and ignore the conflicting parts of this draft.

${messagingFrameworkText}`
    : baselineGroundingText
      ? ""
      : `## Messaging & Positioning Framework
No official grounding documents and no system-generated messaging framework are available. Derive a sensible voice from the baseline profile above and flag in "Risks & Open Questions" that the team should produce one.`;

  const gtmPlanBlock = gtmPlanText
    ? `## System-Generated Go-To-Market Plan (suggestion — yields to official docs above)
This is an AI-generated GTM plan draft saved in Orbit. Use it to align target-segment language, channel choices, and launch milestones for the 12-month roadmap, except where the official grounding documents above contradict it — in that case follow the official docs.

${gtmPlanText}`
    : "";

  const prompt = `You are a senior partnerships and competitive strategy advisor. Produce a comprehensive, decision-ready 12-month Relationship Plan in markdown describing how ${baseline?.companyName || "our company"} should engage with ${targetName}.

The plan must be opinionated, specific, and quarter-by-quarter. It should advise on multiple coexisting postures: when to engage, when to cooperate, when to sell to them, when to compete, how to speak to them, and when to steer clear. Use the data below; never invent factual claims you cannot ground. The plan must be written from ${baseline?.companyName || "our company"}'s point of view, anchored to its official voice.

SOURCE-OF-TRUTH PRECEDENCE for our own positioning (apply in order, top wins):
1. Official baseline grounding documents (uploaded MPF, brand docs, voice guides, etc.).
2. System-generated Messaging & Positioning Framework draft.
3. System-generated Go-To-Market Plan draft.
4. Inferred voice from the baseline profile.

If a lower-tier source contradicts a higher one, follow the higher one and note the conflict in "Risks & Open Questions".

## Our Company (perspective)
${baselineBlock}

${baselineGroundingBlock ? `${baselineGroundingBlock}\n` : ""}
${messagingFrameworkBlock ? `${messagingFrameworkBlock}\n` : ""}
${gtmPlanBlock ? `${gtmPlanBlock}\n` : ""}

## Target Company (subject of the plan)
${targetBlock}

## Competitive Intelligence
${battlecardBlock}

${activityBlock}

## Plan Parameters
- ${postureLine}
- ${focusLine}
- Custom guidance from user: ${customGuidance || "None"}${b2cGuidance}

Produce the plan in markdown with EXACTLY the following structure and section headings:

# 12-Month Relationship Plan: ${targetName}

## Executive Summary
3-5 sentences summarizing the recommended posture, why it fits, and the single most important action this quarter.

## Relationship Posture Assessment
Recommend the dominant posture (Cooperate / Compete / Sell To / Steer Clear / Observe) with a one-paragraph rationale. Then briefly describe the secondary postures that may apply in parallel and the conditions under which the dominant posture should change.

## Strategic Read on ${targetName}
What they want, where they are headed, what they are afraid of, and what their tells are. Tie each point back to evidence (battlecard, signals, public posture).

## How to Engage
Concrete engagement plays for the next 12 months: events, conferences, communities, analyst conversations, joint customers, mutual investors. Include who initiates and the cadence.

## How to Cooperate
Realistic cooperation surfaces — integrations, co-marketing, shared standards, channel partnerships, referral arrangements, ecosystem plays. Be honest about what is plausible and what is fantasy. Include preconditions before reaching out.

## How to Sell To Them
Treat them as a potential buyer. Identify entry points (departments / personas), the wedge product or service, the discovery questions, the proof points that resonate, and the procurement gotchas to anticipate.

## How to Compete With Them
Win themes, positioning contrasts, traps to set, traps to avoid, pricing posture, and which deals to walk away from. Reference our advantages and their weaknesses where supported by the battlecard.

## How to Speak To Them
Voice and channel guidance: tone, vocabulary to embrace and avoid, direct vs. indirect references in marketing, public statements, social engagement, and how to handle press / analyst conversations that mention them. Include 3-5 concrete sample lines (e.g., for a sales rep, a marketer, an executive).

## When to Steer Clear
Specific situations, deal types, accounts, geographies, or partnerships where the right move is to disengage. Articulate the reputational, legal, or strategic risks.

## 12-Month Roadmap (Quarter by Quarter)
For each of Q1, Q2, Q3, Q4 list:
- Theme for the quarter (single line)
- 3-5 concrete actions with owners (e.g., "Sales", "Product Marketing", "CEO", "Partnerships")
- Decision gates / triggers that would change the plan
- Metrics that will tell us if it is working

## Watch List & Trigger Signals
Bulleted signals (announcements, hires, pricing changes, M&A rumors, executive moves) that should cause us to revisit this plan, and the response we would take when each fires.

## Risks & Open Questions
What we don't know, what could go wrong, and what additional intelligence we should gather in the first 30 days.

Make every section grounded, specific, and useful. Avoid generic platitudes. Where data is missing, say so explicitly and recommend how to fill the gap rather than fabricating detail.`;

  // Route through the central AI provider so per-feature model assignments
  // (admin AI configuration page) and the global default config are honored.
  const result = await completeForFeature(AI_FEATURES.RELATIONSHIP_REPORT, prompt, {
    maxTokens: 8192,
    tenantDomain: ctx.tenantDomain,
  });

  return {
    content: result.text,
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    },
    model: result.model,
    provider: result.provider,
  };
}
