/**
 * Task #102 — Tone-shift detector.
 *
 * Compares the trailing 7-day mean sentiment vs a prior 30-day baseline
 * (the 30 days immediately preceding the recent 7-day window — so we look
 * at days 8..37 ago). All windows bin by the artifact's CAPTURE TIME
 * (`createdAt`), never by `analyzedAt`.
 *
 * Fires the `competitor_tone_shift` notification event when:
 *   - |delta of mean sentiment| >= 0.30, OR
 *   - any tone label appears in the last 7 days that has not been seen
 *     in the prior 90 days (first-occurrence tone — even if it's not
 *     dominant in the recent window, a brand-new tone is itself a shift).
 *
 * Each competitor can fire at most once per 24 hours to avoid
 * notification spam during a sustained shift.
 */

import { storage } from "../storage";
import { notifications } from "./notifications";
import type { Activity, ToneLabel } from "@shared/schema";

const SHIFT_THRESHOLD = 0.3;
const RECENT_WINDOW_DAYS = 7;
const PRIOR_WINDOW_DAYS = 30; // baseline: 30 days prior to the recent window
const NEW_TONE_LOOKBACK_DAYS = 90;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_RECENT_SAMPLES = 3;
const MIN_PRIOR_SAMPLES = 5;

const lastFiredAt: Map<string, number> = new Map();

interface ToneStats {
  count: number;
  meanSentiment: number;
  dominantTone: ToneLabel | null;
  toneCounts: Record<string, number>;
}

function captureTime(r: Activity): number {
  const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
  if (Number.isFinite(t)) return t;
  return r.analyzedAt ? new Date(r.analyzedAt).getTime() : 0;
}

function summarize(rows: Activity[]): ToneStats {
  if (rows.length === 0) {
    return { count: 0, meanSentiment: 0, dominantTone: null, toneCounts: {} };
  }
  let sum = 0;
  const tones: Record<string, number> = {};
  for (const r of rows) {
    if (typeof r.sentimentScore === "number") sum += r.sentimentScore;
    if (r.toneLabel) tones[r.toneLabel] = (tones[r.toneLabel] || 0) + 1;
  }
  let dominantTone: ToneLabel | null = null;
  let best = 0;
  for (const [k, v] of Object.entries(tones)) {
    if (v > best) {
      best = v;
      dominantTone = k as ToneLabel;
    }
  }
  return {
    count: rows.length,
    meanSentiment: sum / rows.length,
    dominantTone,
    toneCounts: tones,
  };
}

export interface ToneShiftDecision {
  shifted: boolean;
  reason?: "sentiment_delta" | "new_tone";
  newTone?: ToneLabel | null;
  recent: ToneStats;
  prior: ToneStats;
  delta: number;
}

export async function evaluateToneShift(competitorId: string): Promise<ToneShiftDecision> {
  const rows = await storage.getAnalyzedActivitiesByCompetitor(competitorId, NEW_TONE_LOOKBACK_DAYS);
  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const priorCutoff = now - (RECENT_WINDOW_DAYS + PRIOR_WINDOW_DAYS) * 24 * 60 * 60 * 1000;

  const recent: Activity[] = [];
  const prior: Activity[] = [];
  const longTail: Activity[] = []; // 8..90 days ago, used for first-occurrence detection

  for (const r of rows) {
    const t = captureTime(r);
    if (!t) continue;
    if (t >= recentCutoff) recent.push(r);
    else if (t >= priorCutoff) prior.push(r);
    if (t < recentCutoff) longTail.push(r);
  }

  const recentStats = summarize(recent);
  const priorStats = summarize(prior);
  const delta = recentStats.meanSentiment - priorStats.meanSentiment;

  // First-occurrence tone detection runs for ANY recent activity — even a
  // single new artifact introducing a brand-new tone is itself a shift.
  // We require established history (>= MIN_PRIOR_SAMPLES in the 8..90d
  // long-tail) so we don't flag tones that just haven't been seen yet
  // because the competitor is new.
  if (recent.length > 0 && longTail.length >= MIN_PRIOR_SAMPLES) {
    const longTailTones = new Set(longTail.map((r) => r.toneLabel).filter(Boolean) as string[]);
    for (const tone of Object.keys(recentStats.toneCounts)) {
      if (!longTailTones.has(tone)) {
        return {
          shifted: true,
          reason: "new_tone",
          newTone: tone as ToneLabel,
          recent: recentStats,
          prior: priorStats,
          delta,
        };
      }
    }
  }

  // Sentiment-delta detection requires enough samples on both sides to
  // make the mean comparison meaningful.
  if (recentStats.count < MIN_RECENT_SAMPLES) {
    return { shifted: false, recent: recentStats, prior: priorStats, delta };
  }
  if (priorStats.count >= MIN_PRIOR_SAMPLES && Math.abs(delta) >= SHIFT_THRESHOLD) {
    return { shifted: true, reason: "sentiment_delta", recent: recentStats, prior: priorStats, delta };
  }

  return { shifted: false, recent: recentStats, prior: priorStats, delta };
}

export async function detectAndDispatchToneShift(
  competitorId: string,
  tenantDomain: string,
): Promise<void> {
  const lastFired = lastFiredAt.get(competitorId) || 0;
  if (Date.now() - lastFired < COOLDOWN_MS) return;

  const decision = await evaluateToneShift(competitorId);
  if (!decision.shifted) return;

  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) return;

  lastFiredAt.set(competitorId, Date.now());

  // For new_tone shifts, surface the *new* tone (not the recent dominant)
  // so the alert names what actually changed.
  const surfaceTone = decision.reason === "new_tone"
    ? (decision.newTone ?? decision.recent.dominantTone)
    : decision.recent.dominantTone;

  await notifications.dispatch(tenantDomain, "competitor_tone_shift", {
    competitorId,
    competitorName: competitor.name,
    reason: decision.reason || "sentiment_delta",
    recentMean: Number(decision.recent.meanSentiment.toFixed(3)),
    priorMean: Number(decision.prior.meanSentiment.toFixed(3)),
    delta: Number(decision.delta.toFixed(3)),
    dominantTone: surfaceTone,
    sampleCount: decision.recent.count,
  });
}
