/**
 * Lead Scoring Service
 *
 * Rule-based scoring engine with AI-assisted rule suggestions.
 * - recomputeScore(contactId) — evaluates all active rules against a contact's
 *   properties + event timeline, updates score + lifecycle_stage, writes a
 *   lifecycle_stage_changed event when the stage advances.
 * - suggestScoringRules(tenantDomain) — calls the AI provider with ICP persona
 *   data and competitive context to generate a starter rule set.
 */

import { db } from "../db";
import { eq, and, count as dbCount } from "drizzle-orm";
import {
  marketingContacts,
  marketingContactEvents,
  marketingScoringRules,
  marketingLifecycleThresholds,
  personas,
  type MarketingContact,
  type MarketingScoringRule,
  type MarketingLifecycleThreshold,
} from "@shared/schema";
import { getDefaultProvider } from "./ai-provider";
import {
  deriveStageFromScore,
  evaluatePropertyCondition,
  stageIndex,
} from "./lead-scoring-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PropertyCondition = {
  field: "jobTitle" | "company" | "source" | "email";
  operator: "contains" | "equals" | "not_empty";
  value?: string;
};

export type EventCondition = {
  eventType: string; // form_submit | page_view | email_open | email_click | link_click | social_engage
  minCount: number;
};

export type RuleCondition = PropertyCondition | EventCondition;

// ---------------------------------------------------------------------------
// Default lifecycle thresholds (used when no tenant overrides exist)
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: Array<{ stage: string; minScore: number }> = [
  { stage: "lead", minScore: 10 },
  { stage: "mql", minScore: 40 },
  { stage: "sql", minScore: 80 },
  { stage: "opportunity", minScore: 120 },
  { stage: "customer", minScore: 200 },
];


// ---------------------------------------------------------------------------
// Evaluate a single rule against contact + event counts
// ---------------------------------------------------------------------------


async function getEventCount(
  contactId: string,
  eventType: string,
): Promise<number> {
  const [row] = await db
    .select({ cnt: dbCount() })
    .from(marketingContactEvents)
    .where(
      and(
        eq(marketingContactEvents.contactId, contactId),
        eq(marketingContactEvents.eventType, eventType),
      ),
    );
  return Number(row?.cnt ?? 0);
}

async function evaluateRule(
  rule: MarketingScoringRule,
  contact: MarketingContact,
): Promise<boolean> {
  const condition = rule.conditionJson as RuleCondition;
  if (!condition) return false;

  if ("eventType" in condition) {
    // Event-based rule
    const cnt = await getEventCount(contact.id, condition.eventType);
    return cnt >= (condition.minCount ?? 1);
  } else {
    // Property-based rule — delegate to the pure core function
    return evaluatePropertyCondition(condition as PropertyCondition, {
      jobTitle: contact.jobTitle,
      company: contact.company,
      email: contact.email,
      source: contact.source,
    });
  }
}

// ---------------------------------------------------------------------------
// Load thresholds for a tenant (falls back to defaults)
// ---------------------------------------------------------------------------

async function loadThresholds(
  tenantDomain: string,
): Promise<Array<{ stage: string; minScore: number }>> {
  const rows = await db
    .select()
    .from(marketingLifecycleThresholds)
    .where(eq(marketingLifecycleThresholds.tenantDomain, tenantDomain));

  if (rows.length === 0) return DEFAULT_THRESHOLDS;
  return rows.map((r) => ({ stage: r.stage, minScore: r.minScore }));
}

// ---------------------------------------------------------------------------
// Main export: recomputeScore
// ---------------------------------------------------------------------------

export async function recomputeScore(contactId: string): Promise<{
  score: number;
  previousScore: number;
  lifecycleStage: string;
  previousStage: string;
  stageChanged: boolean;
}> {
  // Load contact
  const [contact] = await db
    .select()
    .from(marketingContacts)
    .where(eq(marketingContacts.id, contactId))
    .limit(1);

  if (!contact) throw new Error(`Contact not found: ${contactId}`);

  const previousScore = contact.score ?? 0;
  const previousStage = contact.lifecycleStage ?? "subscriber";

  // Load active rules for this tenant
  const rules = await db
    .select()
    .from(marketingScoringRules)
    .where(
      and(
        eq(marketingScoringRules.tenantDomain, contact.tenantDomain),
        eq(marketingScoringRules.isActive, true),
      ),
    );

  // Evaluate each rule
  let score = 0;
  for (const rule of rules) {
    const matches = await evaluateRule(rule, contact);
    if (matches) score += rule.points;
  }
  score = Math.max(0, score); // floor at 0

  // Determine lifecycle stage
  const thresholds = await loadThresholds(contact.tenantDomain);
  const newStage = deriveStageFromScore(score, thresholds, previousStage);
  const stageChanged = newStage !== previousStage;

  // Persist updates
  await db
    .update(marketingContacts)
    .set({ score, lifecycleStage: newStage, updatedAt: new Date() })
    .where(eq(marketingContacts.id, contactId));

  // Write a lifecycle_stage_changed event to the timeline when stage advances
  if (stageChanged) {
    await db.insert(marketingContactEvents).values({
      contactId,
      tenantDomain: contact.tenantDomain,
      eventType: "lifecycle_stage_changed",
      source: "lead_scoring",
      occurredAt: new Date(),
      metadata: {
        previousStage,
        newStage,
        score,
      },
    });
    console.log(
      `[lead-scoring] ${contact.email} stage: ${previousStage} → ${newStage} (score=${score})`,
    );
  }

  return { score, previousScore, lifecycleStage: newStage, previousStage, stageChanged };
}

// ---------------------------------------------------------------------------
// AI rule suggestions
// ---------------------------------------------------------------------------

export async function suggestScoringRules(tenantDomain: string): Promise<
  Array<{
    name: string;
    ruleType: "property" | "event";
    conditionJson: RuleCondition;
    points: number;
  }>
> {
  // Gather context: ICP personas
  const tenantPersonas = await db
    .select({
      name: personas.name,
      role: personas.role,
      industry: personas.industry,
      companySize: personas.companySize,
      painPoints: personas.painPoints,
      goals: personas.goals,
      isIcp: personas.isIcp,
    })
    .from(personas)
    .where(eq(personas.tenantDomain, tenantDomain))
    .limit(10);

  const personaContext =
    tenantPersonas.length > 0
      ? tenantPersonas
          .map(
            (p) =>
              `- ${p.name} (${p.role ?? "unknown role"}, ${p.industry ?? "unknown industry"}, ${p.companySize ?? "unknown size"})${p.isIcp ? " [ICP]" : ""}`,
          )
          .join("\n")
      : "No personas defined.";

  const systemPrompt = `You are a B2B marketing operations expert. Generate lead scoring rules for a SaaS company.
Rules must be returned as valid JSON array only — no markdown fences, no explanation.
Each rule: { "name": string, "ruleType": "property" | "event", "conditionJson": object, "points": number }

Property conditionJson: { "field": "jobTitle"|"company"|"source"|"email", "operator": "contains"|"equals"|"not_empty", "value"?: string }
Event conditionJson: { "eventType": "form_submit"|"page_view"|"email_open"|"email_click"|"link_click"|"social_engage", "minCount": number }

Points should be positive integers (1-30). Generate 8-12 practical rules.`;

  const userPrompt = `Tenant: ${tenantDomain}
ICP Personas:
${personaContext}

Generate lead scoring rules that reward ICP fit (job title, company signals) and engagement behavior (form fills, email opens, clicks, page views).
Return JSON array only.`;

  const { provider, model, maxTokens } = await getDefaultProvider();
  const result = await provider.complete(model, userPrompt, {
    systemPrompt,
    maxTokens: maxTokens ?? 2048,
    temperature: 0.3,
  });

  // Parse the AI response
  let rules: any[] = [];
  try {
    const text = result.text.trim();
    const jsonText = text.startsWith("[") ? text : text.slice(text.indexOf("["));
    rules = JSON.parse(jsonText);
  } catch (err) {
    console.error("[lead-scoring] Failed to parse AI rule suggestions:", err);
    // Return safe fallback defaults
    rules = getDefaultSuggestions();
  }

  // Validate and sanitise each rule
  const VALID_FIELDS = ["jobTitle", "company", "source", "email"];
  const VALID_OPS = ["contains", "equals", "not_empty"];
  const VALID_EVENTS = [
    "form_submit", "page_view", "email_open", "email_click",
    "link_click", "social_engage",
  ];
  const VALID_TYPES = ["property", "event"];

  return rules
    .filter(
      (r) =>
        r &&
        typeof r.name === "string" &&
        VALID_TYPES.includes(r.ruleType) &&
        typeof r.points === "number" &&
        r.conditionJson,
    )
    .map((r) => {
      if (r.ruleType === "property") {
        const c = r.conditionJson;
        if (!VALID_FIELDS.includes(c.field) || !VALID_OPS.includes(c.operator)) return null;
        return { name: r.name, ruleType: "property" as const, conditionJson: c, points: Math.max(1, Math.min(50, Math.round(r.points))) };
      } else {
        const c = r.conditionJson;
        if (!VALID_EVENTS.includes(c.eventType)) return null;
        return {
          name: r.name,
          ruleType: "event" as const,
          conditionJson: { eventType: c.eventType, minCount: Math.max(1, c.minCount ?? 1) },
          points: Math.max(1, Math.min(50, Math.round(r.points))),
        };
      }
    })
    .filter(Boolean) as any[];
}

function getDefaultSuggestions() {
  return [
    { name: "Has job title", ruleType: "property", conditionJson: { field: "jobTitle", operator: "not_empty" }, points: 5 },
    { name: "Job title contains Director", ruleType: "property", conditionJson: { field: "jobTitle", operator: "contains", value: "Director" }, points: 15 },
    { name: "Job title contains VP", ruleType: "property", conditionJson: { field: "jobTitle", operator: "contains", value: "VP" }, points: 20 },
    { name: "Job title contains CTO/CMO/CEO", ruleType: "property", conditionJson: { field: "jobTitle", operator: "contains", value: "C-Suite" }, points: 25 },
    { name: "Has company", ruleType: "property", conditionJson: { field: "company", operator: "not_empty" }, points: 5 },
    { name: "Submitted a form", ruleType: "event", conditionJson: { eventType: "form_submit", minCount: 1 }, points: 20 },
    { name: "Opened an email", ruleType: "event", conditionJson: { eventType: "email_open", minCount: 1 }, points: 5 },
    { name: "Clicked an email link", ruleType: "event", conditionJson: { eventType: "email_click", minCount: 1 }, points: 10 },
    { name: "Visited 3+ pages", ruleType: "event", conditionJson: { eventType: "page_view", minCount: 3 }, points: 8 },
    { name: "Engaged on social", ruleType: "event", conditionJson: { eventType: "social_engage", minCount: 1 }, points: 7 },
  ];
}

// ---------------------------------------------------------------------------
// Bulk recompute for a tenant (for scheduled jobs or admin trigger)
// ---------------------------------------------------------------------------

export async function recomputeAllScores(tenantDomain: string): Promise<{
  updated: number;
  stageChanges: number;
  errors: number;
}> {
  const contacts = await db
    .select({ id: marketingContacts.id })
    .from(marketingContacts)
    .where(eq(marketingContacts.tenantDomain, tenantDomain));

  let updated = 0;
  let stageChanges = 0;
  let errors = 0;

  for (const c of contacts) {
    try {
      const result = await recomputeScore(c.id);
      updated++;
      if (result.stageChanged) stageChanges++;
    } catch (err: any) {
      console.error(`[lead-scoring] recomputeScore failed for ${c.id}:`, err.message);
      errors++;
    }
  }

  console.log(
    `[lead-scoring] Bulk recompute for ${tenantDomain}: updated=${updated} stageChanges=${stageChanges} errors=${errors}`,
  );
  return { updated, stageChanges, errors };
}
