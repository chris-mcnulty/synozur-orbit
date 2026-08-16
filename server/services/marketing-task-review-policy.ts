/**
 * Server-enforced review-state policy for AI-suggested marketing tasks.
 *
 * Invariants:
 * - An AI task in a review state (suggested / dismissed) can only move
 *   between review states or to "accepted" — never straight to a lifecycle
 *   status, which would make it Planner-sync eligible without acceptance.
 * - AI tasks in a review state are never hard-deleted via the API: deleting
 *   a suggestion means dismissing it, so it persists as dedup history.
 */

export interface ReviewableTask {
  aiGenerated: boolean;
  status: string;
}

export const REVIEW_STATES = new Set(["suggested", "dismissed"]);
export const REVIEW_TRANSITIONS = new Set(["suggested", "accepted", "dismissed"]);

export function isInReviewState(task: ReviewableTask): boolean {
  return task.aiGenerated && REVIEW_STATES.has(task.status);
}

/** Whether a status change on the persisted task is allowed. */
export function isAllowedStatusTransition(task: ReviewableTask, nextStatus: string): boolean {
  if (nextStatus === task.status) return true;
  if (!isInReviewState(task)) return true;
  return REVIEW_TRANSITIONS.has(nextStatus);
}

/**
 * What an API delete request should do to this task:
 * - "dismiss": AI task in a review state — soft-delete by dismissing so it
 *   remains dedup history.
 * - "delete": human-created or accepted task — normal hard delete.
 */
export function deleteActionForTask(task: ReviewableTask): "dismiss" | "delete" {
  return isInReviewState(task) ? "dismiss" : "delete";
}
