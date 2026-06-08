/**
 * Editorial Calendar Service
 *
 * Generates a demand-scored set of content briefs grounded in intrinsic Orbit
 * data — the MPF (voice/positioning), competitive gaps, personas, brand
 * identity, and tracked SEO keywords (the demand pool). The MPF stays the
 * canonical positioning source; this service does NOT re-derive positioning.
 *
 * Synchronous (await + return) to match the existing post/email/task
 * generators; the route persists the result.
 */

import { db } from "../db";
import { trackedKeywords, recommendations } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { storage, type ContextFilter } from "../storage";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import { completeForFeature } from "./ai-provider";
import {
  normalizeBrief,
  assessCalendarWarnings,
  computeFunnelBreakdown,
  DEFAULT_FUNNEL_TARGETS,
  type DraftBrief,
} from "./editorial-calendar-core";

const SYSTEM_PROMPT =
  "You are a B2B content strategist. You build demand-driven editorial calendars. " +
  "Every topic must be backed by a real demand signal. You never invent metrics. " +
  "You always respond with valid JSON only — no prose, no markdown fences.";

export interface GenerateBriefsParams {
  tenantDomain: string;
  marketId?: string;
  isDefaultMarket?: boolean;
  count?: number;
  focus?: string;
}

export interface GenerateBriefsResult {
  briefs: DraftBrief[];
  warnings: string[];
  funnel: ReturnType<typeof computeFunnelBreakdown>;
}

function extractJsonArray(text: string): any[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Try direct parse of an object with a `briefs` array, or a bare array.
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.briefs)) return parsed.briefs;
    if (Array.isArray(parsed?.calendar)) return parsed.calendar;
  } catch {
    /* fall through to regex extraction */
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* give up */
    }
  }
  return [];
}

export async function generateContentBriefs(
  params: GenerateBriefsParams,
): Promise<GenerateBriefsResult> {
  const { tenantDomain, marketId, focus } = params;
  const count = Math.min(Math.max(params.count ?? 15, 5), 30);

  const tenant = await storage.getTenantByDomain(tenantDomain);
  const tenantId = tenant?.id || "";
  const isDefaultMarket =
    typeof params.isDefaultMarket === "boolean" ? params.isDefaultMarket : !marketId;
  const ctx: ContextFilter = {
    tenantId,
    tenantDomain,
    marketId: marketId || "",
    isDefaultMarket,
  };

  // Grounding: MPF + gaps + personas + brand identity.
  const strategicCtx = await loadStrategicContext(tenantDomain, marketId, isDefaultMarket);
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  // Demand pool: tracked SEO keywords for this tenant/market.
  const keywordRows = await db
    .select({ keyword: trackedKeywords.keyword })
    .from(trackedKeywords)
    .where(
      and(
        eq(trackedKeywords.tenantDomain, tenantDomain),
        eq(trackedKeywords.marketId, ctx.marketId),
      ),
    )
    .limit(100);
  const keywords = keywordRows.map((k) => k.keyword).filter(Boolean);
  const keywordBlock = keywords.length
    ? `## Tracked SEO Keywords (demand pool)\nPrefer mapping topics to these tracked keywords where relevant:\n${keywords.join(", ")}`
    : "";

  const focusBlock = focus?.trim()
    ? `## Focus / custom guidance\n${focus.trim()}`
    : "";

  // Closed loop: recent open marketing recommendations (e.g. from the
  // performance report) steer what the next calendar emphasizes.
  const recRows = await db
    .select({ title: recommendations.title, description: recommendations.description })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.tenantDomain, tenantDomain),
        eq(recommendations.area, "Marketing"),
        eq(recommendations.status, "pending"),
      ),
    )
    .orderBy(desc(recommendations.createdAt))
    .limit(8);
  const insightsBlock = recRows.length
    ? `## Recent performance insights to act on\nFavor topics/angles that respond to these:\n${recRows
        .map((r) => `- ${r.title}: ${r.description}`)
        .join("\n")}`
    : "";

  const prompt = [
    `Produce an editorial calendar of ${count} content briefs as JSON.`,
    strategicBlock,
    keywordBlock,
    insightsBlock,
    focusBlock,
    `## Rules
- Every brief MUST have a concrete demand signal (keyword volume, recurring buyer question, competitive gap, or trend) — never fabricate numbers; if unknown, state the qualitative signal.
- Balance the funnel toward ~${DEFAULT_FUNNEL_TARGETS.awareness}% awareness / ${DEFAULT_FUNNEL_TARGETS.consideration}% consideration / ${DEFAULT_FUNNEL_TARGETS.decision}% decision. No single stage over 50%.
- Each brief needs a sharp differentiation angle (what makes OUR take different from existing pieces) and ONE specific target reader (e.g. "Head of Demand Gen at a 150-person SaaS").
- Ground positioning and voice in the Messaging & Positioning Framework above; do not contradict it.

## Output format
Respond with a JSON object: { "briefs": [ ... ] }. Each brief object has:
- "title": string
- "format": one of blog_post | linkedin_post | x_post | newsletter | landing_page | video_script | case_study | whitepaper | other
- "targetKeyword": string
- "demandSignal": string (the evidence people care)
- "funnelStage": one of awareness | consideration | decision
- "differentiationAngle": string
- "targetReader": string (one specific person)
- "cta": string
- "channels": string[]
- "estimatedHours": number`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await completeForFeature("marketing_tasks", prompt, {
    tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 8192,
  });

  const briefs = extractJsonArray(result.text)
    .map(normalizeBrief)
    .filter((b): b is DraftBrief => b !== null);

  return {
    briefs,
    warnings: assessCalendarWarnings(briefs),
    funnel: computeFunnelBreakdown(briefs),
  };
}
