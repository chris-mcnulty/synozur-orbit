/**
 * Marketing performance — pure core.
 *
 * Benchmarking math, content/campaign ranking, and parsing of the analyst's
 * recommendation output. No I/O, so it is unit-testable.
 */

import type { MarketingPerformanceMetrics } from "@shared/schema";

/**
 * Index a current per-day rate against a baseline per-day rate (100 = on par
 * with history, >100 = better). Mirrors the insights-outcomes indexing so the
 * two surfaces tell a consistent story. Returns null when not comparable.
 */
export function indexVsBaseline(
  current: number,
  currentDays: number,
  baseline: number,
  baselineDays: number,
): number | null {
  if (currentDays <= 0 || baselineDays <= 0) return null;
  const baseRate = baseline / baselineDays;
  if (baseRate <= 0) return null;
  const curRate = current / currentDays;
  return Math.round((curRate / baseRate) * 100);
}

export interface ContentPerf {
  assetId: string;
  title: string;
  postsPublished: number;
  clicks: number;
  campaigns: string[];
}

/** Rank content by clicks, then publishing volume. Returns a new array. */
export function rankContent(items: ContentPerf[]): ContentPerf[] {
  return [...items].sort((a, b) => b.clicks - a.clicks || b.postsPublished - a.postsPublished);
}

/**
 * Content that was published but earned no clicks in the window — the
 * "underperformers" worth flagging in the loop-closing recommendations.
 */
export function underperformers(items: ContentPerf[]): ContentPerf[] {
  return items.filter((c) => c.postsPublished > 0 && c.clicks === 0);
}

export interface ParsedRecommendation {
  title: string;
  description: string;
  impact: "High" | "Medium" | "Low";
}

const VALID_IMPACT = new Set(["High", "Medium", "Low"]);

function coerceImpact(value: unknown): "High" | "Medium" | "Low" {
  const v = String(value ?? "").trim();
  const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return (VALID_IMPACT.has(cap) ? cap : "Medium") as "High" | "Medium" | "Low";
}

/** Parse the analyst's JSON: { summary, recommendations: [{title, description, impact}] }. */
export function parsePerformanceResponse(text: string): {
  summary: string | null;
  recommendations: ParsedRecommendation[];
} {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let obj: any = {};
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        obj = JSON.parse(match[0]);
      } catch {
        obj = {};
      }
    }
  }

  const summaryRaw = typeof obj?.summary === "string" ? obj.summary.trim() : "";
  const recsRaw = Array.isArray(obj?.recommendations) ? obj.recommendations : [];
  const recommendations: ParsedRecommendation[] = recsRaw
    .map((r: any) => ({
      title: String(r?.title ?? "").trim(),
      description: String(r?.description ?? "").trim(),
      impact: coerceImpact(r?.impact),
    }))
    .filter((r: ParsedRecommendation) => r.title && r.description);

  return { summary: summaryRaw || null, recommendations };
}

/** A compact, prompt-friendly digest of the metrics for the analyst. */
export function formatMetricsForPrompt(m: MarketingPerformanceMetrics): string {
  const lines: string[] = [];
  lines.push(
    `Totals — posts: ${m.totals.posts}, clicks: ${m.totals.clicks}, conversions: ${m.totals.conversions}, revenue(¢): ${m.totals.revenue}, sessions: ${m.totals.sessions}`,
  );
  if (m.benchmark?.hasBaseline) {
    lines.push(
      `Vs tenant baseline (100 = on par) — clicks index: ${m.benchmark.clicksIndex ?? "n/a"}, conversions index: ${m.benchmark.conversionsIndex ?? "n/a"}`,
    );
  }
  if (m.byCampaign.length) {
    lines.push("By campaign:");
    for (const c of m.byCampaign.slice(0, 15)) {
      lines.push(`- ${c.name}: ${c.posts} posts, ${c.clicks} clicks, ${c.conversions} conversions, ${c.revenue}¢`);
    }
  }
  if (m.perContent.length) {
    lines.push("Top content by clicks:");
    for (const c of m.perContent.slice(0, 15)) {
      lines.push(`- "${c.title}": ${c.postsPublished} posts, ${c.clicks} clicks`);
    }
  }
  return lines.join("\n");
}
