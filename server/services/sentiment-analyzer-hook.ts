/**
 * Task #102 — Indirection module for the storage.createActivity sentiment
 * hook. Lives in its own file so storage.ts can import it lazily and we
 * avoid the storage <- analyzer <- storage circular dependency.
 */

import { storage } from "../storage";
import type { Activity } from "@shared/schema";
import { analyzeArtifact, buildActivityAnalyzerText } from "./sentiment-analyzer";
import { detectAndDispatchToneShift } from "./sentiment-tone-shift";

/**
 * Score a freshly-created activity row in the background. Errors never
 * propagate so capture pipelines can't be broken by the analyzer.
 */
export function scheduleActivitySentimentAnalysis(act: Activity): void {
  // Detach from the caller's microtask queue so a slow LLM call cannot
  // delay the createActivity response.
  setImmediate(async () => {
    try {
      await analyzeAndStore(act);
    } catch (err) {
      console.warn(
        `[sentiment] background analyze failed for activity ${act.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  });
}

export async function analyzeAndStore(act: Activity): Promise<boolean> {
  if (!act.competitorId && !act.companyProfileId) return false;
  if (act.analyzedAt) return false;

  const text = buildActivityAnalyzerText({
    description: act.description,
    summary: act.summary,
    details: act.details,
  });
  const result = await analyzeArtifact(text, {
    competitorName: act.competitorName,
    artifactType: act.type,
    tenantDomain: act.tenantDomain || undefined,
  });
  // analyzeArtifact only ever returns null in pathological cases; short or
  // non-English text comes back as a skipped result that we still persist
  // (with analyzedAt set + a sentinel analyzerVersion) so the backfill
  // doesn't pick it up again. Without this, the newest-first
  // getUnanalyzedActivities query could starve older valid artifacts.
  if (!result) {
    await storage.updateActivitySentiment(act.id, {
      sentimentScore: null,
      toneLabel: null,
      toneNote: "No analyzable text content; skipped.",
      analyzerVersion: "skipped-empty/v1",
    });
    return false;
  }

  await storage.updateActivitySentiment(act.id, {
    sentimentScore: result.sentimentScore,
    toneLabel: result.toneLabel,
    toneNote: result.toneNote,
    analyzerVersion: result.analyzerVersion,
  });

  // After scoring, opportunistically check for a tone shift.
  // Errors are swallowed inside the detector.
  if (act.tenantDomain && act.competitorId) {
    detectAndDispatchToneShift(act.competitorId, act.tenantDomain).catch((err) => {
      console.warn(
        `[sentiment] tone-shift detection failed for ${act.competitorId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  return true;
}
