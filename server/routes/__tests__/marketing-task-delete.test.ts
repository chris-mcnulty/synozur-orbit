/**
 * Route-level tests for the marketing task DELETE endpoint's permanent-delete
 * behaviour introduced in task #768.
 *
 * Invariants under test:
 * 1. A SUGGESTED AI task is always soft-dismissed (status → dismissed),
 *    even when ?permanent=true is passed.
 * 2. A DISMISSED AI task is hard-deleted when ?permanent=true is passed.
 * 3. A DISMISSED AI task is soft-dismissed (no-op) when ?permanent is absent.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── Storage mock ──────────────────────────────────────────────────────────────

const storageMock = vi.hoisted(() => ({
  getMarketingPlan: vi.fn(),
  getMarketingTasks: vi.fn(),
  updateMarketingTask: vi.fn(),
  deleteMarketingTask: vi.fn(),
  // Unused by this route but imported via the storage module
  getUser: vi.fn(),
  getTenantByDomain: vi.fn(),
}));

vi.mock("../../storage", () => ({ storage: storageMock }));

// ── Minimal DB mock (analytics-data.ts doesn't use db directly but other ──────
// ── modules it transitively loads do) ────────────────────────────────────────

vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
}));

// ── Context mock ──────────────────────────────────────────────────────────────

vi.mock("../../context", () => ({
  getRequestContext: vi.fn().mockResolvedValue({
    tenantDomain: "acme.test",
    marketId: null,
    userId: "user-1",
  }),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(msg: string, status = 403) {
      super(msg);
      this.status = status;
    }
  },
}));

// ── Route helpers mock ────────────────────────────────────────────────────────

vi.mock("../../routes/helpers", () => ({
  guardFeature: vi.fn().mockResolvedValue(true),
  guardManualAction: vi.fn().mockResolvedValue(true),
  toContextFilter: vi.fn().mockReturnValue({}),
  validateResourceContext: vi.fn().mockReturnValue(true),
  hasAdminAccess: vi.fn().mockReturnValue(true),
  hasContentAccess: vi.fn().mockReturnValue(true),
  logAiUsage: vi.fn().mockResolvedValue(undefined),
}));

// ── Heavy service mocks (imported at module level in analytics-data.ts) ───────

vi.mock("../../services/news-monitoring", () => ({
  monitorCompetitorNews: vi.fn(),
  monitorMultipleCompetitorsNews: vi.fn(),
}));

vi.mock("../../services/marketing-task-dedup", () => ({
  filterDuplicateTasks: vi.fn().mockImplementation((_, tasks) => tasks),
}));

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

// ── App setup ─────────────────────────────────────────────────────────────────

import { registerAnalyticsDataRoutes } from "../analytics-data";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerAnalyticsDataRoutes(app);
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLAN = { id: "plan-1", tenantDomain: "acme.test" };

const suggestedTask = {
  id: "task-suggested",
  planId: "plan-1",
  aiGenerated: true,
  status: "suggested",
};

const dismissedTask = {
  id: "task-dismissed",
  planId: "plan-1",
  aiGenerated: true,
  status: "dismissed",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /api/marketing-plans/:planId/tasks/:taskId", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    storageMock.getMarketingPlan.mockResolvedValue(PLAN);
    storageMock.updateMarketingTask.mockResolvedValue({ ...dismissedTask, status: "dismissed" });
    storageMock.deleteMarketingTask.mockResolvedValue(true);
  });

  describe("suggested AI task", () => {
    beforeEach(() => {
      storageMock.getMarketingTasks.mockResolvedValue([suggestedTask]);
    });

    it("soft-dismisses (dedup history preserved) without ?permanent", async () => {
      const res = await request(app)
        .delete(`/api/marketing-plans/plan-1/tasks/task-suggested`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true, dismissed: true });
      expect(storageMock.updateMarketingTask).toHaveBeenCalledWith(
        "task-suggested",
        "plan-1",
        expect.objectContaining({ status: "dismissed" }),
        expect.anything(),
      );
      expect(storageMock.deleteMarketingTask).not.toHaveBeenCalled();
    });

    it("still soft-dismisses even when ?permanent=true (dedup invariant)", async () => {
      const res = await request(app)
        .delete(`/api/marketing-plans/plan-1/tasks/task-suggested?permanent=true`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true, dismissed: true });
      expect(storageMock.updateMarketingTask).toHaveBeenCalledWith(
        "task-suggested",
        "plan-1",
        expect.objectContaining({ status: "dismissed" }),
        expect.anything(),
      );
      // Hard delete must NOT be called for a suggested task
      expect(storageMock.deleteMarketingTask).not.toHaveBeenCalled();
    });
  });

  describe("dismissed AI task", () => {
    beforeEach(() => {
      storageMock.getMarketingTasks.mockResolvedValue([dismissedTask]);
    });

    it("soft-dismisses (no-op) without ?permanent", async () => {
      const res = await request(app)
        .delete(`/api/marketing-plans/plan-1/tasks/task-dismissed`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true, dismissed: true });
      expect(storageMock.updateMarketingTask).toHaveBeenCalled();
      expect(storageMock.deleteMarketingTask).not.toHaveBeenCalled();
    });

    it("hard-deletes when ?permanent=true", async () => {
      const res = await request(app)
        .delete(`/api/marketing-plans/plan-1/tasks/task-dismissed?permanent=true`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(storageMock.deleteMarketingTask).toHaveBeenCalledWith(
        "task-dismissed",
        "plan-1",
        expect.anything(),
      );
      // Should NOT call updateMarketingTask for the hard-delete path
      expect(storageMock.updateMarketingTask).not.toHaveBeenCalled();
    });
  });
});
