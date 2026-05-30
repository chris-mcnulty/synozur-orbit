/**
 * Task #102 — Helpers for injecting tone/sentiment context into other AI
 * features (briefings, battlecards) and for the competitor-detail UI panel.
 *
 * IMPORTANT: All trend/window math bins by the artifact's `createdAt`
 * (capture time), NOT by `analyzedAt`. Otherwise a 90-day backfill would
 * stamp every old artifact with today's analyzedAt and collapse the
 * sparkline. `analyzedAt` is metadata only.
 */

import { storage } from "../storage";
import type { Activity } from "@shared/schema";

export interface ToneShiftEvent {
  date: string; // ISO date for the day the new tone first appeared
  fromTone: string | null;
  toTone: string;
}

export interface ToneSummary {
  totalAnalyzed: number;
  meanSentiment: number | null;        // entire window
  meanSentiment30d: number | null;     // last 30 days
  meanSentiment90d: number | null;     // last 90 days
  recentMeanSentiment: number | null;  // last 7 days
  dominantTone: string | null;
  toneCounts: Record<string, number>;
  sparkline: { date: string; sentiment: number; toneLabel: string | null }[];
  topNotes: { date: string; toneLabel: string | null; sentimentScore: number; note: string }[];
  toneShifts: ToneShiftEvent[];
}

function captureTime(r: Activity): number {
  // createdAt is non-null on activity rows; fall back to analyzedAt only if
  // an unexpected legacy row is missing it.
  const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
  if (Number.isFinite(t)) return t;
  return r.analyzedAt ? new Date(r.analyzedAt).getTime() : 0;
}

function meanSince(rows: Activity[], days: number, now: number): number | null {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const slice = rows.filter((r) => captureTime(r) >= cutoff && typeof r.sentimentScore === "number");
  if (slice.length === 0) return null;
  const m = slice.reduce((s, r) => s + (r.sentimentScore || 0), 0) / slice.length;
  return Number(m.toFixed(3));
}

function summarizeRows(rows: Activity[]): ToneSummary {
  const scored = rows.filter((r) => typeof r.sentimentScore === "number");
  if (scored.length === 0) {
    return {
      totalAnalyzed: 0,
      meanSentiment: null,
      meanSentiment30d: null,
      meanSentiment90d: null,
      recentMeanSentiment: null,
      dominantTone: null,
      toneCounts: {},
      sparkline: [],
      topNotes: [],
      toneShifts: [],
    };
  }
  const now = Date.now();
  const meanSentiment = scored.reduce((s, r) => s + (r.sentimentScore || 0), 0) / scored.length;

  const toneCounts: Record<string, number> = {};
  for (const r of scored) {
    if (r.toneLabel) toneCounts[r.toneLabel] = (toneCounts[r.toneLabel] || 0) + 1;
  }
  const dominantTone = Object.entries(toneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Order oldest -> newest by capture time for sparkline + shift detection
  const ordered = [...scored].sort((a, b) => captureTime(a) - captureTime(b));

  const sparkline = ordered.slice(-30).map((r) => ({
    date: new Date(captureTime(r)).toISOString(),
    sentiment: r.sentimentScore || 0,
    toneLabel: r.toneLabel || null,
  }));

  const topNotes = [...ordered]
    .reverse()
    .map((r) => ({
      date: new Date(captureTime(r)).toISOString(),
      toneLabel: r.toneLabel || null,
      sentimentScore: r.sentimentScore || 0,
      note: r.toneNote || "",
    }))
    .filter((n) => n.note.length > 0)
    .slice(0, 5);

  // Tone-shift events: when the dominant tone for a calendar day differs
  // from the previous day's dominant tone in the window. Surfaces lines
  // like "Shifted from confident to defensive on May 1".
  const toneShifts: ToneShiftEvent[] = [];
  const byDay: Record<string, Record<string, number>> = {};
  for (const r of ordered) {
    if (!r.toneLabel) continue;
    const day = new Date(captureTime(r)).toISOString().slice(0, 10);
    byDay[day] = byDay[day] || {};
    byDay[day][r.toneLabel] = (byDay[day][r.toneLabel] || 0) + 1;
  }
  const dailyDominant = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => {
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return { day, tone: top?.[0] || null };
    });
  let prevTone: string | null = null;
  for (const d of dailyDominant) {
    if (d.tone && d.tone !== prevTone) {
      if (prevTone !== null) {
        toneShifts.push({ date: d.day, fromTone: prevTone, toTone: d.tone });
      }
      prevTone = d.tone;
    }
  }

  return {
    totalAnalyzed: scored.length,
    meanSentiment: Number(meanSentiment.toFixed(3)),
    meanSentiment30d: meanSince(scored, 30, now),
    meanSentiment90d: meanSince(scored, 90, now),
    recentMeanSentiment: meanSince(scored, 7, now),
    dominantTone,
    toneCounts,
    sparkline,
    topNotes,
    toneShifts: toneShifts.slice(-5).reverse(),
  };
}

export async function getCompetitorToneSummary(
  competitorId: string,
  sinceDays: number = 90,
): Promise<ToneSummary> {
  const rows = await storage.getAnalyzedActivitiesByCompetitor(competitorId, sinceDays);
  return summarizeRows(rows);
}

export async function getBaselineToneSummary(
  companyProfileId: string,
  sinceDays: number = 90,
): Promise<ToneSummary> {
  const rows = await storage.getAnalyzedActivitiesByCompanyProfile(companyProfileId, sinceDays);
  return summarizeRows(rows);
}

/**
 * Build a markdown context block for AI prompts (briefings, battlecards).
 * Returns empty string when there's no analyzed data so it doesn't pollute
 * prompts for newly-added competitors.
 */
export async function buildCompetitorToneContextBlock(
  competitorId: string,
  sinceDays: number = 30,
): Promise<string> {
  const summary = await getCompetitorToneSummary(competitorId, sinceDays);
  if (summary.totalAnalyzed === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push(`Competitor Tone & Sentiment (last ${sinceDays} days, n=${summary.totalAnalyzed}):`);
  if (summary.meanSentiment !== null) {
    lines.push(`- Mean sentiment: ${summary.meanSentiment.toFixed(2)} (-1 negative, +1 positive)`);
  }
  if (summary.meanSentiment30d !== null) {
    lines.push(`- 30-day mean sentiment: ${summary.meanSentiment30d.toFixed(2)}`);
  }
  if (summary.recentMeanSentiment !== null && summary.recentMeanSentiment !== summary.meanSentiment30d) {
    lines.push(`- Last 7 days mean sentiment: ${summary.recentMeanSentiment.toFixed(2)}`);
  }
  if (summary.dominantTone) {
    lines.push(`- Dominant tone: ${summary.dominantTone}`);
  }
  const toneList = Object.entries(summary.toneCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
  if (toneList) lines.push(`- Tone distribution: ${toneList}`);
  if (summary.toneShifts.length > 0) {
    lines.push(`- Recent tone shifts:`);
    for (const s of summary.toneShifts.slice(0, 3)) {
      lines.push(`  • Shifted from ${s.fromTone || "unknown"} to ${s.toTone} on ${s.date}`);
    }
  }
  if (summary.topNotes.length > 0) {
    lines.push(`- Recent tone notes:`);
    for (const n of summary.topNotes.slice(0, 3)) {
      lines.push(`  • [${n.toneLabel || "n/a"}] ${n.note}`);
    }
  }
  return lines.join("\n");
}
