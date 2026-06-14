/**
 * Outreach Performance — pure analysis core.
 *
 * Closes the loop: turns a campaign's prospects + touches into a conversion-first
 * report and derives which ICP signals actually correlate with replies, so the
 * insight can feed back into prospect scoring (the Cowork performance-analyst,
 * conversion-first). No I/O, so it is unit-testable.
 */

import type { ProspectScoreBreakdown } from "@shared/schema";

export interface PerfProspect {
  status: string;
  icpScore: number | null;
  scoreBreakdown: ProspectScoreBreakdown | null;
}

export interface SignalPerformance {
  key: string;
  label: string;
  /** Prospects where this signal matched. */
  matched: number;
  /** Of those, how many replied. */
  matchedReplied: number;
  /** Reply rate among matched prospects (0–1), or null when no matched sample. */
  matchedReplyRate: number | null;
  /** Reply rate among prospects where the signal did NOT match. */
  unmatchedReplyRate: number | null;
  /** matchedReplyRate − unmatchedReplyRate; positive = this signal converts. */
  lift: number | null;
}

export interface OutreachPerformanceReport {
  total: number;
  contacted: number; // prospects past 'new'
  replied: number;
  replyRate: number; // replied / contacted (0–1)
  funnel: Record<string, number>;
  signals: SignalPerformance[];
  recommendations: string[];
}

const CONTACTED_STATES = new Set(["researched", "draft_pending_approval", "sent", "awaiting_reply", "replied", "cadence_step_due", "dormant"]);

function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/**
 * Build the conversion-first report. "Contacted" = past `new`; reply rate is
 * over contacted. Signal lift compares reply rate when a signal matched vs not.
 */
export function analyzeOutreachPerformance(prospects: PerfProspect[]): OutreachPerformanceReport {
  const total = prospects.length;
  const funnel: Record<string, number> = {};
  for (const p of prospects) funnel[p.status] = (funnel[p.status] ?? 0) + 1;

  const contactedProspects = prospects.filter((p) => CONTACTED_STATES.has(p.status));
  const contacted = contactedProspects.length;
  const isReplied = (p: PerfProspect) => p.status === "replied";
  const replied = prospects.filter(isReplied).length;

  // Signal performance over CONTACTED prospects (those we actually worked).
  const signalKeys = new Map<string, string>(); // key -> label
  for (const p of contactedProspects) {
    for (const s of p.scoreBreakdown?.signals ?? []) {
      if (s.key !== "disqualifier") signalKeys.set(s.key, s.label);
    }
  }

  const signals: SignalPerformance[] = [];
  for (const [key, label] of Array.from(signalKeys)) {
    let matched = 0, matchedReplied = 0, unmatched = 0, unmatchedReplied = 0;
    for (const p of contactedProspects) {
      const sig = p.scoreBreakdown?.signals?.find((x) => x.key === key);
      const did = !!sig?.matched;
      if (did) {
        matched++;
        if (isReplied(p)) matchedReplied++;
      } else {
        unmatched++;
        if (isReplied(p)) unmatchedReplied++;
      }
    }
    const matchedReplyRate = rate(matchedReplied, matched);
    const unmatchedReplyRate = rate(unmatchedReplied, unmatched);
    const lift =
      matchedReplyRate != null && unmatchedReplyRate != null ? matchedReplyRate - unmatchedReplyRate : null;
    signals.push({ key, label, matched, matchedReplied, matchedReplyRate, unmatchedReplyRate, lift });
  }
  // Strongest converting signals first.
  signals.sort((a, b) => (b.lift ?? -Infinity) - (a.lift ?? -Infinity));

  const replyRate = rate(replied, contacted) ?? 0;

  const recommendations: string[] = [];
  if (contacted < 5) {
    recommendations.push("Too few contacted prospects to draw conclusions — keep working the list.");
  } else {
    const best = signals.find((s) => s.lift != null && s.lift > 0.05 && s.matched >= 3);
    if (best) {
      recommendations.push(
        `"${best.label}" prospects reply ${Math.round((best.lift as number) * 100)} pts more often — weight this higher and source more like them.`,
      );
    }
    const worst = [...signals].reverse().find((s) => s.lift != null && s.lift < -0.05 && s.matched >= 3);
    if (worst) {
      recommendations.push(`"${worst.label}" prospects under-convert — consider tightening or dropping this from targeting.`);
    }
    if (replyRate < 0.05) {
      recommendations.push("Reply rate is low — revisit the offer, voice, or ICP fit before scaling sends.");
    }
  }

  return { total, contacted, replied, replyRate, funnel, signals, recommendations };
}
