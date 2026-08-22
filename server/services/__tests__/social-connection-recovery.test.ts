import { describe, expect, it } from "vitest";
import {
  alignOAuthResultToExistingIdentity,
  canRestoreFromReplacement,
  chooseCanonicalSocialConnection,
  isRecoverablePreviousConnectionStatus,
  isRecoverablePostStatus,
  linkedinIdentityMatches,
  mergedAutoPublish,
  socialIdentityMatches,
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

  it("does not merge different LinkedIn pages that share an administrator account id", () => {
    expect(socialIdentityMatches(
      { accountId: "shared-admin", authorUrn: "urn:li:organization:page-a" } as any,
      { accountId: "shared-admin", authorUrn: "urn:li:organization:page-b" },
      "linkedin",
    )).toBe(false);
  });

  it("preserves the previously selected LinkedIn page when reconnect returns a different first page", () => {
    const aligned = alignOAuthResultToExistingIdentity({
      platform: "linkedin",
      accountId: "urn:li:organization:page-a",
      authorUrn: "urn:li:organization:page-b",
      authorMode: "organization",
      connectedAt: new Date("2026-07-01T00:00:00Z"),
    } as any, {
      accessToken: "fresh",
      refreshToken: null,
      expiresAt: null,
      scope: "w_organization_social",
      authorMode: "organization",
      authorUrn: "urn:li:organization:page-a",
      accountId: "urn:li:organization:page-a",
      accountName: "Page A",
      profileUrl: null,
      availableAuthors: [
        { mode: "organization", urn: "urn:li:organization:page-a", name: "Page A" },
        { mode: "organization", urn: "urn:li:organization:page-b", name: "Page B" },
      ],
    });

    expect(aligned.authorUrn).toBe("urn:li:organization:page-b");
    expect(aligned.accountName).toBe("Page B");
  });

  it("rejects a LinkedIn reconnect that no longer grants the selected page", () => {
    expect(() => alignOAuthResultToExistingIdentity({
      platform: "linkedin",
      accountId: "urn:li:organization:page-b",
      authorUrn: "urn:li:organization:page-b",
      authorMode: "organization",
      connectedAt: new Date("2026-07-01T00:00:00Z"),
    } as any, {
      accessToken: "fresh",
      refreshToken: null,
      expiresAt: null,
      scope: "w_organization_social",
      authorMode: "organization",
      authorUrn: "urn:li:organization:page-a",
      accountId: "urn:li:organization:page-a",
      accountName: "Page A",
      profileUrl: null,
      availableAuthors: [
        { mode: "organization", urn: "urn:li:organization:page-a", name: "Page A" },
      ],
    })).toThrow(/no longer includes the page/i);
  });

  it("rejects reconnecting an established X row as a different provider account", () => {
    expect(() => alignOAuthResultToExistingIdentity({
      platform: "twitter",
      accountId: "x-user-a",
      authorUrn: "urn:twitter:user:x-user-a",
      authorMode: null,
      connectedAt: new Date("2026-07-01T00:00:00Z"),
    } as any, {
      accessToken: "fresh",
      refreshToken: "refresh",
      expiresAt: null,
      scope: "tweet.write",
      authorMode: null,
      authorUrn: "urn:twitter:user:x-user-b",
      accountId: "x-user-b",
      accountName: "Different X account",
      profileUrl: null,
    })).toThrow(/does not match/i);
  });

  it("recognizes replacement X rows by the immutable provider user id", () => {
    expect(socialIdentityMatches(
      { accountId: "1636172250113007616", authorUrn: "urn:twitter:user:1636172250113007616" } as any,
      { accountId: "1636172250113007616", authorUrn: "urn:twitter:user:1636172250113007616" },
    )).toBe(true);
  });

  it("chooses the oldest matching provider record as the deterministic canonical row", () => {
    const oldest = {
      id: "oldest",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    };
    const newest = {
      id: "newest",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    };
    expect(chooseCanonicalSocialConnection([newest, oldest])).toBe(oldest);
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