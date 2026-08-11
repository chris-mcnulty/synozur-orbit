/**
 * HubSpot-List-Backed Segments
 *
 * Lets editors use a HubSpot contact list as an email send audience.
 * A segment with source='hubspot_list' mirrors the membership snapshot of a
 * HubSpot list into marketing_segment_members:
 *
 *   - Contacts are upserted into the marketing contact spine (dedupe by
 *     tenant+email). Opt-out state is never touched by the upsert, so a sync
 *     can never re-activate an unsubscribed contact.
 *   - Membership is fully replaced on each sync, so contacts who left the
 *     HubSpot list drop out on refresh.
 *   - Delivery still flows through the normal segment resolution, so
 *     suppression, opt-out, and subscription-type checks all apply unchanged.
 *
 * Sync paths:
 *   - Import (audience picker)         → enqueued via the job queue
 *   - Manual re-sync                   → enqueued via the job queue
 *   - Pre-send refresh (delivery time) → inline, best-effort (stale snapshot
 *     is used when HubSpot is unreachable rather than blocking the send)
 */

import { db } from "../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  marketingSegments,
  marketingSegmentMembers,
  marketingContacts,
  type MarketingSegment,
  type MarketingContact,
} from "@shared/schema";
import { normaliseEmail } from "./marketing-contact-service";
import { enqueue } from "./job-queue";

export const HUBSPOT_LIST_SEGMENT_SOURCE = "hubspot_list";

/** Hard ceiling on importable list size — oversized lists fail explicitly. */
export const HUBSPOT_LIST_IMPORT_MAX = Number(process.env.HUBSPOT_LIST_IMPORT_MAX || 50_000);

/** A snapshot younger than this is considered fresh enough to send against. */
const PRE_SEND_FRESHNESS_MS = 10 * 60 * 1000;

export function isHubspotListSegment(segment: Pick<MarketingSegment, "source">): boolean {
  return segment.source === HUBSPOT_LIST_SEGMENT_SOURCE;
}

/**
 * Find or create the segment linked to a HubSpot list for this tenant.
 * Does NOT sync membership — callers enqueue syncHubspotListSegment next.
 */
export async function ensureHubspotListSegment(opts: {
  tenantDomain: string;
  listId: string;
  listName: string;
  createdBy: string;
}): Promise<{ segment: MarketingSegment; created: boolean }> {
  const [existing] = await db
    .select()
    .from(marketingSegments)
    .where(
      and(
        eq(marketingSegments.tenantDomain, opts.tenantDomain),
        eq(marketingSegments.hubspotListId, opts.listId),
        eq(marketingSegments.source, HUBSPOT_LIST_SEGMENT_SOURCE),
      ),
    );
  if (existing) {
    // Keep the display name in step with HubSpot renames.
    if (opts.listName && existing.hubspotListName !== opts.listName) {
      const [updated] = await db
        .update(marketingSegments)
        .set({ hubspotListName: opts.listName, updatedAt: new Date() })
        .where(eq(marketingSegments.id, existing.id))
        .returning();
      return { segment: updated, created: false };
    }
    return { segment: existing, created: false };
  }

  const [segment] = await db
    .insert(marketingSegments)
    .values({
      tenantDomain: opts.tenantDomain,
      name: `HubSpot: ${opts.listName}`,
      description: `Linked to HubSpot list "${opts.listName}" (id ${opts.listId}). Membership mirrors the HubSpot list snapshot.`,
      ruleJson: {},
      // Manual + pre-send refresh only — the scheduler must not hammer HubSpot.
      refreshIntervalMinutes: 0,
      hubspotListId: opts.listId,
      source: HUBSPOT_LIST_SEGMENT_SOURCE,
      hubspotListName: opts.listName,
      hubspotSyncStatus: "pending",
      isActive: true,
      createdBy: opts.createdBy,
    })
    .returning();
  return { segment, created: true };
}

/**
 * Sync a hubspot_list segment's membership from HubSpot.
 *
 * Fetches every list member, upserts them into marketing_contacts (opt-out
 * fields are untouched by design — see upsertContact), then replaces the
 * materialised membership so removals reconcile too. Returns member count.
 */
export async function syncHubspotListSegment(segment: MarketingSegment): Promise<number> {
  if (!isHubspotListSegment(segment) || !segment.hubspotListId) {
    throw new Error(`Segment ${segment.id} is not a HubSpot-list-backed segment`);
  }

  await db
    .update(marketingSegments)
    .set({ hubspotSyncStatus: "syncing", updatedAt: new Date() })
    .where(eq(marketingSegments.id, segment.id));

  try {
    const { listAllContactsFromHubspotList } = await import("./hubspot-integration");
    // Oversized lists fail explicitly (surfaced via hubspotSyncError) rather
    // than importing a silently truncated audience.
    const hsContacts = await listAllContactsFromHubspotList(
      segment.tenantDomain,
      segment.hubspotListId,
      HUBSPOT_LIST_IMPORT_MAX,
    );

    // Dedupe by normalised email; contacts without an email can't receive
    // email and are skipped.
    const byEmail = new Map<string, (typeof hsContacts)[number]>();
    for (const c of hsContacts) {
      if (!c.email) continue;
      const email = normaliseEmail(c.email);
      if (!byEmail.has(email)) byEmail.set(email, c);
    }

    // Batched upsert into the contact spine — one round trip per 500 members
    // instead of one per member, so 10k-contact imports don't take minutes or
    // starve the send worker. Semantics match upsertContact: COALESCE keeps
    // existing richer data, and opt-out fields are never written, so a sync
    // can never re-activate an unsubscribed contact.
    const contactIds: string[] = [];
    const members = [...byEmail.entries()];
    const BATCH = 500;
    const now = new Date();
    for (let i = 0; i < members.length; i += BATCH) {
      const batch = members.slice(i, i + BATCH);
      const rows = await db
        .insert(marketingContacts)
        .values(
          batch.map(([email, c]) => ({
            tenantDomain: segment.tenantDomain,
            email,
            firstName: c.firstName?.trim() || null,
            lastName: c.lastName?.trim() || null,
            company: c.company?.trim() || null,
            jobTitle: c.jobTitle?.trim() || null,
            lifecycleStage: "subscriber",
            hubspotContactId: c.hubspotContactId || null,
            source: "hubspot",
            lastEventAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [marketingContacts.tenantDomain, marketingContacts.email],
          set: {
            firstName: sql`COALESCE(excluded.first_name, ${marketingContacts.firstName})`,
            lastName: sql`COALESCE(excluded.last_name, ${marketingContacts.lastName})`,
            company: sql`COALESCE(excluded.company, ${marketingContacts.company})`,
            jobTitle: sql`COALESCE(excluded.job_title, ${marketingContacts.jobTitle})`,
            hubspotContactId: sql`COALESCE(excluded.hubspot_contact_id, ${marketingContacts.hubspotContactId})`,
            updatedAt: now,
          },
        })
        .returning({ id: marketingContacts.id });
      contactIds.push(...rows.map((r) => r.id));
    }

    const replacedAt = new Date();
    await db.transaction(async (tx) => {
      // Full replace — reconciles both additions and removals.
      await tx.delete(marketingSegmentMembers).where(eq(marketingSegmentMembers.segmentId, segment.id));
      const BATCH = 500;
      for (let i = 0; i < contactIds.length; i += BATCH) {
        const batch = contactIds.slice(i, i + BATCH);
        if (batch.length > 0) {
          await tx.insert(marketingSegmentMembers).values(
            batch.map((contactId) => ({
              segmentId: segment.id,
              contactId,
              tenantDomain: segment.tenantDomain,
              addedAt: now,
            })),
          );
        }
      }
      await tx
        .update(marketingSegments)
        .set({
          lastRefreshedAt: now,
          lastHubspotSyncAt: now,
          hubspotSyncStatus: "synced",
          hubspotSyncError: null,
          updatedAt: now,
        })
        .where(eq(marketingSegments.id, segment.id));
    });

    console.log(`[HubSpot List Segment] Synced "${segment.name}" (${segment.id}) → ${contactIds.length} members`);
    return contactIds.length;
  } catch (err: any) {
    await db
      .update(marketingSegments)
      .set({ hubspotSyncStatus: "error", hubspotSyncError: String(err?.message ?? err), updatedAt: new Date() })
      .where(eq(marketingSegments.id, segment.id))
      .catch?.(() => {});
    throw err;
  }
}

/**
 * Enqueue a sync through the shared job queue so large imports/refreshes
 * don't starve the email-send worker or block HTTP request handlers.
 * Coalesced per segment: while a sync is already queued/running for a
 * segment, further calls return the in-flight promise instead of enqueuing
 * duplicate jobs.
 */
const inFlightSyncs = new Map<string, Promise<number>>();

export function enqueueHubspotListSegmentSync(segment: MarketingSegment): Promise<number> {
  const existing = inFlightSyncs.get(segment.id);
  if (existing) return existing;
  const p = enqueue(
    "other",
    `hubspot-list-sync:${segment.id}`,
    () => syncHubspotListSegment(segment),
    { timeoutMs: 10 * 60 * 1000, maxRetries: 1, ctx: { tenantDomain: segment.tenantDomain } as any },
  ).finally(() => inFlightSyncs.delete(segment.id));
  inFlightSyncs.set(segment.id, p);
  return p;
}

/**
 * Resolve a marketing_segments row into send recipients from the materialised
 * membership table. Returns null when the id doesn't match a marketing_segments
 * row (the caller then falls back to legacy contact-segment resolution).
 *
 * For hubspot_list segments the membership is refreshed from HubSpot first
 * (pre-send refresh), best-effort: if HubSpot is unreachable the most recent
 * snapshot is used so a scheduled send is degraded, not dropped.
 */
export async function resolveMarketingSegmentContacts(
  segmentId: string,
  tenantDomain: string,
  limit = 2000,
): Promise<MarketingContact[] | null> {
  const [segment] = await db
    .select()
    .from(marketingSegments)
    .where(and(eq(marketingSegments.id, segmentId), eq(marketingSegments.tenantDomain, tenantDomain)));
  if (!segment) return null;

  if (isHubspotListSegment(segment)) {
    // Pre-send refresh policy — NEVER awaits HubSpot on the delivery path:
    //  - no completed sync yet (first import still pending/running/failed
    //    before first success) → defer the send; the worker retries after
    //    the import finishes rather than sending an empty/partial audience.
    //  - snapshot fresh (< PRE_SEND_FRESHNESS_MS) → use it as-is.
    //  - snapshot stale → use it immediately AND kick off a coalesced
    //    background sync so the audience converges for subsequent sends.
    if (!segment.lastHubspotSyncAt) {
      enqueueHubspotListSegmentSync(segment).catch(() => {});
      throw Object.assign(
        new Error(
          `HubSpot list segment "${segment.name}" has not finished its first import yet — the send will retry once the import completes.`,
        ),
        { status: 409, deferSend: true },
      );
    }
    const lastSync = new Date(segment.lastHubspotSyncAt).getTime();
    if (Date.now() - lastSync >= PRE_SEND_FRESHNESS_MS) {
      // Fire-and-forget; coalesced per segment so repeated sends don't pile
      // up duplicate refresh jobs.
      enqueueHubspotListSegmentSync(segment).catch((err: any) => {
        console.warn(
          `[HubSpot List Segment] Background refresh failed for ${segment.id} — snapshot unchanged: ${err?.message ?? err}`,
        );
      });
    }
  }

  // Fetch limit+1 so over-cap membership is detected and rejected explicitly —
  // silently sending to the first `limit` members would omit recipients with
  // no visible error.
  const rows = await db
    .select({ contact: marketingContacts })
    .from(marketingSegmentMembers)
    .innerJoin(marketingContacts, eq(marketingSegmentMembers.contactId, marketingContacts.id))
    .where(
      and(
        eq(marketingSegmentMembers.segmentId, segment.id),
        eq(marketingSegmentMembers.tenantDomain, tenantDomain),
      ),
    )
    .limit(limit + 1);
  if (rows.length > limit) {
    throw Object.assign(
      new Error(
        `Segment "${segment.name}" has more than ${limit} members, which exceeds the maximum recipients per send. ` +
        `Split the audience or raise MARKETING_MAX_RECIPIENTS_PER_SEND.`,
      ),
      { status: 422 },
    );
  }
  return rows.map((r) => r.contact);
}
