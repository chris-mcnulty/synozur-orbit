export type PostingQueueStage = "scheduled" | "failed" | "posted" | "exported" | "awaiting_export" | "missed";

export function postingQueueStage(p: {
  status: string; publishedAt: string | null; scheduledDate: string | null;
  deliveryMode: string | null; publishError: string | null;
}): PostingQueueStage | null {
  if (["deleted", "rejected", "archived"].includes(p.status)) return null;
  if (p.publishedAt || ["published", "posted"].includes(p.status)) return "posted";
  if (["exported", "scheduled_external"].includes(p.status)) return "exported";
  // CSV ownership takes precedence over stale error/missed markers. These
  // posts are not automatic work, and downloading is not external delivery.
  if (p.deliveryMode === "csv") return "awaiting_export";
  if (p.status === "missed") return "missed";
  if (p.status === "publish_failed" || p.publishError) return "failed";
  if (p.status === "approved" && p.scheduledDate) return "scheduled";
  return null;
}
