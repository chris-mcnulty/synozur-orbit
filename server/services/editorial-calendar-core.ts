/**
 * Editorial Calendar — pure core.
 *
 * Funnel-mix math, enum coercion, and calendar quality guardrails. No I/O, so
 * it is unit-testable. Mirrors the Cowork content-strategist's rules: every
 * brief needs a demand signal, the calendar should be funnel-balanced
 * (default 40% awareness / 35% consideration / 25% decision), and topics need
 * a real differentiation angle and a specific target reader.
 */

import {
  CONTENT_BRIEF_FORMATS,
  FUNNEL_STAGES,
  type ContentBriefFormat,
  type FunnelStage,
} from "@shared/schema";

export interface DraftBrief {
  title: string;
  format: ContentBriefFormat;
  targetKeyword: string | null;
  demandSignal: string | null;
  funnelStage: FunnelStage;
  differentiationAngle: string | null;
  targetReader: string | null;
  cta: string | null;
  channels: string[];
  estimatedHours: number | null;
}

export interface FunnelTargets {
  awareness: number;
  consideration: number;
  decision: number;
}

export const DEFAULT_FUNNEL_TARGETS: FunnelTargets = {
  awareness: 40,
  consideration: 35,
  decision: 25,
};

export function coerceFormat(value: unknown): ContentBriefFormat {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (CONTENT_BRIEF_FORMATS as readonly string[]).includes(v)
    ? (v as ContentBriefFormat)
    : "other";
}

export function coerceFunnelStage(value: unknown): FunnelStage {
  const v = String(value ?? "").trim().toLowerCase();
  return (FUNNEL_STAGES as readonly string[]).includes(v)
    ? (v as FunnelStage)
    : "awareness";
}

/**
 * Normalize a raw AI-produced brief object into a typed DraftBrief.
 * Returns null when there is no usable title.
 */
export function normalizeBrief(raw: any): DraftBrief | null {
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  if (!title) return null;

  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };

  let channels: string[] = [];
  if (Array.isArray(raw?.channels)) {
    channels = raw.channels.map((c: unknown) => String(c).trim()).filter(Boolean);
  } else if (typeof raw?.channels === "string") {
    channels = raw.channels.split(",").map((c: string) => c.trim()).filter(Boolean);
  }

  const hoursRaw = raw?.estimatedHours ?? raw?.estimated_hours;
  const hours = typeof hoursRaw === "number"
    ? hoursRaw
    : typeof hoursRaw === "string" && hoursRaw.trim() !== "" && !Number.isNaN(Number(hoursRaw))
      ? Number(hoursRaw)
      : null;

  return {
    title,
    format: coerceFormat(raw?.format),
    targetKeyword: str(raw?.targetKeyword ?? raw?.target_keyword ?? raw?.keyword),
    demandSignal: str(raw?.demandSignal ?? raw?.demand_signal),
    funnelStage: coerceFunnelStage(raw?.funnelStage ?? raw?.funnel_stage ?? raw?.stage),
    differentiationAngle: str(raw?.differentiationAngle ?? raw?.differentiation_angle ?? raw?.angle),
    targetReader: str(raw?.targetReader ?? raw?.target_reader ?? raw?.reader),
    cta: str(raw?.cta ?? raw?.callToAction ?? raw?.call_to_action),
    channels,
    estimatedHours: hours,
  };
}

export interface FunnelBreakdown {
  counts: Record<FunnelStage, number>;
  percentages: Record<FunnelStage, number>;
  total: number;
}

export function computeFunnelBreakdown(briefs: DraftBrief[]): FunnelBreakdown {
  const counts: Record<FunnelStage, number> = { awareness: 0, consideration: 0, decision: 0 };
  for (const b of briefs) counts[b.funnelStage]++;
  const total = briefs.length;
  const percentages: Record<FunnelStage, number> = { awareness: 0, consideration: 0, decision: 0 };
  if (total > 0) {
    for (const stage of FUNNEL_STAGES) {
      percentages[stage] = Math.round((counts[stage] / total) * 100);
    }
  }
  return { counts, percentages, total };
}

/**
 * Non-blocking quality warnings for a generated calendar. We surface these
 * rather than rejecting outright (the Cowork skill hard-rejects; in-product we
 * prefer to show and let the user fix), mirroring its rejection criteria.
 */
export function assessCalendarWarnings(
  briefs: DraftBrief[],
  opts: { minBriefs?: number; maxSingleStagePct?: number } = {},
): string[] {
  const minBriefs = opts.minBriefs ?? 15;
  const maxSingleStagePct = opts.maxSingleStagePct ?? 50;
  const warnings: string[] = [];

  if (briefs.length < minBriefs) {
    warnings.push(`Only ${briefs.length} briefs — aim for at least ${minBriefs}.`);
  }

  const { percentages } = computeFunnelBreakdown(briefs);
  for (const stage of FUNNEL_STAGES) {
    if (percentages[stage] > maxSingleStagePct) {
      warnings.push(`${percentages[stage]}% of briefs are ${stage}-stage — over the ${maxSingleStagePct}% concentration limit.`);
    }
  }

  const noDemand = briefs.filter((b) => !b.demandSignal).length;
  if (noDemand > 0) {
    warnings.push(`${noDemand} brief(s) have no demand signal.`);
  }

  const noAngle = briefs.filter((b) => !b.differentiationAngle).length;
  if (noAngle > 0) {
    warnings.push(`${noAngle} brief(s) have no differentiation angle.`);
  }

  const noReader = briefs.filter((b) => !b.targetReader).length;
  if (noReader > 0) {
    warnings.push(`${noReader} brief(s) have no specific target reader.`);
  }

  return warnings;
}
