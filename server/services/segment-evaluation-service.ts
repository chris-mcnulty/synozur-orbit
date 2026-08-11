/**
 * Segment Evaluation Service
 *
 * Parses a segment's rule_json and executes a dynamic query over
 * marketing_contacts + marketing_contact_events to produce a membership set.
 * The result is then upserted into marketing_segment_members.
 *
 * Rule schema (TypeScript representation):
 *
 *   type FieldCondition = {
 *     type: "field";
 *     field: "email" | "firstName" | "lastName" | "company" | "jobTitle"
 *           | "lifecycleStage" | "source";
 *     operator: "eq" | "neq" | "contains" | "not_contains"
 *              | "starts_with" | "ends_with" | "is_null" | "is_not_null";
 *     value?: string;
 *   };
 *
 *   type EventCondition = {
 *     type: "event";
 *     eventType: string;           // e.g. "email_open", "form_submit"
 *     operator: "has_done" | "has_not_done";
 *     withinDays?: number;         // only consider events in the last N days
 *   };
 *
 *   type SegmentRule = {
 *     logic: "AND" | "OR";
 *     conditions: (FieldCondition | EventCondition)[];
 *   };
 */

import { db } from "../db";
import {
  marketingContacts,
  marketingContactEvents,
  marketingSegments,
  marketingSegmentMembers,
  type MarketingSegment,
} from "@shared/schema";
import { eq, and, or, inArray, notInArray, ilike, isNull, isNotNull, sql } from "drizzle-orm";

// ─── Rule types ───────────────────────────────────────────────────────────────

type FieldOperator =
  | "eq" | "neq"
  | "contains" | "not_contains"
  | "starts_with" | "ends_with"
  | "is_null" | "is_not_null";

type EventOperator = "has_done" | "has_not_done";

export interface FieldCondition {
  type: "field";
  field: "email" | "firstName" | "lastName" | "company" | "jobTitle" | "lifecycleStage" | "source";
  operator: FieldOperator;
  value?: string;
}

export interface EventCondition {
  type: "event";
  eventType: string;
  operator: EventOperator;
  withinDays?: number;
}

export type SegmentCondition = FieldCondition | EventCondition;

export interface SegmentRule {
  logic: "AND" | "OR";
  conditions: SegmentCondition[];
}

// ─── Column mapping ───────────────────────────────────────────────────────────

const FIELD_MAP: Record<string, any> = {
  email: marketingContacts.email,
  firstName: marketingContacts.firstName,
  lastName: marketingContacts.lastName,
  company: marketingContacts.company,
  jobTitle: marketingContacts.jobTitle,
  lifecycleStage: marketingContacts.lifecycleStage,
  source: marketingContacts.source,
};

// ─── Evaluation core ──────────────────────────────────────────────────────────

/**
 * Evaluate a SegmentRule and return the IDs of matching contacts
 * for the given tenant. Returns an empty array when rules is empty or invalid.
 */
export async function evaluateSegmentRule(
  tenantDomain: string,
  rule: SegmentRule,
): Promise<string[]> {
  if (!rule?.conditions?.length) {
    // No conditions → empty segment (don't match everything)
    return [];
  }

  const fieldConds = rule.conditions.filter((c): c is FieldCondition => c.type === "field");
  const eventConds = rule.conditions.filter((c): c is EventCondition => c.type === "event");

  // Start with all contacts for this tenant, then apply filters.
  let candidateIds: string[] | null = null; // null = "all contacts" (lazy initialisation)

  if (rule.logic === "AND") {
    // All field conditions must match → build WHERE clauses for a single query
    if (fieldConds.length > 0) {
      const whereClauses = buildFieldWhere(tenantDomain, fieldConds, "AND");
      const rows = await db
        .select({ id: marketingContacts.id })
        .from(marketingContacts)
        .where(whereClauses);
      candidateIds = rows.map((r) => r.id);
    }

    // All event conditions must match → intersect contact sets iteratively
    for (const cond of eventConds) {
      const matchingEventContactIds = await resolveEventContactIds(tenantDomain, cond);
      if (candidateIds === null) {
        candidateIds = matchingEventContactIds;
      } else {
        const matchSet = new Set(matchingEventContactIds);
        candidateIds = candidateIds.filter((id) => matchSet.has(id));
      }
      if (candidateIds.length === 0) break; // Short-circuit: AND can't grow
    }

    return candidateIds ?? [];
  } else {
    // OR logic → union all matching sets
    const allMatchIds = new Set<string>();

    if (fieldConds.length > 0) {
      const whereClauses = buildFieldWhere(tenantDomain, fieldConds, "OR");
      const rows = await db
        .select({ id: marketingContacts.id })
        .from(marketingContacts)
        .where(whereClauses);
      for (const r of rows) allMatchIds.add(r.id);
    }

    for (const cond of eventConds) {
      const ids = await resolveEventContactIds(tenantDomain, cond);
      for (const id of ids) allMatchIds.add(id);
    }

    return Array.from(allMatchIds);
  }
}

// ─── Field WHERE builder ──────────────────────────────────────────────────────

function buildFieldWhere(
  tenantDomain: string,
  conditions: FieldCondition[],
  logic: "AND" | "OR",
): any {
  const clauses: any[] = [eq(marketingContacts.tenantDomain, tenantDomain)];

  const condClauses = conditions.map((cond) => buildSingleFieldClause(cond)).filter(Boolean);

  if (condClauses.length === 0) return and(...clauses);

  if (logic === "AND") {
    return and(...clauses, ...condClauses);
  } else {
    return and(eq(marketingContacts.tenantDomain, tenantDomain), or(...condClauses));
  }
}

function buildSingleFieldClause(cond: FieldCondition): any | null {
  const col = FIELD_MAP[cond.field];
  if (!col) return null;

  const val = cond.value ?? "";

  switch (cond.operator) {
    case "eq":
      return eq(col, val);
    case "neq":
      return sql`${col} != ${val}`;
    case "contains":
      return ilike(col, `%${val}%`);
    case "not_contains":
      return sql`${col} NOT ILIKE ${"%" + val + "%"}`;
    case "starts_with":
      return ilike(col, `${val}%`);
    case "ends_with":
      return ilike(col, `%${val}`);
    case "is_null":
      return isNull(col);
    case "is_not_null":
      return isNotNull(col);
    default:
      return null;
  }
}

// ─── Event condition resolver ─────────────────────────────────────────────────

async function resolveEventContactIds(
  tenantDomain: string,
  cond: EventCondition,
): Promise<string[]> {
  // Build date filter if withinDays is set
  const cutoff = cond.withinDays
    ? new Date(Date.now() - cond.withinDays * 24 * 60 * 60 * 1000)
    : null;

  // Get distinct contact IDs who have done this event
  const whereParts: any[] = [
    eq(marketingContactEvents.tenantDomain, tenantDomain),
    eq(marketingContactEvents.eventType, cond.eventType),
  ];
  if (cutoff) {
    whereParts.push(sql`${marketingContactEvents.occurredAt} >= ${cutoff}`);
  }

  const eventRows = await db
    .selectDistinct({ contactId: marketingContactEvents.contactId })
    .from(marketingContactEvents)
    .where(and(...whereParts));

  const contactIdsWithEvent = eventRows.map((r) => r.contactId);

  if (cond.operator === "has_done") {
    return contactIdsWithEvent;
  } else {
    // has_not_done → all tenant contacts minus those who have done it
    const allRows = await db
      .select({ id: marketingContacts.id })
      .from(marketingContacts)
      .where(eq(marketingContacts.tenantDomain, tenantDomain));

    if (contactIdsWithEvent.length === 0) return allRows.map((r) => r.id);

    const doneSet = new Set(contactIdsWithEvent);
    return allRows.map((r) => r.id).filter((id) => !doneSet.has(id));
  }
}

// ─── Membership upsert ────────────────────────────────────────────────────────

/**
 * Recompute segment membership for a single segment and upsert
 * marketing_segment_members. Returns the new member count.
 */
export async function refreshSegmentMembership(segment: MarketingSegment): Promise<number> {
  // HubSpot-list-backed segments mirror membership FROM HubSpot — evaluating
  // their (empty) rule tree would wipe the imported membership. Delegate.
  if (segment.source === "hubspot_list") {
    const { syncHubspotListSegment } = await import("./hubspot-list-segment-service");
    return syncHubspotListSegment(segment);
  }

  const rule = parseRule(segment.ruleJson);

  const contactIds = await evaluateSegmentRule(segment.tenantDomain, rule);

  // Replace the entire member set in a transaction
  await db.transaction(async (tx) => {
    // Delete current members
    await tx
      .delete(marketingSegmentMembers)
      .where(eq(marketingSegmentMembers.segmentId, segment.id));

    // Insert new members in batches
    const BATCH = 500;
    for (let i = 0; i < contactIds.length; i += BATCH) {
      const batch = contactIds.slice(i, i + BATCH);
      if (batch.length > 0) {
        await tx.insert(marketingSegmentMembers).values(
          batch.map((contactId) => ({
            segmentId: segment.id,
            contactId,
            tenantDomain: segment.tenantDomain,
            addedAt: new Date(),
          })),
        );
      }
    }

    // Stamp last refreshed timestamp
    await tx
      .update(marketingSegments)
      .set({ lastRefreshedAt: new Date(), updatedAt: new Date() })
      .where(eq(marketingSegments.id, segment.id));
  });

  return contactIds.length;
}

/**
 * Refresh all active segments for a tenant (or all tenants when tenantDomain
 * is omitted) whose refresh interval has elapsed.
 */
export async function refreshDueSegments(tenantDomain?: string): Promise<{
  checked: number;
  refreshed: number;
  errors: number;
  /** Segments that were actually refreshed in this sweep (id + hubspotListId + source). */
  refreshedSegments: Array<{ id: string; tenantDomain: string; hubspotListId: string | null; source: string }>;
}> {
  const conditions: any[] = [eq(marketingSegments.isActive, true)];
  if (tenantDomain) conditions.push(eq(marketingSegments.tenantDomain, tenantDomain));

  const segments = await db
    .select()
    .from(marketingSegments)
    .where(and(...conditions));

  let checked = 0;
  let refreshed = 0;
  let errors = 0;
  const refreshedSegments: Array<{ id: string; tenantDomain: string; hubspotListId: string | null; source: string }> = [];
  const now = Date.now();

  for (const segment of segments) {
    checked++;
    // Skip if not due yet (based on refreshIntervalMinutes)
    const intervalMinutes = segment.refreshIntervalMinutes ?? 60;
    // refreshIntervalMinutes === 0 means "manual only" — never auto-refresh.
    if (intervalMinutes === 0) continue;
    const intervalMs = intervalMinutes * 60 * 1000;
    const lastRefreshed = segment.lastRefreshedAt ? new Date(segment.lastRefreshedAt).getTime() : 0;
    if (now - lastRefreshed < intervalMs) continue;

    try {
      const count = await refreshSegmentMembership(segment);
      console.log(
        `[Segments] Refreshed "${segment.name}" (${segment.id}) → ${count} members`,
      );
      refreshed++;
      refreshedSegments.push({
        id: segment.id,
        tenantDomain: segment.tenantDomain,
        hubspotListId: segment.hubspotListId ?? null,
        source: segment.source ?? "rules",
      });
    } catch (err: any) {
      console.error(
        `[Segments] Error refreshing segment "${segment.name}" (${segment.id}): ${err.message}`,
      );
      errors++;
    }
  }

  return { checked, refreshed, errors, refreshedSegments };
}

// ─── Preview count (no write) ─────────────────────────────────────────────────

/**
 * Run the evaluation without persisting results — used for the live preview
 * count in the segment builder UI.
 */
export async function previewSegmentCount(
  tenantDomain: string,
  ruleJson: unknown,
): Promise<number> {
  const rule = parseRule(ruleJson);
  const ids = await evaluateSegmentRule(tenantDomain, rule);
  return ids.length;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRule(ruleJson: unknown): SegmentRule {
  if (!ruleJson || typeof ruleJson !== "object") {
    return { logic: "AND", conditions: [] };
  }
  const r = ruleJson as any;
  return {
    logic: r.logic === "OR" ? "OR" : "AND",
    conditions: Array.isArray(r.conditions) ? r.conditions : [],
  };
}

/**
 * Get member emails for a segment (used by HubSpot sync and email targeting).
 */
export async function getSegmentMemberEmails(segmentId: string, tenantDomain: string): Promise<string[]> {
  const rows = await db
    .select({ email: marketingContacts.email })
    .from(marketingSegmentMembers)
    .innerJoin(
      marketingContacts,
      eq(marketingSegmentMembers.contactId, marketingContacts.id),
    )
    .where(
      and(
        eq(marketingSegmentMembers.segmentId, segmentId),
        eq(marketingSegmentMembers.tenantDomain, tenantDomain),
      ),
    );
  return rows.map((r) => r.email);
}
