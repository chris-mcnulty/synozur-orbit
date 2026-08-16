import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Regression tests for the AI-suggestion approval gate in Planner sync.
// A linked `suggested` AI task with Planner progress (>0% complete) must be
// retracted from Planner — never reconciled to in_progress/completed — in
// both the full-sync path and the webhook reconcile path.
// ---------------------------------------------------------------------------

const dbUpdateCalls: Array<{ set: Record<string, unknown> }> = [];

vi.mock("../db", () => {
  const db = {
    update: vi.fn(() => ({
      set: (setArg: Record<string, unknown>) => {
        const call = { set: setArg };
        dbUpdateCalls.push(call);
        return { where: vi.fn(async () => undefined) };
      },
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [mockState.orbitTask]),
      })),
    })),
    query: {
      marketingPlans: {
        findFirst: vi.fn(async () => mockState.plan),
      },
    },
  };
  return { db };
});

vi.mock("../storage", () => ({
  storage: {
    getMarketingPlan: vi.fn(async () => mockState.plan),
    updateMarketingPlan: vi.fn(async () => mockState.plan),
    getMarketingPlanBucketMappings: vi.fn(async () => []),
    getMarketingTasks: vi.fn(async () => [mockState.orbitTask]),
  },
}));

vi.mock("./planner-graph-client", () => ({
  getValidGraphToken: vi.fn(async () => "token"),
  listPlanTasks: vi.fn(async () => [mockState.plannerTask]),
  getTask: vi.fn(async () => mockState.plannerTask),
  createTask: vi.fn(async () => ({ id: "new", etag: "e" })),
  updateTask: vi.fn(async () => mockState.plannerTask),
  deleteTask: vi.fn(async () => undefined),
  buildAssignmentsPayload: vi.fn(() => null),
}));
import * as graphMocks from "./planner-graph-client";
vi.mock("./job-queue", () => ({
  enqueuePlannerSync: vi.fn(),
  getJobStatusByLabel: vi.fn(),
}));

const mockState: { plan: any; orbitTask: any; plannerTask: any } = {
  plan: null,
  orbitTask: null,
  plannerTask: null,
};

function makeState() {
  mockState.plan = {
    id: "plan-1",
    plannerSyncEnabled: true,
    plannerPlanId: "pp-1",
    plannerBucketId: "bucket-1",
    plannerConnectedBy: "user-1",
  };
  // Legacy-linked AI suggestion, never accepted:
  mockState.orbitTask = {
    id: "task-1",
    planId: "plan-1",
    title: "Suggested task",
    description: null,
    activityGroup: "other",
    priority: "Medium",
    status: "suggested",
    aiGenerated: true,
    acceptedAt: null,
    assignedTo: null,
    dueDate: null,
    plannerTaskId: "pt-1",
    plannerEtag: "etag-old",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  // Planner side shows progress — must NOT count as acceptance:
  mockState.plannerTask = {
    id: "pt-1",
    etag: "etag-new",
    title: "Suggested task",
    percentComplete: 50,
    priority: 5,
    dueDateTime: null,
    assignments: {},
    lastModifiedDateTime: "2026-06-01T00:00:00Z",
  };
}

import { syncMarketingPlanToPlanner, pullAndReconcileTask, isPlannerSyncEligible } from "./planner-service";

beforeEach(() => {
  makeState();
  dbUpdateCalls.length = 0;
  (graphMocks.getTask as any).mockReset().mockImplementation(async () => mockState.plannerTask);
  (graphMocks.listPlanTasks as any).mockReset().mockImplementation(async () => (mockState.plannerTask ? [mockState.plannerTask] : []));
  (graphMocks.deleteTask as any).mockClear();
  (graphMocks.createTask as any).mockClear();
  (graphMocks.updateTask as any).mockClear();
});

describe("isPlannerSyncEligible", () => {
  const accepted = new Date();
  it("blocks suggested and dismissed AI tasks, allows accepted and human tasks", () => {
    expect(isPlannerSyncEligible({ aiGenerated: true, status: "suggested", acceptedAt: null })).toBe(false);
    expect(isPlannerSyncEligible({ aiGenerated: true, status: "dismissed", acceptedAt: accepted })).toBe(false);
    expect(isPlannerSyncEligible({ aiGenerated: true, status: "accepted", acceptedAt: accepted })).toBe(true);
    expect(isPlannerSyncEligible({ aiGenerated: false, status: "suggested", acceptedAt: null })).toBe(true);
    expect(isPlannerSyncEligible({ aiGenerated: false, status: "dismissed", acceptedAt: null })).toBe(false);
  });

  it("AI lifecycle statuses without durable acceptance proof are NOT eligible", () => {
    for (const status of ["accepted", "planned", "in_progress", "completed"]) {
      expect(isPlannerSyncEligible({ aiGenerated: true, status, acceptedAt: null })).toBe(false);
      expect(isPlannerSyncEligible({ aiGenerated: true, status, acceptedAt: accepted })).toBe(true);
    }
  });
});

describe("full sync — linked suggested AI task with Planner progress", () => {
  it("retracts from Planner instead of reconciling status", async () => {
    await syncMarketingPlanToPlanner("plan-1", { tenantDomain: "t", marketId: null } as any);

    // Planner task must be deleted (retraction), not updated/created.
    expect(graphMocks.deleteTask).toHaveBeenCalledWith("token", "pt-1", "etag-new");
    expect(graphMocks.updateTask).not.toHaveBeenCalled();
    expect(graphMocks.createTask).not.toHaveBeenCalled();

    // No pull-phase status change: no db.update sets status to in_progress/completed.
    for (const call of dbUpdateCalls) {
      expect(call.set.status).not.toBe("in_progress");
      expect(call.set.status).not.toBe("completed");
    }
    // Linkage cleared.
    expect(dbUpdateCalls.some(c => c.set.plannerTaskId === null && c.set.plannerEtag === null)).toBe(true);
  });
});

describe("legacy linked AI task in a lifecycle state without acceptance proof", () => {
  for (const status of ["planned", "in_progress", "completed"]) {
    it(`full sync retracts a legacy '${status}' AI task lacking acceptedAt`, async () => {
      mockState.orbitTask.status = status;
      mockState.orbitTask.acceptedAt = null;

      await syncMarketingPlanToPlanner("plan-1", { tenantDomain: "t", marketId: null } as any);

      expect(graphMocks.deleteTask).toHaveBeenCalledWith("token", "pt-1", "etag-new");
      expect(graphMocks.updateTask).not.toHaveBeenCalled();
      expect(graphMocks.createTask).not.toHaveBeenCalled();
      expect(dbUpdateCalls.some(c => c.set.plannerTaskId === null && c.set.plannerEtag === null)).toBe(true);
    });

    it(`webhook reconcile retracts a legacy '${status}' AI task lacking acceptedAt`, async () => {
      mockState.orbitTask.status = status;
      mockState.orbitTask.acceptedAt = null;

      const res = await pullAndReconcileTask("pt-1");
      expect(res.matched).toBe(true);
      expect(graphMocks.deleteTask).toHaveBeenCalledWith("token", "pt-1", "etag-new");
      expect(dbUpdateCalls.some(c => c.set.plannerTaskId === null && c.set.plannerEtag === null)).toBe(true);
    });
  }

  it("an accepted AI task WITH acceptedAt still syncs normally", async () => {
    mockState.orbitTask.status = "in_progress";
    mockState.orbitTask.acceptedAt = new Date("2026-05-01T00:00:00Z");

    await syncMarketingPlanToPlanner("plan-1", { tenantDomain: "t", marketId: null } as any);

    expect(graphMocks.deleteTask).not.toHaveBeenCalled();
  });
});

describe("Planner-side deletion of a linked suggested AI task", () => {
  it("full sync marks it dismissed instead of leaving it acceptable", async () => {
    mockState.plannerTask = null; // deleted in Planner
    (graphMocks.listPlanTasks as any).mockResolvedValueOnce([]);
    (graphMocks.getTask as any).mockResolvedValue(null);

    await syncMarketingPlanToPlanner("plan-1", { tenantDomain: "t", marketId: null } as any);

    expect(graphMocks.createTask).not.toHaveBeenCalled();
    expect(dbUpdateCalls.some(c => c.set.status === "dismissed" && c.set.plannerTaskId === null)).toBe(true);
  });

  it("webhook reconcile marks it dismissed", async () => {
    (graphMocks.getTask as any).mockResolvedValue(null);

    const res = await pullAndReconcileTask("pt-1");
    expect(res.matched).toBe(true);
    expect(dbUpdateCalls.some(c => c.set.status === "dismissed" && c.set.plannerTaskId === null)).toBe(true);
  });
});

describe("webhook reconcile — linked suggested AI task with Planner progress", () => {
  it("retracts from Planner and keeps review status instead of pulling progress", async () => {
    const res = await pullAndReconcileTask("pt-1");
    expect(res.matched).toBe(true);

    expect(graphMocks.deleteTask).toHaveBeenCalledWith("token", "pt-1", "etag-new");
    for (const call of dbUpdateCalls) {
      expect(call.set.status).not.toBe("in_progress");
      expect(call.set.status).not.toBe("completed");
    }
    expect(dbUpdateCalls.some(c => c.set.plannerTaskId === null && c.set.plannerEtag === null)).toBe(true);
  });
});
