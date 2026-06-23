/**
 * Content Interview — pure core.
 *
 * The interview flow is the streamlined path from "answer a few questions" to
 * 5-10 format-agnostic concept briefs on a campaign, then from curated briefs
 * to dated, per-format deliverables on the calendar. This module holds the
 * window math (ramp-up / amplification), tempo suggestions, prompt assembly,
 * and AI-response normalization. No I/O, so it is unit-testable.
 */

import {
  CONTENT_FORM_CATEGORIES,
  FORM_CATEGORY_FORMATS,
  formCategoryForFormat,
  type BriefFitAssessment,
  type CampaignType,
  type ContentBriefFormat,
  type ContentFormCategory,
} from "@shared/schema";
import { normalizeBrief, type DraftBrief } from "./editorial-calendar-core";

// ── Release windows + tempo ────────────────────────────────────────────────

/** Amplification must run at least this long after the release date. */
export const MIN_AMPLIFICATION_DAYS = 30;
/** Suggested ramp-up lead time before a release (6 weeks). */
export const DEFAULT_RAMP_UP_DAYS = 42;
/** Suggested amplification length after a release. */
export const DEFAULT_AMPLIFICATION_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface ReleaseWindows {
  rampUpStart: Date;
  releaseDate: Date;
  amplificationEnd: Date;
}

export function suggestReleaseWindows(releaseDate: Date): ReleaseWindows {
  return {
    rampUpStart: addDays(releaseDate, -DEFAULT_RAMP_UP_DAYS),
    releaseDate,
    amplificationEnd: addDays(releaseDate, DEFAULT_AMPLIFICATION_DAYS),
  };
}

/** Enforce the ≥30-day amplification floor on a user-supplied end date. */
export function clampAmplificationEnd(releaseDate: Date, requested?: Date | null): Date {
  const floor = addDays(releaseDate, MIN_AMPLIFICATION_DAYS);
  if (!requested || requested.getTime() < floor.getTime()) return floor;
  return requested;
}

export interface TempoPhase {
  phase: "ramp_up" | "launch_week" | "amplification";
  label: string;
  cadence: string;
}

/**
 * The suggested tempo of material around a product release. Shown in the
 * interview (editable as accepted text) and injected into the brief prompt.
 */
export function suggestReleaseTempo(): TempoPhase[] {
  return [
    {
      phase: "ramp_up",
      label: "Ramp-up (before release)",
      cadence:
        "2 social posts per week building anticipation, 1 blog post every 2 weeks, 1 teaser email mid-window",
    },
    {
      phase: "launch_week",
      label: "Launch week",
      cadence:
        "press release on release day, launch blog post, announcement email, daily social for the first 3 days, webinar scheduled within 2 weeks of release",
    },
    {
      phase: "amplification",
      label: "Amplification (≥30 days after release)",
      cadence:
        "2-3 social posts per week, 1 mid-form piece per week (blog, customer angle), the webinar plus a recap post, long-form (whitepaper/ebook) landing mid-window, tapering after week 3",
    },
  ];
}

export function formatTempoForDisplay(phases: TempoPhase[]): string {
  return phases.map((p) => `${p.label}: ${p.cadence}`).join("\n");
}

// ── Interview input ────────────────────────────────────────────────────────

export interface InterviewProductInput {
  productId?: string | null;
  productName?: string | null;
  /** Feature names confirmed against Orbit (when the product matched). */
  features?: string[];
}

export interface BriefInterviewInput {
  campaignType: CampaignType;
  name?: string | null;
  /** General themes the campaign should push. */
  themes: string[];
  /** Overall campaign window (theme/offering), ISO dates. */
  timeframeStart?: string | null;
  timeframeEnd?: string | null;
  /** Event campaigns: the hard date. */
  eventDate?: string | null;
  /** Product-release campaigns. */
  releaseDate?: string | null;
  rampUpStart?: string | null;
  amplificationEnd?: string | null;
  tempo?: string | null;
  newsItems?: string[];
  product?: InterviewProductInput | null;
  notes?: string | null;
  /** Requested concept-brief count; clamped to 5-10. */
  briefCount?: number;
  /** IDs of personas explicitly selected by the user for this campaign. */
  personaIds?: string[];
}

export const MIN_INTERVIEW_BRIEFS = 5;
export const MAX_INTERVIEW_BRIEFS = 10;

export function clampBriefCount(count: unknown): number {
  const n = typeof count === "number" && Number.isFinite(count) ? Math.round(count) : 8;
  return Math.min(Math.max(n, MIN_INTERVIEW_BRIEFS), MAX_INTERVIEW_BRIEFS);
}

const fmtDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Build the interview block injected into the brief-generation prompt. Pure
 * string assembly so it stays testable.
 */
export function formatInterviewForPrompt(input: BriefInterviewInput): string {
  const lines: string[] = ["## Campaign interview answers", `- Campaign type: ${input.campaignType}`];
  if (input.name?.trim()) lines.push(`- Campaign name: ${input.name.trim()}`);
  if (input.themes.length) {
    lines.push("- General themes to push:");
    for (const t of input.themes) lines.push(`  - ${t}`);
  }

  const start = fmtDate(input.timeframeStart);
  const end = fmtDate(input.timeframeEnd);
  if (start || end) lines.push(`- Campaign timeframe: ${start ?? "?"} to ${end ?? "?"}`);
  const eventDate = fmtDate(input.eventDate);
  if (eventDate) lines.push(`- Event date (hard date): ${eventDate}`);

  const releaseDate = fmtDate(input.releaseDate);
  if (releaseDate) {
    lines.push(`- Release date (hard date): ${releaseDate}`);
    const ramp = fmtDate(input.rampUpStart);
    if (ramp) lines.push(`- Ramp-up window: ${ramp} until release (build anticipation, tease, educate)`);
    const amp = fmtDate(input.amplificationEnd);
    if (amp) lines.push(`- Amplification window: release until ${amp} (sustain momentum, proof, depth)`);
    if (input.tempo?.trim()) lines.push(`- Agreed tempo of material:\n${input.tempo.trim().split("\n").map((l) => `    ${l}`).join("\n")}`);
  }

  if (input.product?.productName?.trim()) {
    lines.push(`- Product: ${input.product.productName.trim()}${input.product.productId ? " (tracked in Orbit)" : " (not yet tracked in Orbit)"}`);
    if (input.product.features?.length) {
      lines.push("- Known product features to draw on:");
      for (const f of input.product.features.slice(0, 12)) lines.push(`  - ${f}`);
    }
  }

  if (input.newsItems?.length) {
    lines.push("- Top news items for this push (the 3-6 things worth announcing):");
    for (const n of input.newsItems) lines.push(`  - ${n}`);
  }

  if (input.notes?.trim()) lines.push(`- Additional notes: ${input.notes.trim()}`);

  return lines.join("\n");
}

// ── AI response normalization ──────────────────────────────────────────────

export interface InterviewDraftBrief extends DraftBrief {
  summary: string | null;
  formCategories: ContentFormCategory[];
  fitAssessment: BriefFitAssessment;
}

const FIT_LEVELS = ["strong", "moderate", "weak"] as const;

function coerceFitLevel(value: unknown): "strong" | "moderate" | "weak" {
  const v = String(value ?? "").trim().toLowerCase();
  return (FIT_LEVELS as readonly string[]).includes(v) ? (v as any) : "moderate";
}

export function coerceFitAssessment(raw: any): BriefFitAssessment {
  const voiceFit = coerceFitLevel(raw?.voiceFit ?? raw?.voice_fit);
  const topicFit = coerceFitLevel(raw?.topicFit ?? raw?.topic_fit);
  const recRaw = String(raw?.recommendation ?? "").trim().toLowerCase();
  // Default the recommendation from the fits when the model omits it: any
  // weak dimension means we suggest rejecting.
  const recommendation: "keep" | "reject" =
    recRaw === "keep" || recRaw === "reject"
      ? recRaw
      : voiceFit === "weak" || topicFit === "weak"
        ? "reject"
        : "keep";
  const rationale = typeof raw?.rationale === "string" ? raw.rationale.trim() : "";
  return { voiceFit, topicFit, recommendation, rationale };
}

export function coerceFormCategories(raw: any): ContentFormCategory[] {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: ContentFormCategory[] = [];
  for (const v of values) {
    const norm = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if ((CONTENT_FORM_CATEGORIES as readonly string[]).includes(norm) && !out.includes(norm as ContentFormCategory)) {
      out.push(norm as ContentFormCategory);
    }
  }
  return out;
}

/**
 * Normalize a raw AI-produced interview brief. Reuses the base brief
 * normalization, then layers on summary, form categories (falling back to the
 * anchor format's category), and the fit assessment.
 */
export function normalizeInterviewBrief(raw: any): InterviewDraftBrief | null {
  const base = normalizeBrief(raw);
  if (!base) return null;

  let formCategories = coerceFormCategories(raw?.formCategories ?? raw?.form_categories);
  if (formCategories.length === 0) {
    // Fall back to the anchor format's category; an unmapped anchor (e.g.
    // "other") yields no categories rather than an arbitrary guess — the user
    // picks forms manually during planning.
    const fallback = formCategoryForFormat(base.format);
    formCategories = fallback ? [fallback] : [];
  }

  const summary = typeof raw?.summary === "string" && raw.summary.trim() ? raw.summary.trim() : null;

  return {
    ...base,
    summary,
    formCategories,
    fitAssessment: coerceFitAssessment(raw?.fitAssessment ?? raw?.fit_assessment),
  };
}

// ── Output-plan expansion ──────────────────────────────────────────────────

export const MAX_OUTPUTS_PER_ITEM = 10;

export interface OutputPlanItem {
  briefId: string;
  format: ContentBriefFormat;
  count: number;
  /** ISO dates bounding when these pieces should land. */
  windowStart: string;
  windowEnd: string;
}

/**
 * Evenly distribute `count` dates across [start, end] inclusive. A single
 * date lands on the window start (e.g. the press release on release day).
 */
export function distributeDates(start: Date, end: Date, count: number): Date[] {
  const n = Math.min(Math.max(Math.round(count) || 1, 1), MAX_OUTPUTS_PER_ITEM);
  const s = start.getTime();
  const e = Math.max(end.getTime(), s);
  if (n === 1) return [new Date(s)];
  const step = (e - s) / (n - 1);
  return Array.from({ length: n }, (_, i) => new Date(Math.round(s + step * i)));
}

/**
 * Pin a distributed date to a local wall-clock hour on its UTC calendar day.
 * Mirrors the distribution planner's timezone convention: callers pass the
 * client's `Date.getTimezoneOffset()` and the stored UTC instant is
 * `localWallClock + offset`, so the piece lands on the intended local day.
 */
export function scheduleAtLocalHour(date: Date, localHour: number, tzOffsetMinutes: number): Date {
  const localWallClock = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    localHour,
    0,
    0,
  );
  return new Date(localWallClock + tzOffsetMinutes * 60_000);
}

/** Human label for a deliverable expanded from a concept brief. */
export const FORMAT_LABELS: Record<ContentBriefFormat, string> = {
  blog_post: "Blog post",
  linkedin_post: "LinkedIn post",
  x_post: "X post",
  newsletter: "Email",
  landing_page: "Landing page",
  video_script: "Video script",
  case_study: "Case study",
  whitepaper: "Whitepaper",
  ebook: "Ebook",
  podcast_outline: "Podcast outline",
  webinar: "Webinar",
  press_release: "Press release",
  linkedin_digest: "LinkedIn Digest",
  other: "Content",
};

export function deliverableTitle(conceptTitle: string, format: ContentBriefFormat, index: number, count: number): string {
  const label = FORMAT_LABELS[format] ?? format;
  return count > 1 ? `${conceptTitle} — ${label} ${index + 1} of ${count}` : `${conceptTitle} — ${label}`;
}

/** The form categories valid for a plan item's format, for stamping deliverables. */
export function categoriesForFormat(format: ContentBriefFormat): ContentFormCategory[] {
  const cat = formCategoryForFormat(format);
  return cat ? [cat] : [];
}

export { FORM_CATEGORY_FORMATS };
