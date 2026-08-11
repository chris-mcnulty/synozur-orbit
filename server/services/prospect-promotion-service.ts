/**
 * Prospect → marketing-contact promotion.
 *
 * Bridges Sales Outreach prospects into the marketing contact spine as a
 * deliberate user action (single prospect, selected prospects, or all
 * prospects in a status within a campaign).
 *
 * Rules
 * ─────
 * - Upsert by (tenantDomain, email): if a marketing contact with the same
 *   email already exists, we LINK (fill only missing fields) — never
 *   duplicate, never overwrite richer data.
 * - Opt-out is sacred: an existing contact with emailOptOut=true is left
 *   completely untouched and reported as skippedOptedOut.
 * - HubSpot identity: the prospect's hubspotContactId is carried onto the
 *   contact only when the contact has none, and is pre-warmed into the
 *   shared resolver cache so both sides use the same HubSpot record.
 * - Source attribution: new contacts get source="outreach" (segmentable via
 *   the existing `source` rule) + sourceProspectId + metadata.outreach with
 *   the originating campaign/prospect/status. Existing contacts keep their
 *   original source but still get the outreach attribution metadata + link.
 * - Promotion does NOT alter prospect status, so the send-time
 *   "exclude active prospects" guard continues to suppress actively-worked
 *   prospects even after promotion.
 *
 * The planning step is pure (no DB) and unit-tested; the apply step executes
 * the plan.
 */

import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { marketingContacts } from "@shared/schema";
import { normaliseEmail } from "./marketing-contact-service";
import { preWarmMarketingCache } from "./hubspot-contact-resolver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromotableProspect {
  id: string;
  campaignId: string;
  name: string;
  email: string | null;
  title: string | null;
  companyName: string | null;
  hubspotContactId: string | null;
  status: string;
}

export interface ExistingContactLite {
  id: string;
  emailOptOut: boolean;
  hubspotContactId: string | null;
  sourceProspectId: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  metadata: Record<string, unknown> | null;
}

export interface OutreachAttribution {
  prospectId: string;
  campaignId: string;
  prospectStatus: string;
  promotedAt: string;
}

export type PromotionAction =
  | { kind: "skip_no_email"; prospectId: string }
  | { kind: "skip_opted_out"; prospectId: string; contactId: string }
  /** Email already promoted earlier in this same batch — nothing to write. */
  | { kind: "duplicate_in_batch"; prospectId: string; email: string }
  | {
      kind: "create";
      prospectId: string;
      email: string;
      values: {
        firstName: string | null;
        lastName: string | null;
        company: string | null;
        jobTitle: string | null;
        hubspotContactId: string | null;
        sourceProspectId: string;
        metadata: Record<string, unknown>;
      };
    }
  | {
      kind: "link";
      prospectId: string;
      contactId: string;
      email: string;
      set: {
        firstName?: string;
        lastName?: string;
        company?: string;
        jobTitle?: string;
        hubspotContactId?: string;
        sourceProspectId?: string;
        metadata: Record<string, unknown>;
      };
    };

export interface PromotionSummary {
  total: number;
  created: number;
  linked: number;
  skippedOptedOut: number;
  skippedNoEmail: number;
}

// ---------------------------------------------------------------------------
// Pure planning (unit-tested)
// ---------------------------------------------------------------------------

/** Split a display name into first/last on the first whitespace. */
export function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

function outreachMetadata(
  existing: Record<string, unknown> | null,
  p: PromotableProspect,
  now: Date,
): Record<string, unknown> {
  const attribution: OutreachAttribution = {
    prospectId: p.id,
    campaignId: p.campaignId,
    prospectStatus: p.status,
    promotedAt: now.toISOString(),
  };
  return { ...(existing || {}), outreach: attribution };
}

/**
 * Compute the write plan for a batch of prospects. Pure — no DB access.
 * `existingByEmail` maps normalized email → existing marketing contact.
 */
export function planProspectPromotions(
  prospectRows: PromotableProspect[],
  existingByEmail: Map<string, ExistingContactLite>,
  now: Date = new Date(),
): PromotionAction[] {
  const actions: PromotionAction[] = [];
  const seenEmails = new Set<string>();

  for (const p of prospectRows) {
    const email = normaliseEmail(p.email || "");
    if (!email || !email.includes("@")) {
      actions.push({ kind: "skip_no_email", prospectId: p.id });
      continue;
    }
    if (seenEmails.has(email)) {
      actions.push({ kind: "duplicate_in_batch", prospectId: p.id, email });
      continue;
    }
    seenEmails.add(email);

    const existing = existingByEmail.get(email);
    const { firstName, lastName } = splitName(p.name);

    if (!existing) {
      actions.push({
        kind: "create",
        prospectId: p.id,
        email,
        values: {
          firstName,
          lastName,
          company: p.companyName?.trim() || null,
          jobTitle: p.title?.trim() || null,
          hubspotContactId: p.hubspotContactId || null,
          sourceProspectId: p.id,
          metadata: outreachMetadata(null, p, now),
        },
      });
      continue;
    }

    // Never touch a contact who opted out — no field updates, no metadata.
    if (existing.emailOptOut) {
      actions.push({ kind: "skip_opted_out", prospectId: p.id, contactId: existing.id });
      continue;
    }

    // Link: fill only missing fields; never overwrite existing data.
    const set: Extract<PromotionAction, { kind: "link" }>["set"] = {
      metadata: outreachMetadata(existing.metadata, p, now),
    };
    if (!existing.firstName && firstName) set.firstName = firstName;
    if (!existing.lastName && lastName) set.lastName = lastName;
    if (!existing.company && p.companyName?.trim()) set.company = p.companyName.trim();
    if (!existing.jobTitle && p.title?.trim()) set.jobTitle = p.title.trim();
    if (!existing.hubspotContactId && p.hubspotContactId) {
      set.hubspotContactId = p.hubspotContactId;
    }
    if (!existing.sourceProspectId) set.sourceProspectId = p.id;

    actions.push({ kind: "link", prospectId: p.id, contactId: existing.id, email, set });
  }

  return actions;
}

/** Roll a plan up into the summary shape returned to the UI. */
export function summarizePlan(actions: PromotionAction[]): PromotionSummary {
  const summary: PromotionSummary = {
    total: actions.length,
    created: 0,
    linked: 0,
    skippedOptedOut: 0,
    skippedNoEmail: 0,
  };
  for (const a of actions) {
    if (a.kind === "create") summary.created += 1;
    else if (a.kind === "link" || a.kind === "duplicate_in_batch") summary.linked += 1;
    else if (a.kind === "skip_opted_out") summary.skippedOptedOut += 1;
    else summary.skippedNoEmail += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Apply (DB)
// ---------------------------------------------------------------------------

/**
 * Promote prospects into marketing contacts. Returns a summary of what
 * happened. Prospect rows must already be tenant-scoped by the caller.
 */
export async function promoteProspects(
  tenantDomain: string,
  prospectRows: PromotableProspect[],
): Promise<PromotionSummary> {
  const emails = Array.from(
    new Set(
      prospectRows
        .map((p) => normaliseEmail(p.email || ""))
        .filter((e) => e && e.includes("@")),
    ),
  );

  const existingRows = emails.length
    ? await db
        .select({
          id: marketingContacts.id,
          email: marketingContacts.email,
          emailOptOut: marketingContacts.emailOptOut,
          hubspotContactId: marketingContacts.hubspotContactId,
          sourceProspectId: marketingContacts.sourceProspectId,
          firstName: marketingContacts.firstName,
          lastName: marketingContacts.lastName,
          company: marketingContacts.company,
          jobTitle: marketingContacts.jobTitle,
          metadata: marketingContacts.metadata,
        })
        .from(marketingContacts)
        .where(
          and(
            eq(marketingContacts.tenantDomain, tenantDomain),
            inArray(marketingContacts.email, emails),
          ),
        )
    : [];

  const existingByEmail = new Map<string, ExistingContactLite>(
    existingRows.map((r) => [
      r.email,
      { ...r, metadata: (r.metadata as Record<string, unknown> | null) ?? null },
    ]),
  );

  const actions = planProspectPromotions(prospectRows, existingByEmail);
  const summary = summarizePlan(actions);
  const now = new Date();

  const prospectById = new Map(prospectRows.map((p) => [p.id, p]));

  for (const action of actions) {
    if (action.kind === "create") {
      const inserted = await db
        .insert(marketingContacts)
        .values({
          id: randomUUID(),
          tenantDomain,
          email: action.email,
          firstName: action.values.firstName,
          lastName: action.values.lastName,
          company: action.values.company,
          jobTitle: action.values.jobTitle,
          hubspotContactId: action.values.hubspotContactId,
          source: "outreach",
          sourceProspectId: action.values.sourceProspectId,
          metadata: action.values.metadata,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [marketingContacts.tenantDomain, marketingContacts.email],
        })
        .returning({ id: marketingContacts.id });
      // Lost a concurrent race — the contact now exists; count as linked.
      if (inserted.length === 0) {
        summary.created -= 1;
        summary.linked += 1;
      }
    } else if (action.kind === "link") {
      await db
        .update(marketingContacts)
        .set({ ...action.set, updatedAt: now })
        .where(
          and(
            eq(marketingContacts.id, action.contactId),
            eq(marketingContacts.tenantDomain, tenantDomain),
            // Belt-and-braces: never write to an opted-out contact even if
            // the flag flipped between plan and apply.
            eq(marketingContacts.emailOptOut, false),
          ),
        );
    }

    // HubSpot identity unification: seed the shared resolver cache so the
    // marketing send path finds the same contact id without an API call.
    if (action.kind === "create" || action.kind === "link") {
      const p = prospectById.get(action.prospectId);
      if (p?.hubspotContactId && p.email) {
        preWarmMarketingCache(tenantDomain, p.email, p.hubspotContactId).catch(() => {});
      }
    }
  }

  return summary;
}
