/**
 * Helpers for building AI prompt context from per-competitor uploaded documents.
 */
import { storage } from "../storage";
import { documentExtractionService } from "./document-extraction";
import type { CompetitorDocument } from "@shared/schema";

const DEFAULT_TOKEN_BUDGET = 4000;

export interface CompetitorDocSource {
  id: string;
  competitorId: string;
  displayTitle: string;
  scopeTag: string | null;
}

export interface CompetitorContextResult {
  context: string;
  sources: CompetitorDocSource[];
}

/**
 * Build grounding context string from active competitor documents for a single
 * competitor.  Returns the prepared context and the list of source doc ids
 * that contributed (for "Sources used" surfacing).
 */
export async function buildCompetitorDocumentContext(
  tenantDomain: string,
  competitorId: string,
  options: { tokenBudget?: number } = {},
): Promise<CompetitorContextResult> {
  const docs = await storage.getActiveCompetitorDocumentsByCompetitor(competitorId);
  const tenantDocs = docs.filter((d) => d.tenantDomain === tenantDomain && d.extractedText);
  if (tenantDocs.length === 0) {
    return { context: "", sources: [] };
  }

  const prepared = documentExtractionService.prepareGroundingContext(
    tenantDocs.map((d) => ({
      name: d.scopeTag ? `${d.displayTitle} [${d.scopeTag}]` : d.displayTitle,
      extractedText: d.extractedText,
      scope: "competitor",
    })),
    options.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  );

  const labelled = prepared
    ? prepared.replace(
        "=== GROUNDING DOCUMENTS (Company Positioning & Strategy) ===",
        "=== COMPETITOR DOCUMENTS (First-Party Intel Uploaded by Tenant) ===",
      )
    : "";

  // Only report docs that actually survived the token budget — i.e. their
  // labelled name still appears in the prepared grounding string.
  const survived = tenantDocs.filter((d) => labelled.includes(d.displayTitle));

  return {
    context: labelled,
    sources: survived.map((d) => ({
      id: d.id,
      competitorId: d.competitorId,
      displayTitle: d.displayTitle,
      scopeTag: d.scopeTag,
    })),
  };
}

/**
 * Build a combined grounding context across an entire set of competitors
 * (used by gap analysis, executive summary, and intelligence briefings).
 * Each competitor's docs are clearly labeled so the AI can attribute intel
 * to the correct competitor.
 */
export async function buildCompetitorDocumentContextForCompetitors(
  tenantDomain: string,
  competitorIds: string[],
  options: { tokenBudget?: number } = {},
): Promise<CompetitorContextResult> {
  if (competitorIds.length === 0) return { context: "", sources: [] };
  const budget = options.tokenBudget ?? 6000;
  const perCompetitor = Math.max(800, Math.floor(budget / Math.max(1, competitorIds.length)));

  const sections: string[] = [];
  const sources: CompetitorDocSource[] = [];

  for (const competitorId of competitorIds) {
    const competitor = await storage.getCompetitor(competitorId);
    if (!competitor || competitor.tenantDomain !== tenantDomain) continue;
    const docs = await storage.getActiveCompetitorDocumentsByCompetitor(competitorId);
    const tenantDocs = docs.filter((d) => d.tenantDomain === tenantDomain && d.extractedText);
    if (tenantDocs.length === 0) continue;

    const prepared = documentExtractionService.prepareGroundingContext(
      tenantDocs.map((d) => ({
        name: d.scopeTag ? `${d.displayTitle} [${d.scopeTag}]` : d.displayTitle,
        extractedText: d.extractedText,
        scope: "competitor",
      })),
      perCompetitor,
    );
    if (prepared) {
      sections.push(`### Competitor: ${competitor.name}\n${prepared.replace(
        "=== GROUNDING DOCUMENTS (Company Positioning & Strategy) ===\n\n",
        "",
      )}`);
      // Only report docs that actually survived budgeting
      tenantDocs
        .filter((d) => prepared.includes(d.displayTitle))
        .forEach((d) =>
          sources.push({
            id: d.id,
            competitorId: d.competitorId,
            displayTitle: d.displayTitle,
            scopeTag: d.scopeTag,
          }),
        );
    }
  }

  if (sections.length === 0) return { context: "", sources: [] };
  return {
    context: `=== COMPETITOR DOCUMENTS (First-Party Intel Uploaded by Tenant) ===\n\n${sections.join("\n\n")}`,
    sources,
  };
}

/**
 * Convenience: typed helper for storing the "sources used" list on an
 * analysis blob without resorting to `as any`.
 */
export type AnalysisWithSources<T> = T & { competitorDocSources?: CompetitorDocSource[] };


/**
 * Concatenate company grounding context (already-prepared string) with
 * competitor-document context, separated cleanly so the AI can distinguish
 * "our positioning" from "intel about the competitor".
 */
export function mergeGroundingContext(
  companyContext: string | undefined,
  competitorContext: string | undefined,
): string | undefined {
  const parts = [companyContext, competitorContext].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

