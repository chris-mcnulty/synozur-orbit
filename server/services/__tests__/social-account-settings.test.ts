import { describe, expect, it } from "vitest";
import { buildSocialAccountSettingsPatch } from "../social-account-settings";

describe("social account settings patch", () => {
  it("updates a SocialPilot destination without including provider identity or connection fields", () => {
    const patch = buildSocialAccountSettingsPatch({
      socialPilotAccountId: " socialpilot-profile-42 ",
      accountName: "Orbit company page",
      // Simulates a malicious or stale client payload. The allow-list must
      // prevent it from changing OAuth-derived state.
      accountId: "urn:li:organization:other-page",
      authorUrn: "urn:li:organization:other-page",
      status: "inactive",
    } as any);

    expect(patch).toEqual({
      socialPilotAccountId: "socialpilot-profile-42",
      accountName: "Orbit company page",
    });
    expect(patch).not.toHaveProperty("accountId");
    expect(patch).not.toHaveProperty("authorUrn");
    expect(patch).not.toHaveProperty("status");
  });

  it("allows clearing a SocialPilot destination without touching provider identity", () => {
    expect(buildSocialAccountSettingsPatch({ socialPilotAccountId: "   " })).toEqual({
      socialPilotAccountId: null,
    });
  });
});