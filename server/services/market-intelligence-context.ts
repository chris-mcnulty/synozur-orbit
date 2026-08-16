// ─────────────────────────────────────────────────────────────────────────────
// Strategic Intelligence Stack → prompt context for GTM plan generation.
//
// The GTM plan used to read only products/competitors/personas, so a
// regenerated plan could contradict a completed market study. This module
// loads the tenant+market's active market segments (ranked, with TAM/SAM),
// top-ROI opportunity-matrix cells, and the latest completed market study's
// executive summary, and formats them as a prompt block. When no SIS data
// exists it returns "" so behavior is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import {
  marketSegments,
  opportunityMatrixCells,
  marketStudies,
  type MarketSegment,
  type OpportunityMatrixCell,
} from "@shared/schema";
import { and, desc, eq, isNotNull, inArray } from "drizzle-orm";

const TOP_SEGMENTS = 5;
const TOP_CELLS = 8;

function formatMoney(amount: number | null | undefined, currency: string): string | null {
  if (amount == null) return null;
  const abs = Math.abs(amount);
  let value: string;
  if (abs >= 1_000_000_000) value = `${(amount / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000) value = `${(amount / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) value = `${(amount / 1_000).toFixed(0)}K`;
  else value = `${amount}`;
  return `${currency} ${value}`;
}

function segmentSizing(seg: MarketSegment): string {
  const cur = seg.sizingCurrency || "USD";
  const tam = formatMoney(seg.tamUserOverride ?? seg.tamMid, cur);
  const sam = formatMoney(seg.samUserOverride ?? seg.samMid, cur);
  const parts: string[] = [];
  if (tam) parts.push(`TAM ~${tam}`);
  if (sam) parts.push(`SAM ~${sam}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Build a prompt block from the Strategic Intelligence Stack (market segments,
 * opportunity matrix, market study). Returns "" when the tenant/market has no
 * SIS data so callers can splice it in unconditionally.
 */
export async function buildMarketIntelligenceContext(
  tenantDomain: string,
  marketId: string | null | undefined,
): Promise<string> {
  // Segments/cells/studies are all market-scoped; without a market there is
  // nothing to safely attribute (NULL-marketId rows are orphaned by design).
  if (!marketId) return "";

  const [segments, latestStudies] = await Promise.all([
    db
      .select()
      .from(marketSegments)
      .where(
        and(
          eq(marketSegments.tenantDomain, tenantDomain),
          eq(marketSegments.marketId, marketId),
          eq(marketSegments.status, "active"),
        ),
      )
      .orderBy(desc(marketSegments.priorityScore))
      .limit(TOP_SEGMENTS),
    db
      .select()
      .from(marketStudies)
      .where(
        and(
          eq(marketStudies.tenantDomain, tenantDomain),
          eq(marketStudies.marketId, marketId),
          eq(marketStudies.status, "completed"),
        ),
      )
      .orderBy(desc(marketStudies.createdAt))
      .limit(1),
  ]);

  // Matrix cells: rank by ROI within the tenant/market. Join to segments only
  // for naming — restrict to the loaded segments when possible, otherwise load
  // names for whatever segments the top cells reference.
  const cells: OpportunityMatrixCell[] = await db
    .select()
    .from(opportunityMatrixCells)
    .where(
      and(
        eq(opportunityMatrixCells.tenantDomain, tenantDomain),
        eq(opportunityMatrixCells.marketId, marketId),
        isNotNull(opportunityMatrixCells.roiScore),
      ),
    )
    .orderBy(desc(opportunityMatrixCells.roiScore))
    .limit(TOP_CELLS);

  const study = latestStudies[0];
  const executiveSummary = study?.executiveSummary?.trim() || "";

  if (segments.length === 0 && cells.length === 0 && !executiveSummary) return "";

  // Segment names for cells whose segment fell outside the top-N list.
  const segNameById = new Map(segments.map((s) => [s.id, s.name]));
  const missingSegIds = Array.from(
    new Set(cells.map((c) => c.segmentId).filter((id) => !segNameById.has(id))),
  );
  if (missingSegIds.length > 0) {
    const extra = await db
      .select({ id: marketSegments.id, name: marketSegments.name })
      .from(marketSegments)
      .where(
        and(
          eq(marketSegments.tenantDomain, tenantDomain),
          inArray(marketSegments.id, missingSegIds),
        ),
      );
    for (const s of extra) segNameById.set(s.id, s.name);
  }

  const lines: string[] = [
    "",
    "STRATEGIC MARKET INTELLIGENCE (from the completed market analysis — treat this as the authoritative view of segments and channel opportunities):",
  ];

  if (executiveSummary) {
    lines.push("", "Market Study Executive Summary:", executiveSummary);
  }

  if (segments.length > 0) {
    lines.push("", "Top Market Segments (ranked by priority):");
    for (const seg of segments) {
      const priority = seg.priorityScore != null ? ` [priority ${seg.priorityScore}/10]` : "";
      lines.push(`- ${seg.name}${priority}${segmentSizing(seg)}${seg.description ? ` — ${seg.description}` : ""}`);
      const needs = (seg.needsMap as { pains?: string[] } | null)?.pains;
      if (Array.isArray(needs) && needs.length > 0) {
        lines.push(`  Key pains: ${needs.slice(0, 4).join("; ")}`);
      }
    }
  }

  if (cells.length > 0) {
    lines.push("", "Top GTM Opportunities (segment × need × channel, ranked by ROI):");
    for (const cell of cells) {
      const segName = segNameById.get(cell.segmentId) || "Unknown segment";
      const roi = cell.roiScore != null ? ` [ROI ${Math.round(cell.roiScore)}/100]` : "";
      const whitespace = cell.isWhitespace ? " (whitespace opportunity)" : "";
      lines.push(`- ${segName} → "${cell.needLabel}" via ${cell.channelKey}${roi}${whitespace}`);
    }
  }

  lines.push(
    "",
    "The GTM plan MUST build on this intelligence: prioritize the top-ranked segments above (citing them by name with their TAM/SAM where given), and anchor the channel/distribution strategy in the top-ROI opportunities listed. Do not contradict the market study.",
  );

  return lines.join("\n");
}
