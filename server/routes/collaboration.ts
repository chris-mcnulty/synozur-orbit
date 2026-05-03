/**
 * Collaboration routes — Task #103
 *
 * Threaded comments, @mentions, shared annotations, and action item
 * assignments. All routes are tenant + market scoped via getRequestContext.
 * Plan-gated by the `collaboration` feature key. Consultant role is read-only.
 */
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { getRequestContext, ContextError, type RequestContext } from "../context";
import { guardFeature } from "./helpers";
import {
  collaborationThreads,
  collaborationComments,
  annotations,
  recommendations,
  featureRecommendations,
  users,
  COLLAB_TARGET_KINDS,
  type CollabTargetKind,
  notifications as notificationsTable,
} from "@shared/schema";
import { and, eq, desc, gte, inArray, isNull, sql, or } from "drizzle-orm";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { notifications } from "../services/notifications";

const targetKindSchema = z.enum(COLLAB_TARGET_KINDS as unknown as [CollabTargetKind, ...CollabTargetKind[]]);

function isReadOnly(ctx: RequestContext): boolean {
  return ctx.userRole === "Consultant";
}

function denyReadOnly(ctx: RequestContext, res: Response): boolean {
  if (isReadOnly(ctx)) {
    res.status(403).json({ error: "Read-only role cannot perform this action" });
    return true;
  }
  return false;
}

async function findOrCreateThread(
  ctx: RequestContext,
  targetKind: string,
  targetId: string,
  createdBy: string,
) {
  const [existing] = await db
    .select()
    .from(collaborationThreads)
    .where(
      and(
        eq(collaborationThreads.tenantDomain, ctx.tenantDomain),
        eq(collaborationThreads.targetKind, targetKind),
        eq(collaborationThreads.targetId, targetId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(collaborationThreads)
    .values({
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      targetKind,
      targetId,
      createdBy,
    })
    .returning();
  return created;
}

function targetLink(kind: string, id: string): string {
  switch (kind) {
    case "battlecard":
    case "product_battlecard":
      return `/app/battlecards`;
    case "briefing":
      return `/app/intelligence`;
    case "gtm_plan":
      return `/app/gtm-plan`;
    case "messaging_framework":
      return `/app/messaging-framework`;
    case "competitor":
      return `/app/competitors/${id}`;
    case "recommendation":
    case "feature_recommendation":
    case "gap":
      return `/app/action-items`;
    default:
      return `/app/activity`;
  }
}

function targetLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

async function dispatchMentions(
  ctx: RequestContext,
  authorId: string,
  mentions: string[],
  body: string,
  kind: string,
  id: string,
) {
  if (!mentions.length) return;
  const author = await storage.getUser(authorId);
  const authorName = author?.name || author?.email || "A teammate";
  const link = targetLink(kind, id);
  const label = targetLabel(kind);
  // Validate mentioned users belong to same tenant.
  const tenantUsers = await storage.getUsersByDomain(ctx.tenantDomain);
  const validIds = new Set(tenantUsers.map((u) => u.id));
  await Promise.allSettled(
    mentions
      .filter((mid) => validIds.has(mid) && mid !== authorId)
      .map((mid) =>
        notifications.dispatch(ctx.tenantDomain, "comment_mention", {
          recipientUserId: mid,
          authorUserId: authorId,
          authorName,
          targetLabel: label,
          excerpt: body,
          link,
        }),
      ),
  );
}

export function registerCollaborationRoutes(app: Express) {
  // ============== THREADS / COMMENTS ==============

  // GET /api/collab/threads/:targetKind/:targetId
  // Returns thread (creating one lazily if needed) plus its comments.
  app.get("/api/collab/threads/:targetKind/:targetId", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      const kind = targetKindSchema.parse(req.params.targetKind);
      const targetId = req.params.targetId;

      const thread = await findOrCreateThread(ctx, kind, targetId, ctx.userId);

      const rows = await db
        .select({
          comment: collaborationComments,
          authorName: users.name,
          authorEmail: users.email,
        })
        .from(collaborationComments)
        .leftJoin(users, eq(users.id, collaborationComments.authorUserId))
        .where(
          and(
            eq(collaborationComments.threadId, thread.id),
            isNull(collaborationComments.deletedAt),
          ),
        )
        .orderBy(collaborationComments.createdAt);

      res.json({
        thread,
        comments: rows.map((r) => ({
          ...r.comment,
          authorName: r.authorName,
          authorEmail: r.authorEmail,
        })),
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromError(err).toString() });
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  const createCommentSchema = z.object({
    body: z.string().min(1).max(10_000),
    mentions: z.array(z.string()).default([]),
  });

  // POST /api/collab/threads/:targetKind/:targetId/comments
  app.post(
    "/api/collab/threads/:targetKind/:targetId/comments",
    async (req: Request, res: Response) => {
      try {
        if (!(await guardFeature(req, res, "collaboration"))) return;
        const ctx = await getRequestContext(req);
        if (denyReadOnly(ctx, res)) return;
        const kind = targetKindSchema.parse(req.params.targetKind);
        const targetId = req.params.targetId;
        const data = createCommentSchema.parse(req.body);

        const thread = await findOrCreateThread(ctx, kind, targetId, ctx.userId);

        const [comment] = await db
          .insert(collaborationComments)
          .values({
            threadId: thread.id,
            tenantDomain: ctx.tenantDomain,
            authorUserId: ctx.userId,
            body: data.body,
            mentions: data.mentions,
          })
          .returning();

        await dispatchMentions(ctx, ctx.userId, data.mentions, data.body, kind, targetId);

        res.json({ comment });
      } catch (err: any) {
        if (err instanceof z.ZodError)
          return res.status(400).json({ error: fromError(err).toString() });
        if (err instanceof ContextError)
          return res.status(err.status).json({ error: err.message });
        res.status(500).json({ error: err.message });
      }
    },
  );

  const updateCommentSchema = z.object({
    body: z.string().min(1).max(10_000),
    mentions: z.array(z.string()).default([]),
  });

  // PATCH /api/collab/comments/:id
  app.patch("/api/collab/comments/:id", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const data = updateCommentSchema.parse(req.body);
      const [existing] = await db
        .select()
        .from(collaborationComments)
        .where(eq(collaborationComments.id, req.params.id))
        .limit(1);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Comment not found" });
      }
      if (existing.authorUserId !== ctx.userId) {
        return res.status(403).json({ error: "Cannot edit another user's comment" });
      }
      const [updated] = await db
        .update(collaborationComments)
        .set({ body: data.body, mentions: data.mentions, editedAt: new Date() })
        .where(eq(collaborationComments.id, req.params.id))
        .returning();
      res.json({ comment: updated });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromError(err).toString() });
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/collab/comments/:id (soft delete)
  app.delete("/api/collab/comments/:id", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const [existing] = await db
        .select()
        .from(collaborationComments)
        .where(eq(collaborationComments.id, req.params.id))
        .limit(1);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Comment not found" });
      }
      const isAdmin = ctx.userRole === "Global Admin" || ctx.userRole === "Domain Admin";
      if (existing.authorUserId !== ctx.userId && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await db
        .update(collaborationComments)
        .set({ deletedAt: new Date() })
        .where(eq(collaborationComments.id, req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ============== ANNOTATIONS ==============

  const createAnnotationSchema = z.object({
    targetKind: targetKindSchema,
    targetId: z.string().min(1),
    fieldPath: z.string().optional().nullable(),
    rangeStart: z.number().int().nullable().optional(),
    rangeEnd: z.number().int().nullable().optional(),
    selectedText: z.string().max(2000).nullable().optional(),
    body: z.string().min(1).max(10_000),
    mentions: z.array(z.string()).default([]),
  });

  // POST /api/collab/annotations
  app.post("/api/collab/annotations", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const data = createAnnotationSchema.parse(req.body);

      // Create the thread first with a placeholder targetId, then update it
      // to use the annotation's own id once we have one. This way the
      // annotation rail can find the thread by ("annotation", annotation.id).
      const [tempThread] = await db
        .insert(collaborationThreads)
        .values({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          targetKind: "annotation",
          targetId: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          createdBy: ctx.userId,
        })
        .returning();

      const [annotation] = await db
        .insert(annotations)
        .values({
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          targetKind: data.targetKind,
          targetId: data.targetId,
          fieldPath: data.fieldPath ?? null,
          rangeStart: data.rangeStart ?? null,
          rangeEnd: data.rangeEnd ?? null,
          selectedText: data.selectedText ?? null,
          threadId: tempThread.id,
          createdByUserId: ctx.userId,
        })
        .returning();

      const [thread] = await db
        .update(collaborationThreads)
        .set({ targetId: annotation.id })
        .where(eq(collaborationThreads.id, tempThread.id))
        .returning();

      const [comment] = await db
        .insert(collaborationComments)
        .values({
          threadId: thread.id,
          tenantDomain: ctx.tenantDomain,
          authorUserId: ctx.userId,
          body: data.body,
          mentions: data.mentions,
        })
        .returning();

      await dispatchMentions(ctx, ctx.userId, data.mentions, data.body, data.targetKind, data.targetId);

      res.json({ annotation, comment });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromError(err).toString() });
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/collab/annotations/:targetKind/:targetId
  app.get("/api/collab/annotations/:targetKind/:targetId", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      const kind = targetKindSchema.parse(req.params.targetKind);
      const rows = await db
        .select()
        .from(annotations)
        .where(
          and(
            eq(annotations.tenantDomain, ctx.tenantDomain),
            eq(annotations.targetKind, kind),
            eq(annotations.targetId, req.params.targetId),
          ),
        )
        .orderBy(desc(annotations.createdAt));
      res.json({ annotations: rows });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromError(err).toString() });
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/collab/annotations/:id (resolve/unresolve)
  app.patch("/api/collab/annotations/:id", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const resolved = !!req.body?.resolved;
      const [existing] = await db
        .select()
        .from(annotations)
        .where(eq(annotations.id, req.params.id))
        .limit(1);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Annotation not found" });
      }
      const [updated] = await db
        .update(annotations)
        .set({
          resolvedAt: resolved ? new Date() : null,
          resolvedByUserId: resolved ? ctx.userId : null,
        })
        .where(eq(annotations.id, req.params.id))
        .returning();
      res.json({ annotation: updated });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/collab/annotations/:id
  app.delete("/api/collab/annotations/:id", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const [existing] = await db
        .select()
        .from(annotations)
        .where(eq(annotations.id, req.params.id))
        .limit(1);
      if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
        return res.status(404).json({ error: "Annotation not found" });
      }
      const isAdmin = ctx.userRole === "Global Admin" || ctx.userRole === "Domain Admin";
      if (existing.createdByUserId !== ctx.userId && !isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await db.delete(annotations).where(eq(annotations.id, req.params.id));
      // The thread + its comments cascade-delete via the FK on threadId.
      await db.delete(collaborationThreads).where(eq(collaborationThreads.id, existing.threadId));
      res.json({ ok: true });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ============== ACTION ITEM ASSIGNMENTS ==============

  const assignmentSchema = z.object({
    assignedToUserId: z.string().nullable(),
  });

  const ASSIGNABLE_KINDS = ["recommendation", "feature_recommendation"] as const;
  type AssignableKind = (typeof ASSIGNABLE_KINDS)[number];

  // PATCH /api/collab/action-items/:kind/:id { assignedToUserId }
  app.patch("/api/collab/action-items/:kind/:id", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      if (denyReadOnly(ctx, res)) return;
      const kind = req.params.kind as AssignableKind;
      if (!ASSIGNABLE_KINDS.includes(kind)) {
        return res.status(400).json({ error: "Unsupported action item kind" });
      }
      const data = assignmentSchema.parse(req.body);

      // Verify assignee belongs to this tenant if not null
      if (data.assignedToUserId) {
        const tenantUsers = await storage.getUsersByDomain(ctx.tenantDomain);
        if (!tenantUsers.find((u) => u.id === data.assignedToUserId)) {
          return res.status(400).json({ error: "Assignee is not in this tenant" });
        }
      }

      let title = "";
      let updatedRow: any = null;
      if (kind === "recommendation") {
        const [existing] = await db
          .select()
          .from(recommendations)
          .where(eq(recommendations.id, req.params.id))
          .limit(1);
        if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
          return res.status(404).json({ error: "Recommendation not found" });
        }
        const [u] = await db
          .update(recommendations)
          .set({ assignedTo: data.assignedToUserId })
          .where(eq(recommendations.id, req.params.id))
          .returning();
        updatedRow = u;
        title = u?.title || "Recommendation";
      } else if (kind === "feature_recommendation") {
        const [existing] = await db
          .select()
          .from(featureRecommendations)
          .where(eq(featureRecommendations.id, req.params.id))
          .limit(1);
        if (!existing || existing.tenantDomain !== ctx.tenantDomain) {
          return res.status(404).json({ error: "Feature recommendation not found" });
        }
        const [u] = await db
          .update(featureRecommendations)
          .set({ assignedToUserId: data.assignedToUserId })
          .where(eq(featureRecommendations.id, req.params.id))
          .returning();
        updatedRow = u;
        title = u?.title || "Feature recommendation";
      }

      // Notify assignee through the central dispatcher (in-app + email + webhooks)
      if (data.assignedToUserId && data.assignedToUserId !== ctx.userId) {
        const assigner = await storage.getUser(ctx.userId);
        await notifications.dispatch(ctx.tenantDomain, "action_item_assigned", {
          recipientUserId: data.assignedToUserId,
          assignerUserId: ctx.userId,
          assignerName: assigner?.name || assigner?.email || "A teammate",
          itemTitle: title,
          link: `/app/action-items?id=${req.params.id}`,
        });
      }

      res.json({ item: updatedRow });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: fromError(err).toString() });
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ============== ACTIVITY FEED (collaboration) ==============

  // GET /api/collab/activity?days=14
  // Returns recent mentions/assignments/annotations + comments for the tenant.
  app.get("/api/collab/activity", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      const days = Math.max(1, Math.min(60, parseInt(String(req.query.days || "14"), 10) || 14));
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);

      const [recentComments, recentAnnotations, assignmentNotifs] = await Promise.all([
        db
          .select({ comment: collaborationComments, thread: collaborationThreads, authorName: users.name })
          .from(collaborationComments)
          .leftJoin(collaborationThreads, eq(collaborationThreads.id, collaborationComments.threadId))
          .leftJoin(users, eq(users.id, collaborationComments.authorUserId))
          .where(
            and(
              eq(collaborationComments.tenantDomain, ctx.tenantDomain),
              gte(collaborationComments.createdAt, since),
              isNull(collaborationComments.deletedAt),
            ),
          )
          .orderBy(desc(collaborationComments.createdAt))
          .limit(200),
        db
          .select()
          .from(annotations)
          .where(
            and(
              eq(annotations.tenantDomain, ctx.tenantDomain),
              gte(annotations.createdAt, since),
            ),
          )
          .orderBy(desc(annotations.createdAt))
          .limit(100),
        // Pull assignment events from the notifications table — its createdAt is
        // when the assignment actually happened, unlike the source row's
        // createdAt which represents when the recommendation was created.
        db
          .select({
            id: notificationsTable.id,
            recipientUserId: notificationsTable.userId,
            recipientName: users.name,
            title: notificationsTable.title,
            message: notificationsTable.message,
            link: notificationsTable.link,
            createdAt: notificationsTable.createdAt,
          })
          .from(notificationsTable)
          .leftJoin(users, eq(users.id, notificationsTable.userId))
          .where(
            and(
              eq(notificationsTable.tenantDomain, ctx.tenantDomain),
              eq(notificationsTable.type, "action_item_assigned"),
              gte(notificationsTable.createdAt, since),
            ),
          )
          .orderBy(desc(notificationsTable.createdAt))
          .limit(100),
      ]);

      res.json({
        comments: recentComments.map((r) => ({
          id: r.comment.id,
          createdAt: r.comment.createdAt,
          body: r.comment.body,
          mentions: r.comment.mentions,
          authorName: r.authorName,
          targetKind: r.thread?.targetKind,
          targetId: r.thread?.targetId,
        })),
        annotations: recentAnnotations,
        assignments: assignmentNotifs,
      });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/collab/users — tenant users for @mention picker / assignment dropdown
  app.get("/api/collab/users", async (req: Request, res: Response) => {
    try {
      if (!(await guardFeature(req, res, "collaboration"))) return;
      const ctx = await getRequestContext(req);
      const u = await storage.getUsersByDomain(ctx.tenantDomain);
      res.json({
        users: u.map((x) => ({ id: x.id, name: x.name, email: x.email, role: x.role })),
      });
    } catch (err: any) {
      if (err instanceof ContextError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });
}
