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

import Anthropic from "@anthropic-ai/sdk";
import { storage, type ContextFilter } from "../storage";
import type { CompanyProfile, Competitor, Battlecard, Activity } from "@shared/schema";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface RelationshipReportInput {
  ctx: ContextFilter;
  competitor: Competitor;
  baseline: CompanyProfile | null;
  customGuidance?: string;
  posture?: string; // 'cooperate'|'compete'|'sell_to'|'steer_clear'|'observe' or undefined for AI-recommended
  focus?: string[]; // optional focus areas: ['engage','cooperate','sell_to','compete','speak_to','steer_clear']
  isB2C?: boolean;
}

export interface RelationshipReportResult {
  content: string;
  usage?: { input_tokens?: number; output_tokens?: number };
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

export async function generateRelationshipReport(
  input: RelationshipReportInput,
): Promise<RelationshipReportResult> {
  const { ctx, competitor, baseline, customGuidance, posture, focus, isB2C } = input;

  // Pull supporting intelligence: battlecard, recent signals, news.
  const battlecards = await storage.getBattlecardsByContext(ctx);
  const battlecard = battlecards.find(b => b.competitorId === competitor.id);

  let recentActivity: Activity[] = [];
  try {
    recentActivity = (await storage.getActivityByTenantForPeriod(ctx.tenantDomain, 90, ctx.marketId || undefined))
      .filter(a => a.competitorId === competitor.id);
  } catch {
    // Activity is best-effort; absence shouldn't block report generation.
  }

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

  const targetBlock = `Name: ${competitor.name}
Website: ${competitor.url || "N/A"}
Industry: ${competitor.industry || "N/A"}
Headquarters: ${competitor.headquarters || "N/A"}
Founded: ${competitor.founded || "N/A"}
Size: ${competitor.employeeCount || "N/A"}
Funding: ${competitor.fundingRaised || "N/A"}
Revenue band: ${competitor.revenue || "N/A"}
Summary: ${(competitor.analysisData as any)?.summary || "No AI summary available"}`;

  const battlecardBlock = battlecard
    ? `Existing battlecard insights:\n${summarizeBattlecard(battlecard)}`
    : "No existing battlecard for this competitor.";

  const activityBlock = recentActivity.length > 0
    ? `Recent signals (last 90 days):\n${summarizeActivity(recentActivity)}`
    : "No recent monitored signals from this competitor.";

  const postureLine = posture
    ? `The user has indicated a preferred posture: **${POSTURE_LABELS[posture] || posture}**. Frame the plan around that posture, but still cover when each of the other postures becomes appropriate.`
    : "No preferred posture was supplied. Recommend the primary posture (cooperate / compete / sell to / steer clear / observe) in the Posture Assessment section, and explain the trade-offs.";

  const focusLine = `Focus areas requested: ${describeFocus(focus)}`;

  const b2cGuidance = isB2C
    ? `\nThis is a B2C market — frame messaging around brand, lifestyle and emotional connection rather than enterprise procurement.`
    : "";

  const prompt = `You are a senior partnerships and competitive strategy advisor. Produce a comprehensive, decision-ready 12-month Relationship Plan in markdown describing how ${baseline?.companyName || "our company"} should engage with ${competitor.name}.

The plan must be opinionated, specific, and quarter-by-quarter. It should advise on multiple coexisting postures: when to engage, when to cooperate, when to sell to them, when to compete, how to speak to them, and when to steer clear. Use the data below; never invent factual claims you cannot ground.

## Our Company (perspective)
${baselineBlock}

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

# 12-Month Relationship Plan: ${competitor.name}

## Executive Summary
3-5 sentences summarizing the recommended posture, why it fits, and the single most important action this quarter.

## Relationship Posture Assessment
Recommend the dominant posture (Cooperate / Compete / Sell To / Steer Clear / Observe) with a one-paragraph rationale. Then briefly describe the secondary postures that may apply in parallel and the conditions under which the dominant posture should change.

## Strategic Read on ${competitor.name}
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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0]?.type === "text" ? message.content[0].text : "";
  return {
    content,
    usage: message.usage,
  };
}
