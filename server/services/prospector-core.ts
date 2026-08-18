/**
 * Prospector — pure scoring core.
 *
 * The Cowork prospector scores a lead against the ICP using weighted signals,
 * applies hard disqualifiers, and writes a research summary. This module holds
 * the deterministic part: signal matching, weighted scoring, the qualify /
 * disqualify decision, and geo/industry refinement filtering. No I/O, so it is
 * unit-testable. The AI dossier + DB writes live in `prospector-service.ts`.
 */

import type { ProspectScoreBreakdown } from "@shared/schema";

/** The ICP + campaign targeting, flattened into match criteria. */
export interface IcpCriteria {
  /** Persona role(s) + the campaign's target roles ("PE CIO", "IT director"). */
  roles?: string[];
  industries?: string[];
  /** City / region labels (also used for event-proximity targeting). */
  geographies?: string[];
  /** Company-size bands / segment labels ("mid-market", "enterprise"). */
  segments?: string[];
  /**
   * Named target accounts (company names or domains). When populated, the
   * company-fit signal checks companyName against these instead of using the
   * industry signal (which requires prior AI research to populate).
   */
  namedAccounts?: string[];
  /** Substrings in title/company that auto-disqualify (e.g. "intern", "student"). */
  disqualifiers?: string[];
  /** Score at/above which a prospect is qualified (default 50). */
  threshold?: number;
}

/** What we know about a candidate prospect. */
export interface ProspectAttributes {
  title?: string | null;
  companyName?: string | null;
  industry?: string | null;
  geography?: string | null;
  segment?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
}

export interface ScoredProspect {
  score: number;
  qualified: boolean;
  disqualified: boolean;
  disqualifiedReason?: string;
  breakdown: ProspectScoreBreakdown;
}

export const DEFAULT_THRESHOLD = 50;

// Signal weights sum to 100. Role fit dominates; contactability matters because
// an unreachable prospect can't be worked.
const SIGNAL_WEIGHTS = {
  role: 35,
  industry: 20,
  geography: 15,
  segment: 10,
  email: 12,
  linkedin: 8,
} as const;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Case-insensitive substring match of `value` against any criteria entry. */
export function matchesAny(value: string | null | undefined, criteria?: string[]): boolean {
  const v = norm(value);
  if (!v || !criteria || criteria.length === 0) return false;
  return criteria.some((c) => {
    const cn = norm(c);
    return cn.length > 0 && (v.includes(cn) || cn.includes(v));
  });
}

/** Find the first disqualifier that the title or company triggers, if any. */
export function findDisqualifier(
  attrs: ProspectAttributes,
  disqualifiers?: string[],
): string | undefined {
  if (!disqualifiers || disqualifiers.length === 0) return undefined;
  const haystack = `${norm(attrs.title)} ${norm(attrs.companyName)}`;
  for (const d of disqualifiers) {
    const dn = norm(d);
    if (dn.length > 0 && haystack.includes(dn)) return d;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Partner / channel-fit detection
// ---------------------------------------------------------------------------

/** Company-name substrings that suggest a consulting / SI / agency firm. */
const PARTNER_COMPANY_KEYWORDS = [
  "consulting", "consultants", "consultant", "advisory", "advisors",
  "advisories", "solutions", "integrat", "partners", "partner llp",
  "accenture", "deloitte", "kpmg", "pwc", "ernst & young", " ey ",
  "capgemini", "infosys", "wipro", "cognizant", "tata consultancy",
  "ntt data", "unisys", "dxc technology", "hewitt", "bdo ",
  "rsm us", "grant thornton", "mckinsey", "bcg consulting", "bain &",
];

/** Industry signals that suggest a consulting / SI / agency firm. */
const PARTNER_INDUSTRY_KEYWORDS = [
  "consulting", "professional services", "system integrat",
  "managed service", "outsourc", "advisory services", "it services",
];

/** Title keywords that strongly suggest a partner/channel/practice role. */
const PARTNER_TITLE_KEYWORDS = [
  "practice lead", "practice director", "practice head", "practice manager",
  "alliance", "channel director", "channel manager", "channel lead",
  "partner director", "partner manager", "partner lead",
];

/**
 * Detect whether a prospect appears to be at a consulting / systems-integrator /
 * agency firm, making them a potential partner/channel opportunity rather than a
 * direct end-user buyer.
 */
export function detectPartnerFit(attrs: ProspectAttributes): { partnerFit: boolean; note?: string } {
  const cn = norm(attrs.companyName);
  const title = norm(attrs.title);
  const industry = norm(attrs.industry);

  // Company name heuristics (highest signal).
  for (const kw of PARTNER_COMPANY_KEYWORDS) {
    if (cn.includes(kw.trim())) {
      return {
        partnerFit: true,
        note: `Company name "${attrs.companyName}" suggests a consulting/SI firm — consider a partner/channel engagement approach.`,
      };
    }
  }

  // Industry signal (only meaningful after research has run).
  for (const kw of PARTNER_INDUSTRY_KEYWORDS) {
    if (industry.includes(kw)) {
      return {
        partnerFit: true,
        note: `Industry "${attrs.industry}" indicates a consulting/professional-services firm — possible channel partner.`,
      };
    }
  }

  // Title keywords (secondary signal — combines well with advisory company names).
  for (const kw of PARTNER_TITLE_KEYWORDS) {
    if (title.includes(kw)) {
      return {
        partnerFit: true,
        note: `Title "${attrs.title}" includes a partner/practice keyword — may be a channel/alliance contact.`,
      };
    }
  }

  return { partnerFit: false };
}

// ---------------------------------------------------------------------------
// Semantic / synonym-based role matching (synchronous, no I/O)
// ---------------------------------------------------------------------------

/** Common stop words to strip before concept extraction. */
const STOP_WORDS = new Set([
  "and", "or", "of", "for", "the", "a", "an", "in", "at", "to", "with",
  "by", "on", "as", "is", "are", "be", "was", "it", "its", "this",
  "that", "from", "into", "about", "between",
]);

/**
 * Generic seniority / level terms that are NOT discriminative for function.
 * "Engineering Manager" and "Sales Manager" share "manager", but that tells us
 * nothing about function. These tokens are intentionally excluded from the
 * semantic-match concept comparison so that only domain/function words count.
 */
const GENERIC_LEVEL_TERMS = new Set([
  "manager", "director", "lead", "head", "vp", "president", "officer",
  "executive", "senior", "junior", "associate", "principal", "chief",
  "global", "regional", "national", "corporate", "enterprise", "general",
  "specialist", "analyst", "consultant", "advisor", "coordinator",
  "representative", "professional", "expert", "fellow", "staff",
]);

/** Extract meaningful NON-generic concept tokens from a normalised string. */
function extractDiscriminativeConcepts(text: string): string[] {
  return text
    .split(/[\s\-\/,&+|]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !GENERIC_LEVEL_TERMS.has(w));
}

/**
 * Lightweight synonym/concept-overlap check. When literal substring matching
 * fails, this compares discriminative (non-seniority) concept tokens extracted
 * from the prospect's title against those in each ICP role. Returns an
 * explanatory note string plus the matched role on a confident match.
 *
 * Match heuristic: at least 1 shared DISCRIMINATIVE concept AND the shared
 * concepts cover ≥40 % of the role's discriminative concept list. This avoids
 * false positives on seniority words ("Engineering Manager" ≠ "Sales Manager").
 *
 * Returns `{ note, matchedRole }` on a match, or null when no confident match.
 */
export function semanticRoleMatch(
  title: string | null | undefined,
  roles?: string[],
): { note: string; matchedRole: string } | null {
  if (!title || !roles || roles.length === 0) return null;
  const titleConcepts = new Set(extractDiscriminativeConcepts(norm(title)));
  // If the title has NO discriminative tokens, never match — we can't tell the function.
  if (titleConcepts.size === 0) return null;

  for (const role of roles) {
    const roleConcepts = extractDiscriminativeConcepts(norm(role));
    // Skip roles with no discriminative tokens (e.g. "Manager") — too ambiguous.
    if (roleConcepts.length === 0) continue;
    const shared = roleConcepts.filter((c) => titleConcepts.has(c));
    if (shared.length > 0 && shared.length / roleConcepts.length >= 0.40) {
      return {
        note: `Concept match to ICP role "${role}" via shared domain terms: ${shared.join(", ")}`,
        matchedRole: role,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core scorer
// ---------------------------------------------------------------------------

/**
 * Score a prospect against the ICP criteria. Disqualifiers are hard: a match
 * forces score 0 and `disqualified=true` regardless of other signals.
 *
 * Enhancements vs. the original implementation:
 * - Signals carry `absent: true` when the prospect has no data for that signal
 *   and criteria exist — distinguishing "unknown" from "mismatch" in the UI.
 * - Role matching falls back to a lightweight semantic/concept-overlap check
 *   when literal substring matching fails.
 * - Partner/channel fit is detected from company name, industry, and title and
 *   recorded in the breakdown.
 */
export function scoreProspect(attrs: ProspectAttributes, criteria: IcpCriteria): ScoredProspect {
  const threshold = criteria.threshold ?? DEFAULT_THRESHOLD;

  const dq = findDisqualifier(attrs, criteria.disqualifiers);
  if (dq) {
    return {
      score: 0,
      qualified: false,
      disqualified: true,
      disqualifiedReason: `Matched disqualifier: "${dq}"`,
      breakdown: {
        signals: [{ key: "disqualifier", label: "Disqualifier", weight: 0, matched: true, note: dq }],
        total: 0,
        threshold,
      },
    };
  }

  // ── Role: literal first, then semantic fallback ──────────────────────────
  const hasRoleCriteria = (criteria.roles?.length ?? 0) > 0;
  let roleMatched = matchesAny(attrs.title, criteria.roles);
  let roleNote: string | undefined;
  let semanticRoleMatchUsed = false;
  const roleAbsent = !norm(attrs.title) && hasRoleCriteria;

  if (!roleMatched && !roleAbsent && hasRoleCriteria) {
    // Literal match failed — try concept-overlap semantic fallback.
    const semResult = semanticRoleMatch(attrs.title, criteria.roles);
    if (semResult) {
      roleMatched = true;
      roleNote = semResult.note;
      semanticRoleMatchUsed = true;
    }
  }

  // ── Industry / Named account ─────────────────────────────────────────────
  const hasNamedAccounts = (criteria.namedAccounts?.length ?? 0) > 0;
  let industryMatched: boolean;
  let industryLabel: string;
  let industryAbsent: boolean;
  if (hasNamedAccounts) {
    industryLabel = "Named account match";
    industryMatched = matchesAny(attrs.companyName, criteria.namedAccounts);
    industryAbsent = !norm(attrs.companyName) && hasNamedAccounts;
  } else {
    industryLabel = "Industry fit";
    const hasIndustryCriteria = (criteria.industries?.length ?? 0) > 0;
    industryMatched = matchesAny(attrs.industry, criteria.industries);
    industryAbsent = !norm(attrs.industry) && hasIndustryCriteria;
  }

  // ── Geography / Segment ───────────────────────────────────────────────────
  const hasGeoCriteria = (criteria.geographies?.length ?? 0) > 0;
  const geoMatched = matchesAny(attrs.geography, criteria.geographies);
  const geoAbsent = !norm(attrs.geography) && hasGeoCriteria;

  const hasSegmentCriteria = (criteria.segments?.length ?? 0) > 0;
  const segMatched = matchesAny(attrs.segment, criteria.segments);
  const segAbsent = !norm(attrs.segment) && hasSegmentCriteria;

  // ── Build signal list ──────────────────────────────────────────────────────
  const signals: ProspectScoreBreakdown["signals"] = [
    {
      key: "role",
      label: "Role / title fit",
      weight: SIGNAL_WEIGHTS.role,
      matched: roleMatched,
      absent: roleAbsent || undefined,
      note: roleNote,
    },
    {
      key: "industry",
      label: industryLabel,
      weight: SIGNAL_WEIGHTS.industry,
      matched: industryMatched,
      absent: industryAbsent || undefined,
    },
    {
      key: "geography",
      label: "Geography fit",
      weight: SIGNAL_WEIGHTS.geography,
      matched: geoMatched,
      absent: geoAbsent || undefined,
    },
    {
      key: "segment",
      label: "Segment / size fit",
      weight: SIGNAL_WEIGHTS.segment,
      matched: segMatched,
      absent: segAbsent || undefined,
    },
    {
      key: "email",
      label: "Has email",
      weight: SIGNAL_WEIGHTS.email,
      matched: Boolean(norm(attrs.email)),
    },
    {
      key: "linkedin",
      label: "Has LinkedIn",
      weight: SIGNAL_WEIGHTS.linkedin,
      matched: Boolean(norm(attrs.linkedinUrl)),
    },
  ];

  // Strip undefined absent fields to keep the persisted JSON clean.
  const cleanedSignals = signals.map((s) => {
    if (s.absent === undefined) {
      const { absent: _absent, ...rest } = s;
      return rest;
    }
    return s;
  });

  const total = cleanedSignals.reduce((sum, s) => sum + (s.matched ? s.weight : 0), 0);

  // ── Partner / channel detection ───────────────────────────────────────────
  const partnerResult = detectPartnerFit(attrs);

  const breakdown: ProspectScoreBreakdown = {
    signals: cleanedSignals,
    total,
    threshold,
    ...(partnerResult.partnerFit
      ? { partnerFit: true, partnerFitNote: partnerResult.note }
      : {}),
    ...(semanticRoleMatchUsed ? { semanticRoleMatch: true } : {}),
  };

  return {
    score: total,
    qualified: total >= threshold,
    disqualified: false,
    breakdown,
  };
}

/**
 * Build ICP criteria by flattening an ICP persona and the campaign targeting
 * filter into one match set. Either side may be partial.
 */
export function buildIcpCriteria(
  persona: { role?: string | null; industry?: string | null; companySize?: string | null } | undefined,
  filter:
    | {
        targetRoles?: string[] | null;
        industries?: string[] | null;
        geographies?: string[] | null;
        segments?: string[] | null;
        namedAccounts?: string[] | null;
      }
    | undefined,
  disqualifiers?: string[],
  threshold?: number,
): IcpCriteria {
  const roles = [persona?.role, ...(filter?.targetRoles ?? [])].filter((x): x is string => !!x);
  const industries = [persona?.industry, ...(filter?.industries ?? [])].filter((x): x is string => !!x);
  const segments = [persona?.companySize, ...(filter?.segments ?? [])].filter((x): x is string => !!x);
  const geographies = (filter?.geographies ?? []).filter((x): x is string => !!x);
  const namedAccounts = (filter?.namedAccounts ?? []).filter((x): x is string => !!x);
  return {
    roles: dedupe(roles),
    industries: dedupe(industries),
    geographies: dedupe(geographies),
    segments: dedupe(segments),
    namedAccounts: dedupe(namedAccounts),
    disqualifiers,
    threshold,
  };
}

/**
 * A persona reference used for multi-persona scoring. Carries just the fields
 * needed to build ICP criteria plus an id and display name.
 */
export interface PersonaRef {
  id: string;
  /** Human-readable display name (preferred for UI/dossier labelling). */
  name?: string | null;
  role?: string | null;
  industry?: string | null;
  companySize?: string | null;
}

/** A scored prospect annotated with which persona produced the best score. */
export interface ScoredProspectWithPersona extends ScoredProspect {
  /** id of the persona that produced the winning score (if personas were provided). */
  matchedPersonaId?: string;
  /** Display label of the winning persona (name ?? role). */
  matchedPersonaName?: string;
}

/**
 * Score a prospect against every persona in `personas` independently and
 * return the result with the highest `score`. When no persona matches
 * (all disqualified or all zero) the lowest-score result is returned so the
 * caller always receives a coherent breakdown.
 *
 * The `filter` (campaign-level targeting: roles, industries, geographies…) is
 * merged into each persona's criteria via `buildIcpCriteria`, mirroring the
 * single-persona path exactly.
 *
 * When `personas` is empty the function falls back to scoring against the
 * filter alone (no persona fields).
 */
export function scoreProspectAgainstAll(
  personas: PersonaRef[],
  filter:
    | {
        targetRoles?: string[] | null;
        industries?: string[] | null;
        geographies?: string[] | null;
        segments?: string[] | null;
        namedAccounts?: string[] | null;
      }
    | undefined,
  attrs: ProspectAttributes,
  disqualifiers?: string[],
  threshold?: number,
): ScoredProspectWithPersona {
  if (personas.length === 0) {
    const criteria = buildIcpCriteria(undefined, filter, disqualifiers, threshold);
    return scoreProspect(attrs, criteria);
  }

  let best: ScoredProspectWithPersona | null = null;
  for (const persona of personas) {
    const criteria = buildIcpCriteria(persona, filter, disqualifiers, threshold);
    const scored = scoreProspect(attrs, criteria);
    if (best === null || scored.score > best.score) {
      best = {
        ...scored,
        matchedPersonaId: persona.id,
        matchedPersonaName: persona.name ?? persona.role ?? undefined,
      };
    }
  }
  // best is non-null because personas.length > 0
  return best!;
}

/** Dedupe case-insensitively, keeping the first-seen casing. */
function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const x = raw.trim();
    if (!x) continue;
    const key = x.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}
