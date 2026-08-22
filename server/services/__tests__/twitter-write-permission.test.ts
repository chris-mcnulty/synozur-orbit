import { describe, expect, it } from "vitest";
import {
  canPublishFromAccountStatus,
  nextPublishFailureAttemptCount,
} from "../marketing-publish-worker";
import { classifyTwitterCreateError } from "../social-publishers/twitter";

describe("X create-post permission recovery", () => {
  it("classifies the provider's generic 403 as a reconnect-required write permission error", () => {
    const result = classifyTwitterCreateError(403, {
      type: "about:blank",
      title: "Forbidden",
      detail: "You are not permitted to perform this action.",
      status: 403,
    }, "");

    expect(result?.errorCode).toBe("write_permission_missing");
    expect(result?.errorMessage).toContain("Read and Write");
    expect(result?.errorMessage).toContain("reconnect");
  });

  it("does not relabel unrelated X 403 responses", () => {
    expect(classifyTwitterCreateError(403, {
      title: "Forbidden",
      detail: "This project has reached its product limit.",
    }, "")).toBeNull();
  });

  it("does not consume automatic retry capacity while permission repair is required", () => {
    expect(nextPublishFailureAttemptCount(0, "write_permission_missing")).toBe(0);
    expect(nextPublishFailureAttemptCount(7, "write_permission_missing")).toBe(7);
    expect(nextPublishFailureAttemptCount(2, "http_503")).toBe(3);
  });

  it("allows manual publishing only through the active canonical connection", () => {
    expect(canPublishFromAccountStatus("active")).toBe(true);
    expect(canPublishFromAccountStatus("inactive")).toBe(false);
    expect(canPublishFromAccountStatus("needs_reconnect")).toBe(false);
    expect(canPublishFromAccountStatus("recovering")).toBe(false);
  });
});