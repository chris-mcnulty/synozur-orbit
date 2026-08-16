import { describe, it, expect } from "vitest";
import { isAllowedStatusTransition, deleteActionForTask, isInReviewState } from "./marketing-task-review-policy";

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
