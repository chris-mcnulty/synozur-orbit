/**
 * Prospect discovery — pure core.
 *
 * The Cowork sales harness found net-new prospects via "HubSpot query +
 * LinkedIn MCP research"; the free half of that was web/LinkedIn research
 * grounding (not a paid contact database). This module holds the deterministic,
 * I/O-free part of outbound discovery: turning the campaign's ICP criteria into
 * a search instruction, parsing the model's grounded results into candidates,
 * and deduping them against prospects already on the campaign.
 *
 * The web-search call + DB writes live in `web-discovery-provider.ts` and
 * `discovery-service.ts`; the Sales Navigator backend lives in
 * `salesnav-discovery-provider.ts`. All are pure here so they unit-test.
 */

import type { IcpCriteria, ProspectAttributes } from "./prospector-core";

/** Which discovery backend produced (or should produce) candidates. */
export type DiscoveryBackendId = "web" | "salesnav" | "apollo";

/** A net-new candidate found by a discovery backend (never persisted as-is). */
export interface DiscoveryCandidate {
  name: string;
  title?: string | null;
  companyName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  geography?: string | null;
  industry?: string | null;
  segment?: string | null;
  /** Public page the candidate was inferred from — kept for transparency. */
  sourceUrl?: string | null;
  /** Which backend surfaced this candidate. */
  source: DiscoveryBackendId;
}

/** The inputs a discovery search needs, flattened from a campaign. */
export interface DiscoverySearchInput {
  criteria: IcpCriteria;
  /** Named-account allow-list (company names or domains) to bias toward. */
  namedAccounts?: string[];
  /** The campaign goal, in the seller's words (context for relevance). */
  goal?: string | null;
  /** Max candidates to return (the model is told to stop here). */
  limit: number;
}

const MAX_LIMIT = 50;

/** Clamp a requested limit into a sane range (1..50, default 25). */
export function normalizeLimit(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(n, MAX_LIMIT);
}

function bulletList(label: string, items?: string[]): string | null {
  const cleaned = (items ?? []).map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return `${label}: ${cleaned.join("; ")}`;
}

/**
 * Build the user prompt that drives a web-grounded discovery search. The model
 * is expected to run web searches and return a strict JSON array of candidates.
 * Pure string assembly so it is unit-testable.
 */
export function buildDiscoveryPrompt(input: DiscoverySearchInput): string {
  const { criteria, namedAccounts, goal, limit } = input;

  const targeting = [
    bulletList("Target roles / titles", criteria.roles),
    bulletList("Industries", criteria.industries),
    bulletList("Geographies", criteria.geographies),
    bulletList("Company size / segment", criteria.segments),
    bulletList("Prioritize these named accounts", namedAccounts),
    bulletList("Hard exclusions (never include)", criteria.disqualifiers),
  ]
    .filter(Boolean)
    .join("\n");

  return [
    goal ? `Campaign goal: ${goal}` : "",
    "Find real, currently-employed people who match this Ideal Customer Profile.",
    "",
    targeting || "(No specific targeting filters — use the campaign goal.)",
    "",
    `Return at most ${limit} candidates. Use web search to ground every candidate in a real, current public source (company team/leadership page, a press release, a conference speaker list, or a public professional profile). Do not invent people, titles, companies, or emails. Only include an email or LinkedIn URL if you actually found it on a source — otherwise leave it null. Prefer decision-makers who fit the role and seniority over volume.`,
    "",
    "Every candidate MUST have a full name (first name AND last name). If you can only find a first name for someone — for example because a source only lists a first name — skip that person entirely and do not include them in the results.",
    "",
    'Respond with ONLY a JSON array (no prose, no markdown fences). Each element: {"name": string, "title": string|null, "companyName": string|null, "email": string|null, "linkedinUrl": string|null, "geography": string|null, "industry": string|null, "segment": string|null, "sourceUrl": string|null}. If you find no one, return [].',
  ]
    .filter(Boolean)
    .join("\n");
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Accept only http/https URLs; return null for anything else (data:, javascript:, etc.). */
function safeHttpUrl(v: unknown): string | null {
  const s = asStringOrNull(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

/** Extract the first top-level JSON array from a model response (tolerant). */
function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** Corporate-entity suffixes that indicate a company name, not a person. */
const COMPANY_SUFFIXES = /\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|gmbh|plc|llp|l\.p\.|s\.a\.?|b\.v\.?|pty\.?|ag)\b/i;

/**
 * Common job-title tokens. A name consisting entirely of these words is a role
 * label (e.g. "VP Sales", "Director Marketing"), not a person.
 */
const JOB_TITLE_TOKENS = new Set([
  "vp", "svp", "evp", "avp",
  "ceo", "coo", "cfo", "cto", "cmo", "cpo", "ciso", "chro",
  "president", "chairman", "chairwoman", "chairperson",
  "director", "managing", "general", "regional", "global",
  "head", "chief", "officer", "partner", "principal",
  "manager", "lead", "senior", "junior", "associate", "staff",
  "executive", "founder", "co-founder", "cofounder",
  "sales", "marketing", "operations", "engineering", "product",
  "finance", "legal", "hr", "it", "tech", "growth",
  "business", "development", "strategy", "account",
  "solutions", "enterprise", "commercial", "revenue",
  "success", "enablement", "partnerships", "alliances",
]);

/**
 * Return true if `name` looks like a company name, role label, all-caps
 * placeholder, or other non-person string. Real full names are unaffected.
 */
function isBadName(name: string): boolean {
  // All-caps (2+ words, e.g. "ACME CORP", "VP SALES") — real names use title case
  if (name === name.toUpperCase() && /[A-Z]{2}/.test(name)) return true;

  // Contains a corporate-entity suffix
  if (COMPANY_SUFFIXES.test(name)) return true;

  const words = name.toLowerCase().split(/[\s\-\/]+/).filter(Boolean);

  // Every word is a known job-title token → role label, not a person
  if (words.length > 0 && words.every((w) => JOB_TITLE_TOKENS.has(w))) return true;

  // Any token is purely numeric (e.g. "123 Test", "John 4") → placeholder
  if (words.some((w) => /^\d+$/.test(w))) {
    console.debug(`[discovery] dropped numeric-token name: "${name}"`);
    return true;
  }

  // Every token is a single character (initials-only, e.g. "J K") → not a full name
  if (words.length > 0 && words.every((w) => w.length === 1)) {
    console.debug(`[discovery] dropped initials-only name: "${name}"`);
    return true;
  }

  // All tokens are identical (e.g. "Test Test") → obvious placeholder
  if (words.length > 1 && words.every((w) => w === words[0])) {
    console.debug(`[discovery] dropped repeated-word name: "${name}"`);
    return true;
  }

  return false;
}

/**
 * Parse a model response into discovery candidates. Tolerant of code fences and
 * surrounding prose; drops malformed rows and any without a usable name.
 */
export function parseDiscoveryCandidates(
  text: string,
  source: DiscoveryBackendId,
  limit: number,
): DiscoveryCandidate[] {
  const json = extractJsonArray(text ?? "");
  if (!json) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: DiscoveryCandidate[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = asStringOrNull(r.name);
    if (!name) continue;
    if (!name.includes(" ")) {
      console.debug(`[discovery] dropped single-token name: "${name}"`);
      continue;
    }
    if (isBadName(name)) {
      console.debug(`[discovery] dropped non-person name: "${name}"`);
      continue;
    }
    out.push({
      name,
      title: asStringOrNull(r.title),
      companyName: asStringOrNull(r.companyName),
      email: asStringOrNull(r.email),
      linkedinUrl: safeHttpUrl(r.linkedinUrl),
      geography: asStringOrNull(r.geography),
      industry: asStringOrNull(r.industry),
      segment: asStringOrNull(r.segment),
      sourceUrl: safeHttpUrl(r.sourceUrl),
      source,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Normalize a candidate into the attributes the ICP scorer expects. */
export function candidateToAttributes(c: DiscoveryCandidate): ProspectAttributes {
  return {
    title: c.title ?? null,
    companyName: c.companyName ?? null,
    industry: c.industry ?? null,
    geography: c.geography ?? null,
    segment: c.segment ?? null,
    email: c.email ?? null,
    linkedinUrl: c.linkedinUrl ?? null,
  };
}

/** Identity key for a known prospect or a candidate (email > linkedin > name+company). */
export function dedupeKeys(p: {
  email?: string | null;
  linkedinUrl?: string | null;
  name?: string | null;
  companyName?: string | null;
}): string[] {
  const keys: string[] = [];
  const email = (p.email ?? "").trim().toLowerCase();
  if (email) keys.push(`email:${email}`);
  const li = (p.linkedinUrl ?? "").trim().toLowerCase().replace(/\/+$/, "");
  if (li) keys.push(`li:${li}`);
  const name = (p.name ?? "").trim().toLowerCase();
  const company = (p.companyName ?? "").trim().toLowerCase();
  if (name && company) keys.push(`nc:${name}|${company}`);
  return keys;
}

/**
 * Drop candidates that match an already-known prospect (by email, LinkedIn, or
 * name+company) and de-duplicate within the candidate list itself.
 */
export function dedupeCandidates(
  candidates: DiscoveryCandidate[],
  existing: { email?: string | null; linkedinUrl?: string | null; name?: string | null; companyName?: string | null }[],
): DiscoveryCandidate[] {
  const seen = new Set<string>();
  for (const e of existing) for (const k of dedupeKeys(e)) seen.add(k);

  const out: DiscoveryCandidate[] = [];
  for (const c of candidates) {
    const keys = dedupeKeys(c);
    if (keys.some((k) => seen.has(k))) continue;
    out.push(c);
    for (const k of keys) seen.add(k);
  }
  return out;
}
