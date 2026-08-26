import { describe, it, expect } from "vitest";
import {
  deleteActionForTask,
  enforceGeneratedTaskReviewOnCreate,
  hasGeneratedTaskProvenance,
  isAllowedStatusTransition,
  isInReviewState,
} from "./marketing-task-review-policy";

describe("isInReviewState", () => {
  it("only AI tasks in suggested/dismissed are in review", () => {
    expect(isInReviewState({ aiGenerated: true, status: "suggested" })).toBe(true);
    expect(isInReviewState({ aiGenerated: true, status: "dismissed" })).toBe(true);
    expect(isInReviewState({ aiGenerated: true, status: "accepted" })).toBe(false);
    expect(isInReviewState({ aiGenerated: false, status: "suggested" })).toBe(false);
  });
});

describe("isAllowedStatusTransition", () => {
  it("blocks suggested AI task from jumping to lifecycle statuses", () => {
    const task = { aiGenerated: true, status: "suggested" };
    expect(isAllowedStatusTransition(task, "planned")).toBe(false);
    expect(isAllowedStatusTransition(task, "in_progress")).toBe(false);
    expect(isAllowedStatusTransition(task, "completed")).toBe(false);
    expect(isAllowedStatusTransition(task, "accepted")).toBe(true);
    expect(isAllowedStatusTransition(task, "dismissed")).toBe(true);
  });

  it("dismissed AI task can only be re-suggested or accepted", () => {
    const task = { aiGenerated: true, status: "dismissed" };
    expect(isAllowedStatusTransition(task, "suggested")).toBe(true);
    expect(isAllowedStatusTransition(task, "accepted")).toBe(true);
    expect(isAllowedStatusTransition(task, "in_progress")).toBe(false);
  });

  it("accepted AI tasks and human tasks move freely", () => {
    expect(isAllowedStatusTransition({ aiGenerated: true, status: "accepted" }, "in_progress")).toBe(true);
    expect(isAllowedStatusTransition({ aiGenerated: false, status: "planned" }, "completed")).toBe(true);
  });
});

describe("deleteActionForTask", () => {
  it("API delete of an AI review-state task becomes a dismissal (dedup history preserved)", () => {
    expect(deleteActionForTask({ aiGenerated: true, status: "suggested" })).toBe("dismiss");
    expect(deleteActionForTask({ aiGenerated: true, status: "dismissed" })).toBe("dismiss");
  });
  it("human or accepted tasks are hard-deleted as before", () => {
    expect(deleteActionForTask({ aiGenerated: false, status: "planned" })).toBe("delete");
    expect(deleteActionForTask({ aiGenerated: true, status: "accepted" })).toBe("delete");
  });
});

describe("generated task creation policy", () => {
  it("recognizes every server-supported source of generated task provenance", () => {
    expect(hasGeneratedTaskProvenance({ aiGenerated: true })).toBe(true);
    expect(hasGeneratedTaskProvenance({ sourceRecommendationId: "rec-1" })).toBe(true);
    expect(hasGeneratedTaskProvenance({ sourceGenerationId: "run-1" })).toBe(true);
    expect(hasGeneratedTaskProvenance({ sourceGenerationLabel: "Market report" })).toBe(true);
    expect(hasGeneratedTaskProvenance({ sourceBriefId: "brief-1" })).toBe(true);
    expect(hasGeneratedTaskProvenance({ aiGenerated: false })).toBe(false);
  });

  it("forces misclassified report output back into unapproved review state", () => {
    const normalized = enforceGeneratedTaskReviewOnCreate({
      aiGenerated: false,
      sourceRecommendationId: "rec-1",
      status: "planned",
      acceptedAt: new Date("2026-08-25T00:00:00Z"),
      plannerTaskId: "planner-1",
      plannerEtag: "etag-1",
      plannerLastSyncedAt: new Date("2026-08-25T00:00:00Z"),
    });

    expect(normalized).toMatchObject({
      aiGenerated: true,
      status: "suggested",
      acceptedAt: null,
      plannerTaskId: null,
      plannerEtag: null,
      plannerLastSyncedAt: null,
    });
  });

  it("does not alter a genuinely manual task", () => {
    const manual = {
      aiGenerated: false,
      status: "planned",
      acceptedAt: null,
      title: "Call the venue",
    };
    expect(enforceGeneratedTaskReviewOnCreate(manual)).toEqual(manual);
  });
});
