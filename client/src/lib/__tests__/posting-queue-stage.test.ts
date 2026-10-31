import { describe, expect, it } from "vitest";
import { postingQueueStage } from "../posting-queue-stage";

const post = { status: "approved", deliveryMode: null, publishedAt: null, scheduledDate: "2027-01-01", publishError: null };
describe("posting queue delivery ownership", () => {
  it("shows approved native posts as scheduled", () => {
    expect(postingQueueStage(post)).toBe("scheduled");
  });
  it.each(["approved", "draft", "missed", "publish_failed"])("keeps CSV-only %s posts out of automatic pending work", status => {
    expect(postingQueueStage({ ...post, status, deliveryMode: "csv", publishError: "old error" })).toBe("awaiting_export");
  });
  it.each(["exported", "scheduled_external"])("marks %s as delivered rather than merely CSV-only", status => {
    expect(postingQueueStage({ ...post, status, deliveryMode: "csv", publishError: "old error" })).toBe("exported");
  });
  it("keeps actual publication above old CSV/error markers", () => {
    expect(postingQueueStage({ ...post, publishedAt: "2026-10-01", deliveryMode: "csv", publishError: "old error" })).toBe("posted");
  });
  it.each(["deleted", "rejected", "archived"])("hides %s even with stale delivery/error flags", status => {
    expect(postingQueueStage({ ...post, status, deliveryMode: "csv", publishError: "old error" })).toBeNull();
  });
});
