import type { LongFormRecommendation } from "@shared/schema";

export function getLongFormRecommendationGeneratedAt(
  rec: Pick<LongFormRecommendation, "lastGeneratedAt" | "updatedAt" | "createdAt">,
): Date | null {
  return rec.lastGeneratedAt || rec.updatedAt || rec.createdAt || null;
}

export function pickLatestLongFormRecommendation(
  recs: LongFormRecommendation[],
  type: "gtm_plan" | "messaging_framework",
): LongFormRecommendation | null {
  const matches = recs.filter(r => r.type === type && r.status === "generated" && !!r.content);
  if (matches.length === 0) return null;
  return matches.reduce((latest, r) => {
    const rTs = getLongFormRecommendationGeneratedAt(r)?.getTime() ?? 0;
    const lTs = getLongFormRecommendationGeneratedAt(latest)?.getTime() ?? 0;
    return rTs > lTs ? r : latest;
  });
}
