/**
 * Notification Service
 *
 * Writes and reads persistent in-app notifications stored in the notifications
 * table.  Notifications are tenant-scoped and user-scoped.  Callers create
 * notifications by calling the typed helpers below; the API routes expose
 * list / mark-read / clear endpoints to the client.
 */

import { db } from "../db";
import { notifications, type Notification, type InsertNotification } from "../../shared/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Write helpers — called from routes and scheduled jobs
// ---------------------------------------------------------------------------

export type NotificationType =
  | "job_complete"
  | "job_failed"
  | "competitor_change"
  | "freshness_warning"
  | "trial";

export async function createNotification(data: InsertNotification): Promise<Notification> {
  const [row] = await db.insert(notifications).values(data).returning();
  return row;
}

/**
 * Notify a single user that a background job finished.
 * `link` is the deep-link path the user should be taken to (e.g. "/app/competitors/123").
 */
export async function notifyJobComplete(opts: {
  userId: string;
  tenantDomain: string;
  title: string;
  message: string;
  link?: string;
}): Promise<void> {
  try {
    await createNotification({
      userId: opts.userId,
      tenantDomain: opts.tenantDomain,
      type: "job_complete",
      title: opts.title,
      message: opts.message,
      link: opts.link || null,
      readAt: null,
    });
  } catch (err) {
    console.error("[NotificationService] Failed to create job_complete notification:", err);
  }
}

export async function notifyJobFailed(opts: {
  userId: string;
  tenantDomain: string;
  title: string;
  message: string;
  link?: string;
}): Promise<void> {
  try {
    await createNotification({
      userId: opts.userId,
      tenantDomain: opts.tenantDomain,
      type: "job_failed",
      title: opts.title,
      message: opts.message,
      link: opts.link || null,
      readAt: null,
    });
  } catch (err) {
    console.error("[NotificationService] Failed to create job_failed notification:", err);
  }
}

export async function notifyCompetitorChange(opts: {
  userId: string;
  tenantDomain: string;
  competitorName: string;
  summary: string;
  competitorId: string;
}): Promise<void> {
  try {
    await createNotification({
      userId: opts.userId,
      tenantDomain: opts.tenantDomain,
      type: "competitor_change",
      title: `${opts.competitorName} updated`,
      message: opts.summary,
      link: `/app/competitors/${opts.competitorId}`,
      readAt: null,
    });
  } catch (err) {
    console.error("[NotificationService] Failed to create competitor_change notification:", err);
  }
}

export async function notifyFreshnessWarning(opts: {
  userId: string;
  tenantDomain: string;
  message: string;
  link?: string;
}): Promise<void> {
  try {
    await createNotification({
      userId: opts.userId,
      tenantDomain: opts.tenantDomain,
      type: "freshness_warning",
      title: "Data freshness warning",
      message: opts.message,
      link: opts.link || "/app/refresh-center",
      readAt: null,
    });
  } catch (err) {
    console.error("[NotificationService] Failed to create freshness_warning notification:", err);
  }
}

// ---------------------------------------------------------------------------
// Read helpers — used by API routes
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;

export async function getNotificationsForUser(
  userId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {}
): Promise<Notification[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const query = db
    .select()
    .from(notifications)
    .where(
      opts.unreadOnly
        ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
        : eq(notifications.userId, userId)
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return query;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return result[0]?.count ?? 0;
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function deleteNotification(id: string, userId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function clearAllNotifications(userId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.userId, userId));
}
