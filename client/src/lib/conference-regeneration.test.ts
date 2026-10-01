import { describe, expect, it } from "vitest";
import { rejectedBatchAccountIds } from "./conference-regeneration";

describe("rejected event batch recovery", () => {
  it("recovers and deduplicates accounts from rejected posts", () => {
    expect(rejectedBatchAccountIds([
      { status: "rejected", socialAccountId: "a" },
      { status: "rejected", socialAccountId: "a" },
      { status: "rejected", socialAccountId: "b" },
      { status: "approved", socialAccountId: "c" },
    ], [{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual(["a", "b"]);
  });

  it("never recovers disconnected or other-market accounts", () => {
    expect(rejectedBatchAccountIds([
      { status: "rejected", socialAccountId: "other-market" },
      { status: "rejected", socialAccountId: null },
    ], [{ id: "current-market" }])).toEqual([]);
  });

  it("has no recovery targets without rejected posts", () => {
    expect(rejectedBatchAccountIds([{ status: "posted", socialAccountId: "a" }], [{ id: "a" }])).toEqual([]);
  });
});