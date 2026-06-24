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

/**
 * Score a prospect against the ICP criteria. Disqualifiers are hard: a match
 * forces score 0 and `disqualified=true` regardless of other signals.
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

  // When named accounts are configured, use company-name matching for the
  // "industry" slot — it's a stronger and immediately available signal vs.
  // industry which only populates after AI research runs on a new prospect.
  const hasNamedAccounts = (criteria.namedAccounts?.length ?? 0) > 0;
  const industrySignal = hasNamedAccounts
    ? {
        key: "industry" as keyof typeof SIGNAL_WEIGHTS,
        label: "Named account match",
        matched: matchesAny(attrs.companyName, criteria.namedAccounts),
      }
    : {
        key: "industry" as keyof typeof SIGNAL_WEIGHTS,
        label: "Industry fit",
        matched: matchesAny(attrs.industry, criteria.industries),
      };

  const checks: { key: keyof typeof SIGNAL_WEIGHTS; label: string; matched: boolean; note?: string }[] = [
    { key: "role", label: "Role / title fit", matched: matchesAny(attrs.title, criteria.roles) },
    industrySignal,
    { key: "geography", label: "Geography fit", matched: matchesAny(attrs.geography, criteria.geographies) },
    { key: "segment", label: "Segment / size fit", matched: matchesAny(attrs.segment, criteria.segments) },
    { key: "email", label: "Has email", matched: Boolean(norm(attrs.email)) },
    { key: "linkedin", label: "Has LinkedIn", matched: Boolean(norm(attrs.linkedinUrl)) },
  ];

  const signals = checks.map((c) => ({
    key: c.key,
    label: c.label,
    weight: SIGNAL_WEIGHTS[c.key],
    matched: c.matched,
    note: c.note,
  }));

  const total = signals.reduce((sum, s) => sum + (s.matched ? s.weight : 0), 0);

  return {
    score: total,
    qualified: total >= threshold,
    disqualified: false,
    breakdown: { signals, total, threshold },
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
