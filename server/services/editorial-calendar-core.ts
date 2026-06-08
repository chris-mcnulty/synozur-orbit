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

// ── Copywriter (draft-from-brief) helpers ──────────────────────────────────

/**
 * Per-format drafting guidance injected into the copywriter prompt. Keeps the
 * structure/length expectations for each content format in one testable place.
 */
export const FORMAT_GUIDANCE: Record<ContentBriefFormat, string> = {
  blog_post:
    "Write a 700-1100 word blog post in Markdown: a compelling H1, a hook intro, 3-5 H2 sections with skimmable subheads, and a short conclusion that leads into the CTA. Weave the target keyword in naturally (no stuffing).",
  landing_page:
    "Write landing-page copy in Markdown: a benefit-led hero headline + subhead, 3-4 value-proposition blocks (subhead + 1-2 sentences each), a short social-proof/objection-handling section, and a single strong CTA block. Keep it scannable and conversion-focused.",
  linkedin_post:
    "Write a single LinkedIn post (150-300 words): a scroll-stopping first line, short punchy paragraphs with line breaks, one concrete insight, and a soft CTA. End with 3-5 relevant hashtags on their own line.",
  x_post:
    "Write a single post under 280 characters: one sharp idea, no fluff, at most 1-2 hashtags.",
  newsletter:
    "Write an email newsletter in Markdown: a subject line as the title, a personal-feeling intro, 1-3 short value sections, and a clear CTA. Conversational but on-brand.",
  video_script:
    "Write a short-form video script: a 0-3s hook, then beat-by-beat spoken lines with brief [VISUAL] cues in brackets, ending on the CTA. Aim for 45-90 seconds of spoken content.",
  case_study:
    "Write a case study in Markdown: Challenge, Approach, Results (with concrete-but-not-fabricated outcomes framed qualitatively if numbers are unknown), and a closing CTA.",
  whitepaper:
    "Write a whitepaper outline-to-draft in Markdown: executive summary, problem framing, our point of view, a framework or approach, and a conclusion + CTA. Authoritative and well-structured.",
  other:
    "Write well-structured Markdown copy appropriate to the topic, with a clear headline, body, and a CTA.",
};

/** Map a content-brief format onto the contentAssets.assetType enum. */
export function briefFormatToAssetType(format: ContentBriefFormat): string {
  switch (format) {
    case "blog_post":
      return "blog_post";
    case "whitepaper":
      return "whitepaper";
    case "case_study":
      return "case_study";
    case "video_script":
      return "video";
    default:
      // landing_page, linkedin_post, x_post, newsletter, other
      return "other";
  }
}

export interface ParsedDraft {
  title: string | null;
  body: string;
  meta: string | null;
}

const DRAFT_SECTION = /===\s*(TITLE|BODY|META)\s*===/gi;

/**
 * Parse a delimiter-formatted copywriter response into title/body/meta.
 * Delimiters (more robust than JSON for long Markdown bodies):
 *   ===TITLE=== ... ===BODY=== ... ===META=== ...
 * Falls back to treating the whole (fence-stripped) text as the body.
 */
export function parseDraftResponse(text: string): ParsedDraft {
  const cleaned = text.replace(/```(?:markdown|md)?\s*/gi, "").replace(/```/g, "").trim();

  const sections: Record<string, string> = {};
  const matches: Array<{ key: string; start: number; markerStart: number }> = [];
  DRAFT_SECTION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DRAFT_SECTION.exec(cleaned)) !== null) {
    matches.push({ key: m[1].toUpperCase(), start: m.index + m[0].length, markerStart: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].markerStart : cleaned.length;
    sections[matches[i].key] = cleaned.slice(matches[i].start, end).trim();
  }

  const body = sections.BODY || cleaned;
  const norm = (v: string | undefined): string | null => {
    const s = (v ?? "").trim();
    return s.length > 0 ? s : null;
  };

  return {
    title: norm(sections.TITLE),
    body: body.trim(),
    meta: norm(sections.META),
  };
}
