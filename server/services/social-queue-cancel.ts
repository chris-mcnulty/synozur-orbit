import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { generatedPosts, marketingAuditLog } from "@shared/schema";

export async function cancelQueuedPosts(opts: {
  tenantDomain: string;
  marketId: string | null;
  userId: string;
  postIds: string[];
}) {
  const ids = [...new Set(opts.postIds)];
  return db.transaction(async tx => {
    // The worker claims with a guarded UPDATE too. Whichever locks the row
    // first wins: cancelled posts cannot be claimed, claimed posts cannot be
    // cancelled. Even expired claims are protected for outcome-unknown review.
    const rows = await tx.update(generatedPosts).set({
      status: "deleted",
      publishNextAttemptAt: null,
      publishNotBefore: null,
      updatedAt: new Date(),
    }).where(and(
      eq(generatedPosts.tenantDomain, opts.tenantDomain),
      inArray(generatedPosts.id, ids),
      inArray(generatedPosts.status, ["draft", "approved", "publish_failed", "missed"]),
      isNull(generatedPosts.publishedAt),
      isNull(generatedPosts.publishClaimToken),
    )).returning({ id: generatedPosts.id });
    const cancelledIds = rows.map(row => row.id);
    const cancelledSet = new Set(cancelledIds);
    const skippedIds = ids.filter(id => !cancelledSet.has(id));
    if (cancelledIds.length) {
      await tx.insert(marketingAuditLog).values({
        tenantDomain: opts.tenantDomain,
        marketId: opts.marketId,
        userId: opts.userId,
        action: "social_queue_cancel",
        entityType: "generated_post",
        status: "success",
        message: `Cancelled ${cancelledIds.length} unsent social posts`,
        details: { postIds: cancelledIds },
      });
    }
    return { cancelled: cancelledIds.length, cancelledIds, skipped: skippedIds.length, skippedIds };
  });
}
