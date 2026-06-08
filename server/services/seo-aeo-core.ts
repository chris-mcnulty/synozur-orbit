/**
 * SEO/AEO Optimizer — pure core.
 *
 * Guardrail enforcement (search-metadata length limits), internal-link
 * validation against the tenant's real content inventory (drops hallucinated
 * links), and response parsing. No I/O, so it is unit-testable.
 */

import type { OptimizationQA, InternalLinkSuggestion } from "@shared/schema";

export const SEO_TITLE_MAX = 60;
export const META_DESC_MAX = 155;

/** Trim to a max length at a word boundary (no mid-word cuts, no ellipsis). */
export function clampToLength(value: string | null | undefined, max: number): string | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Normalize a slug: lowercase, alphanumerics + single hyphens. */
export function normalizeSlug(value: string | null | undefined): string | null {
  const s = (value ?? "").trim().toLowerCase();
  if (!s) return null;
  const slug = s
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || null;
}

export interface InventoryItem {
  id: string;
  title: string;
}

/**
 * Keep only internal-link suggestions that point at an asset that actually
 * exists in the inventory, dropping any the model invented. The canonical
 * title from the inventory replaces whatever the model returned.
 */
export function validateInternalLinks(
  suggestions: any[],
  inventory: InventoryItem[],
  excludeAssetId?: string,
): InternalLinkSuggestion[] {
  const byId = new Map(inventory.map((i) => [i.id, i.title]));
  const seen = new Set<string>();
  const out: InternalLinkSuggestion[] = [];
  for (const raw of Array.isArray(suggestions) ? suggestions : []) {
    const targetAssetId = String(raw?.targetAssetId ?? raw?.assetId ?? "").trim();
    if (!targetAssetId || !byId.has(targetAssetId)) continue;
    if (excludeAssetId && targetAssetId === excludeAssetId) continue;
    if (seen.has(targetAssetId)) continue;
    seen.add(targetAssetId);
    const anchorText = String(raw?.anchorText ?? raw?.anchor ?? "").trim();
    out.push({
      anchorText: anchorText || byId.get(targetAssetId)!,
      targetAssetId,
      targetTitle: byId.get(targetAssetId)!,
      reason: String(raw?.reason ?? "").trim(),
    });
  }
  return out;
}

function normalizeQA(raw: any[]): OptimizationQA[] {
  return (Array.isArray(raw) ? raw : [])
    .map((q) => ({
      question: String(q?.question ?? "").trim(),
      answer: String(q?.answer ?? "").trim(),
    }))
    .filter((q) => q.question && q.answer);
}

function asStringArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

export interface ParsedOptimization {
  seoTitle: string | null;
  metaDescription: string | null;
  slug: string | null;
  targetKeyword: string | null;
  keywords: string[];
  answerBlocks: OptimizationQA[];
  faq: OptimizationQA[];
  internalLinks: InternalLinkSuggestion[];
  contentGaps: string[];
}

/**
 * Parse the optimizer's JSON response and apply all guardrails: clamp the
 * title/meta, normalize the slug, and validate internal links against the
 * inventory. Tolerant of fenced or noisy responses.
 */
export function parseOptimizationResponse(
  text: string,
  inventory: InventoryItem[],
  excludeAssetId?: string,
): ParsedOptimization {
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

  return {
    seoTitle: clampToLength(obj?.seoTitle ?? obj?.title, SEO_TITLE_MAX),
    metaDescription: clampToLength(obj?.metaDescription ?? obj?.meta, META_DESC_MAX),
    slug: normalizeSlug(obj?.slug),
    targetKeyword: (() => {
      const k = String(obj?.targetKeyword ?? "").trim();
      return k || null;
    })(),
    keywords: asStringArray(obj?.keywords),
    answerBlocks: normalizeQA(obj?.answerBlocks),
    faq: normalizeQA(obj?.faq),
    internalLinks: validateInternalLinks(obj?.internalLinks ?? obj?.internalLinkSuggestions, inventory, excludeAssetId),
    contentGaps: asStringArray(obj?.contentGaps),
  };
}
