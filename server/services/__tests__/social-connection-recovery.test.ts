import { describe, expect, it } from "vitest";
import {
  canRestoreFromReplacement,
  isRecoverablePreviousConnectionStatus,
  isRecoverablePostStatus,
  linkedinIdentityMatches,
  mergedAutoPublish,
} from "../social-connection-recovery";

describe("social connection recovery guards", () => {
  it("recognizes the same LinkedIn account by its stable provider identity", () => {
    expect(linkedinIdentityMatches(
      { accountId: "urn:li:organization:123", authorUrn: "urn:li:organization:123" } as any,
      { accountId: "urn:li:organization:123", authorUrn: "urn:li:organization:123" },
    )).toBe(true);
  });

  it("does not treat different LinkedIn accounts as a safe automatic match", () => {
    expect(linkedinIdentityMatches(
      { accountId: "urn:li:organization:old", authorUrn: "urn:li:organization:old" } as any,
      { accountId: "urn:li:organization:new", authorUrn: "urn:li:organization:new" },
    )).toBe(false);
  });

  it("keeps campaign auto-publish enabled when either connection was enabled", () => {
    expect(mergedAutoPublish(false, true)).toBe(true);
    expect(mergedAutoPublish(true, false)).toBe(true);
    expect(mergedAutoPublish(false, false)).toBe(false);
  });

  it("can recover inactive or reconnect-required history, but only from a verified active replacement", () => {
    expect(isRecoverablePreviousConnectionStatus("inactive")).toBe(true);
    expect(isRecoverablePreviousConnectionStatus("needs_reconnect")).toBe(true);
    expect(canRestoreFromReplacement({ status: "active", encryptedAccessToken: "encrypted-token" } as any)).toBe(true);
    expect(canRestoreFromReplacement({ status: "needs_reconnect", encryptedAccessToken: "rejected-token" } as any)).toBe(false);
    expect(canRestoreFromReplacement({ status: "active", encryptedAccessToken: null } as any)).toBe(false);
  });

  it("moves only pending work and preserves published history", () => {
    expect(isRecoverablePostStatus("draft")).toBe(true);
    expect(isRecoverablePostStatus("approved")).toBe(true);
    expect(isRecoverablePostStatus("publish_failed")).toBe(true);
    expect(isRecoverablePostStatus("published")).toBe(false);
    expect(isRecoverablePostStatus("exported")).toBe(false);
  });
});