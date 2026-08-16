/**
 * Market Study Wizard — PURE core (Task #547)
 *
 * Deterministic pieces of the pipeline: depth → breadth config, the stage plan,
 * and the prompt builders / parsers for the two study-only AI steps (propose
 * segments from a brief, write the executive summary). No db/AI/network imports.
 */

import { type StudyDepth, type StudyStage, type Firmographics } from "@shared/market-intelligence";

// ─── Depth → breadth ─────────────────────────────────────────────────────────

export interface DepthConfig {
  maxSegments: number;
  maxNeeds: number;
  /** How many segments to propose when the market has none yet. */
  proposeCount: number;
}

export function depthConfig(depth: StudyDepth): DepthConfig {
  switch (depth) {
    case "explore":
      return { maxSegments: 3, maxNeeds: 2, proposeCount: 3 };
    case "dominate":
      return { maxSegments: 10, maxNeeds: 4, proposeCount: 8 };
    case "focus":
    default:
      return { maxSegments: 6, maxNeeds: 3, proposeCount: 5 };
  }
}

// ─── Stage plan ──────────────────────────────────────────────────────────────

export const STUDY_STAGE_PLAN: ReadonlyArray<{ key: string; label: string }> = [
  { key: "input", label: "Reviewing input & existing data" },
  { key: "discovery", label: "Discovering competitors" },
  { key: "segments", label: "Modeling segments" },
  { key: "sizing", label: "Sizing TAM/SAM & needs" },
  { key: "matrix", label: "Scoring GTM opportunity matrix" },
  { key: "summary", label: "Writing executive summary" },
];

export function initialStages(): StudyStage[] {
  return STUDY_STAGE_PLAN.map((s) => ({ key: s.key, label: s.label, status: "pending" }));
}

// ─── Propose segments (brief → candidate segments) ────────────────────────────

export const PROPOSE_SEGMENTS_SYSTEM_PROMPT =
  "You are a market strategist. From a short brief or company description, propose " +
  "distinct, non-overlapping buyer segments worth pursuing. Be concrete and " +
  "realistic. Return only the requested JSON.";

export interface ProposedSegmentParsed {
  name: string;
  description?: string;
  firmographics: Firmographics;
  pains: string[];
}

export function buildProposeSegmentsPrompt(input: {
  brief: string;
  count: number;
  businessType?: "b2b" | "b2c";
}): string {
  const bt = input.businessType ?? "b2b";
  return [
    `Business brief / description:\n"""${input.brief}"""`,
    "",
    `Propose up to ${input.count} distinct ${bt.toUpperCase()} buyer segments to pursue.`,
    "Return ONLY a JSON array:",
    '[{ "name": "", "description": "", "industry": "", "companySize": "", "geography": "", "pains": ["", ""] }]',
    "- name: short, specific segment name",
    "- pains: 2–4 concrete problems this segment feels",
    "- companySize: a band like \"50-500\" (or \"\" if consumer)",
  ].join("\n");
}

export function parseProposedSegments(text: string): ProposedSegmentParsed[] {
  const arr = extractJsonArray(text);
  const out: ProposedSegmentParsed[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    out.push({
      name: raw.name.trim().slice(0, 120),
      description: str(raw.description),
      firmographics: {
        industry: str(raw.industry),
        companySize: str(raw.companySize),
        geography: str(raw.geography),
        businessType: raw.businessType === "b2c" ? "b2c" : undefined,
      },
      pains: strArray(raw.pains),
    });
  }
  return out;
}

// ─── Executive summary ─────────────────────────────────────────────────────────

export const EXEC_SUMMARY_SYSTEM_PROMPT =
  "You are a strategy consultant writing a crisp executive summary of a market " +
  "study. Be specific and decisive. Use short markdown sections. No preamble.";

export interface ExecSummarySegment {
  name: string;
  tamMid?: number | null;
  samMid?: number | null;
  priorityScore?: number | null;
}
export interface ExecSummaryOpportunity {
  segmentName: string;
  need: string;
  channel: string;
  roiScore: number;
  isWhitespace: boolean;
}

export function buildExecSummaryPrompt(input: {
  brief?: string;
  segments: ExecSummarySegment[];
  opportunities: ExecSummaryOpportunity[];
}): string {
  const segLines = input.segments
    .map(
      (s) =>
        `- ${s.name}: TAM ~${money(s.tamMid)}, SAM ~${money(s.samMid)}, priority ${s.priorityScore ?? "—"}/10`,
    )
    .join("\n");
  const oppLines = input.opportunities
    .map((o) => `- ${o.segmentName} · ${o.need} · ${o.channel} — ROI ${Math.round(o.roiScore)}${o.isWhitespace ? " (whitespace)" : ""}`)
    .join("\n");
  return [
    input.brief ? `Study brief: ${input.brief}` : "",
    "",
    "Ranked segments:",
    segLines || "- (none)",
    "",
    "Top GTM opportunities:",
    oppLines || "- (none)",
    "",
    "Write an executive summary with these markdown sections:",
    "## Where the opportunity is  (2–3 sentences)",
    "## Priority segments  (bullets: which and why)",
    "## Where to focus GTM first  (bullets tied to the top opportunities/whitespace)",
    "## Risks & unknowns  (2–3 bullets)",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Competitor discovery ─────────────────────────────────────────────────────

export const COMPETITOR_DISCOVERY_SYSTEM_PROMPT =
  "You are a market researcher. Given a company description or URL, identify the most " +
  "important direct competitors. Be specific and realistic. Return only valid JSON.";

export interface CompetitorSuggestion {
  name: string;
  url: string;
}

export function buildCompetitorDiscoveryPrompt(input: {
  inputType: "url" | "brief";
  inputValue: string;
  count: number;
}): string {
  const label =
    input.inputType === "url"
      ? `Company URL: ${input.inputValue}`
      : `Company / market description:\n"""${input.inputValue}"""`;
  return [
    label,
    "",
    `Identify up to ${input.count} direct competitors for this company or market.`,
    "Return ONLY a JSON array (no other text):",
    '[{ "name": "Competitor Name", "url": "https://competitor.com" }]',
    "- url must be a valid https:// URL pointing to the competitor's main website",
    "- name: official company name",
  ].join("\n");
}

export function parseCompetitorSuggestions(text: string): CompetitorSuggestion[] {
  const arr = extractJsonArray(text);
  const out: CompetitorSuggestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    if (typeof raw.url !== "string" || !/^https?:\/\//i.test(raw.url.trim())) continue;
    out.push({ name: raw.name.trim().slice(0, 120), url: raw.url.trim() });
  }
  return out;
}

// ─── local helpers (no deps) ─────────────────────────────────────────────────

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "n/a";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, 6);
}

function extractJsonArray(text: string): any[] {
  const cleaned = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.segments)) return parsed.segments;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const a = JSON.parse(match[0]);
        if (Array.isArray(a)) return a;
      } catch {
        /* fall through */
      }
    }
  }
  return [];
}
