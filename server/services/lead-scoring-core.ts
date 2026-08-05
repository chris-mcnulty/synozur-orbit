/**
 * lead-scoring-core.ts — Pure, DB-free scoring logic
 *
 * Exported for unit tests. No database imports, no async I/O.
 */

// ---------------------------------------------------------------------------
// Stage ordering
// ---------------------------------------------------------------------------

export const SCORING_STAGE_ORDER = [
  "subscriber",
  "lead",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "evangelist",
] as const;

export type ScoringLifecycleStage = (typeof SCORING_STAGE_ORDER)[number];

export function stageIndex(stage: string): number {
  const idx = SCORING_STAGE_ORDER.indexOf(stage as ScoringLifecycleStage);
  return idx === -1 ? 0 : idx;
}

// ---------------------------------------------------------------------------
// Derive lifecycle stage from score + thresholds (pure)
// ---------------------------------------------------------------------------

export interface ScoringThreshold {
  stage: string;
  minScore: number;
}

/**
 * Return the lifecycle stage a contact should be at given `score` and the
 * configured thresholds.  Stages only advance — the result is never lower
 * than `currentStage`.
 */
export function deriveStageFromScore(
  score: number,
  thresholds: ScoringThreshold[],
  currentStage: string,
): string {
  // Sort thresholds descending so we pick the highest stage the score qualifies for
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  for (const t of sorted) {
    if (score >= t.minScore) {
      const candidate = t.stage;
      if (stageIndex(candidate) > stageIndex(currentStage)) {
        return candidate;
      }
      // score qualifies for this tier but we can't downgrade — keep searching
      // for a lower tier that might still be an upgrade… actually once we find
      // the first tier that qualifies, we stop: a lower-ranked threshold can
      // only produce a weaker (or same) stage.
      break;
    }
  }
  return currentStage;
}

// ---------------------------------------------------------------------------
// Evaluate a property-based rule condition (pure)
// ---------------------------------------------------------------------------

export interface PropertyCondition {
  field: string;
  operator: "contains" | "equals" | "not_empty";
  value?: string;
}

/**
 * Evaluate a property rule against a contact's flat string properties.
 * contactProps should be a map of field name → string value (or undefined).
 */
export function evaluatePropertyCondition(
  condition: PropertyCondition,
  contactProps: Record<string, string | null | undefined>,
): boolean {
  const raw = contactProps[condition.field];
  const val = typeof raw === "string" ? raw.toLowerCase() : "";
  switch (condition.operator) {
    case "not_empty":
      return val.length > 0;
    case "equals":
      return val === (condition.value ?? "").toLowerCase();
    case "contains":
      return val.includes((condition.value ?? "").toLowerCase());
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Compute total score from rules + event counts (pure)
// ---------------------------------------------------------------------------

export interface ScoringRuleLike {
  ruleType: "property" | "event";
  conditionJson: Record<string, any>;
  points: number;
  isActive: boolean;
}

/**
 * Compute the raw score from a list of rules, a contact's properties, and a
 * map of (eventType → count).  Returns the total, floored at 0.
 */
export function computeScore(
  rules: ScoringRuleLike[],
  contactProps: Record<string, string | null | undefined>,
  eventCounts: Record<string, number>,
): number {
  let total = 0;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const c = rule.conditionJson;
    let matches = false;
    if (rule.ruleType === "property") {
      matches = evaluatePropertyCondition(
        { field: c.field, operator: c.operator, value: c.value },
        contactProps,
      );
    } else {
      // event rule
      const cnt = eventCounts[c.eventType] ?? 0;
      matches = cnt >= (c.minCount ?? 1);
    }
    if (matches) total += rule.points;
  }
  return Math.max(0, total);
}

// ---------------------------------------------------------------------------
// Multi-tenant isolation helper (used by pushLeadScoresToHubSpot tests)
// ---------------------------------------------------------------------------

/**
 * Filter a list of contact rows to only those belonging to the given tenant.
 * This mirrors the DB-level filter so it can be tested without a real DB.
 */
export function filterContactsByTenant<
  T extends { tenantDomain: string; hubspotContactId: string | null },
>(contacts: T[], tenantDomain: string): T[] {
  return contacts.filter(
    (c) => c.tenantDomain === tenantDomain && c.hubspotContactId !== null,
  );
}
