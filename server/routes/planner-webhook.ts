/**
 * Microsoft Graph change-notification webhook receiver — public route used
 * by Microsoft Graph to deliver Planner change notifications. Must be
 * registered BEFORE the auth middleware so Microsoft's unauthenticated POSTs
 * are accepted.
 *
 * Two responsibilities:
 *   1. Validation handshake — when Microsoft creates a subscription, it
 *      issues a GET with `?validationToken=...`; we must echo the token
 *      verbatim within 10 seconds (text/plain, 200 OK).
 *   2. Change notifications — POSTed JSON envelopes describing which
 *      resources changed. We verify each notification's `clientState`
 *      against our stored subscription and enqueue an idempotent reconcile
 *      job in the shared job queue (keyed by `${subscriptionId}:${taskId}`)
 *      so duplicate Graph deliveries don't fan out to duplicate work.
 *
 * See: https://learn.microsoft.com/en-us/graph/webhooks
 */

import type { Express } from "express";
import { db } from "../db";
import { plannerSubscriptions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { pullAndReconcileTask } from "../services/planner-service";
import { enqueue } from "../services/job-queue";

interface GraphNotification {
  subscriptionId: string;
  clientState?: string;
  changeType: string;
  resource: string;
  resourceData?: { id?: string; "@odata.id"?: string; "@odata.type"?: string };
  tenantId?: string;
  subscriptionExpirationDateTime?: string;
}

function extractTaskId(resource: string, resourceData?: GraphNotification["resourceData"]): string | null {
  if (resourceData?.id) return resourceData.id;
  // resource format: planner/tasks/{id} or /planner/tasks/{id}
  const match = resource.match(/planner\/tasks\/([^/?#]+)/i);
  return match ? match[1] : null;
}

/**
 * In-flight dedup map keyed by `${subscriptionId}:${taskId}`. Graph can
 * fan out duplicate deliveries; this collapses them so we only enqueue
 * one reconcile per task within the dedup window.
 */
const inflight = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

function shouldEnqueue(key: string): boolean {
  const now = Date.now();
  // Sweep stale entries opportunistically.
  inflight.forEach((ts, k) => {
    if (now - ts > DEDUP_WINDOW_MS) inflight.delete(k);
  });
  if (inflight.has(key)) return false;
  inflight.set(key, now);
  return true;
}

export function registerPlannerWebhookPublicRoutes(app: Express) {
  app.post("/api/webhooks/graph-planner", async (req, res) => {
    // ─── Validation handshake ─────────────────────────────────────────
    const validationToken = (req.query.validationToken as string | undefined) ?? undefined;
    if (validationToken) {
      res.status(200).type("text/plain").send(validationToken);
      return;
    }

    // ─── Notification batch ──────────────────────────────────────────
    const body = req.body ?? {};
    const notifications: GraphNotification[] = Array.isArray(body.value) ? body.value : [];
    // Acknowledge promptly so Microsoft doesn't retry; reconcile is async.
    res.status(202).end();

    if (notifications.length === 0) return;

    // Group by subscriptionId to validate clientState once per group
    const subIdToValid = new Map<string, boolean>();

    for (const note of notifications) {
      try {
        if (!note.subscriptionId) continue;
        let valid = subIdToValid.get(note.subscriptionId);
        if (valid === undefined) {
          const [sub] = await db.select().from(plannerSubscriptions)
            .where(eq(plannerSubscriptions.subscriptionId, note.subscriptionId));
          valid = !!sub && sub.clientState === note.clientState;
          if (!valid) {
            console.warn(
              `[Planner Webhook] Rejected notification — clientState mismatch or unknown subscription ${note.subscriptionId}`,
            );
          }
          subIdToValid.set(note.subscriptionId, valid);
        }
        if (!valid) continue;

        const taskId = extractTaskId(note.resource, note.resourceData);
        if (!taskId) {
          console.warn(`[Planner Webhook] Could not extract task id from resource: ${note.resource}`);
          continue;
        }

        const dedupKey = `${note.subscriptionId}:${taskId}`;
        if (!shouldEnqueue(dedupKey)) {
          continue;
        }

        // Idempotent reconcile job in the shared job queue. Errors are
        // swallowed inside pullAndReconcileTask via sync log writes.
        enqueue(
          "monitor",
          `planner-webhook:${taskId}`,
          async () => {
            try {
              await pullAndReconcileTask(taskId);
            } finally {
              inflight.delete(dedupKey);
            }
          },
          { timeoutMs: 60_000, maxRetries: 1 },
        ).catch((err) => {
          console.error(`[Planner Webhook] Reconcile job failed for task ${taskId}:`, err.message);
          inflight.delete(dedupKey);
        });
      } catch (err: any) {
        console.error("[Planner Webhook] Notification handling error:", err.message);
      }
    }
  });
}
