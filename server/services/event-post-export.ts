import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { conferences, generatedPosts, socialAccounts } from "@shared/schema";
import { buildPostsCsv } from "./posts-csv-export";

export const eventExportSelection = z.object({
  conferenceIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  socialAccountIds: z.array(z.string().min(1).max(100)).min(1).max(100),
});
export const eventExportRequest = eventExportSelection.extend({
  format: z.enum(["socialpilot", "generic", "hootsuite", "sproutsocial"]).default("socialpilot"),
  tzOffset: z.number().int().min(-840).max(840).default(0),
});
export type EventExportScope = { tenantDomain: string; marketId: string | null };
export class EventExportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Selection = { conferenceIds: string[]; socialAccountIds?: string[] };
type Post = typeof generatedPosts.$inferSelect;

export async function validateEventExportScope(scope: EventExportScope, selection: Selection) {
  const eventIds = [...new Set(selection.conferenceIds)];
  const events = await db.select().from(conferences).where(and(
    eq(conferences.tenantDomain, scope.tenantDomain),
    scope.marketId ? eq(conferences.marketId, scope.marketId) : isNull(conferences.marketId),
    inArray(conferences.id, eventIds), eq(conferences.status, "active"),
  ));
  if (events.length !== eventIds.length) throw new EventExportError("One or more selected events are unavailable in this market.", 404);
  if (selection.socialAccountIds) {
    const ids = [...new Set(selection.socialAccountIds)];
    const accounts = await db.select().from(socialAccounts).where(and(
      eq(socialAccounts.tenantDomain, scope.tenantDomain),
      scope.marketId ? eq(socialAccounts.marketId, scope.marketId) : isNull(socialAccounts.marketId),
      inArray(socialAccounts.id, ids), eq(socialAccounts.status, "active"),
    ));
    if (accounts.length !== ids.length) throw new EventExportError("One or more selected accounts are unavailable in this market.", 404);
  }
}

function selectionWhere(scope: EventExportScope, selection: Selection) {
  return and(
    eq(generatedPosts.tenantDomain, scope.tenantDomain),
    inArray(generatedPosts.conferenceId, selection.conferenceIds),
    ...(selection.socialAccountIds ? [inArray(generatedPosts.socialAccountId, selection.socialAccountIds)] : []),
  );
}

const delivered = (p: Post) => Boolean(p.publishedAt)
  || ["published", "posted", "exported", "scheduled_external"].includes(p.status);
const future = (p: Post, now: Date) => Boolean(p.scheduledDate && p.scheduledDate >= now);
const eligible = (p: Post, now: Date) => p.status === "approved" && !delivered(p) && future(p, now);

export function eventExportCounts(posts: Post[], now = new Date()) {
  const visible = posts.filter(p => !["deleted", "rejected", "archived"].includes(p.status));
  const ready = visible.filter(p => eligible(p, now) && !p.publishClaimToken);
  return {
    totalPosts: visible.length,
    exportablePosts: ready.length,
    automaticPosts: ready.filter(p => p.deliveryMode !== "csv").length,
    csvPosts: ready.filter(p => p.deliveryMode === "csv").length,
    undatedOrPastPosts: visible.filter(p => !delivered(p) && !future(p, now)).length,
    draftPosts: visible.filter(p => p.status === "draft").length,
    claimedPosts: visible.filter(p => eligible(p, now) && p.publishClaimToken).length,
    deliveredPosts: visible.filter(delivered).length,
  };
}

export async function previewEventExport(scope: EventExportScope, selection: Selection) {
  await validateEventExportScope(scope, selection);
  const posts = await db.select().from(generatedPosts).where(selectionWhere(scope, selection));
  return eventExportCounts(posts);
}

export async function exportEventPosts(
  scope: EventExportScope, selection: Selection,
  options: { format: string; tzOffset: number; imageBaseUrl?: string },
) {
  await validateEventExportScope(scope, selection);
  // Reserve ownership before rendering CSV or fetching images. Row locks pair
  // with the worker's claim-time delivery-mode check, not its stale candidate
  // snapshot. A failed download deliberately leaves CSV ownership in place.
  const posts = await db.transaction(async tx => {
    const candidates = await tx.select().from(generatedPosts)
      .where(selectionWhere(scope, selection)).for("update");
    const now = new Date();
    const ready = candidates.filter(p => eligible(p, now));
    if (ready.some(p => p.publishClaimToken)) {
      throw new EventExportError("A selected post is already being sent. Wait for delivery to finish before exporting this selection.", 409);
    }
    if (!ready.length) throw new EventExportError("No approved, future-dated posts match this selection. Approve and schedule posts before exporting.", 422);
    if (ready.some(p => !p.socialAccountId)) throw new EventExportError("Assign a target account to every selected post before exporting.", 422);
    const updated = await tx.update(generatedPosts).set({ deliveryMode: "csv", updatedAt: now })
      .where(and(selectionWhere(scope, selection), inArray(generatedPosts.id, ready.map(p => p.id)),
        eq(generatedPosts.status, "approved"), isNull(generatedPosts.publishedAt), isNull(generatedPosts.publishClaimToken)))
      .returning();
    if (updated.length !== ready.length) throw new EventExportError("Post delivery changed. Refresh the selection before exporting.", 409);
    return updated;
  });
  try {
    const csv = await buildPostsCsv({ posts, tenantDomain: scope.tenantDomain, ...options });
    return { csv, postIds: posts.map(p => p.id) };
  } catch {
    throw new EventExportError("CSV download failed. The selected posts remain export-only and will not publish automatically. Retry the download.", 500);
  }
}

export async function confirmEventExport(scope: EventExportScope, selection: Selection, postIds: string[]) {
  await validateEventExportScope(scope, selection);
  const updated = await db.update(generatedPosts).set({ status: "exported", updatedAt: new Date() })
    .where(and(selectionWhere(scope, selection), inArray(generatedPosts.id, postIds),
      eq(generatedPosts.status, "approved"), eq(generatedPosts.deliveryMode, "csv"),
      isNull(generatedPosts.publishedAt), isNull(generatedPosts.publishClaimToken)))
    .returning({ id: generatedPosts.id });
  return { updated: updated.length };
}
