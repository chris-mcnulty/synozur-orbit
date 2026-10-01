import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conference, ConferenceSession } from "@shared/schema";

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../ai-provider", () => ({ completeForFeature: complete }));

import { generateCopyVariants, hasUnconfirmedBoothClaim } from "../conference-promotion-service";

const conf = {
  name: "North America Collaboration Summit",
  tenantDomain: "tenant.example",
  boothDetails: null,
  thematicBrief: "Speaking about collaboration.",
} as Conference;

const options = {
  platform: "linkedin",
  socialAccountId: null,
  tenantDomain: conf.tenantDomain,
  variantCount: 2,
  conf,
};
const good = ["Join our collaboration session.", "Connect with our team at the summit."];

describe("event booth claims", () => {
  beforeEach(() => complete.mockReset());

  it("prohibits booth claims in anchor prompts when no booth is configured", async () => {
    complete.mockResolvedValue({ text: JSON.stringify(good) });
    expect(await generateCopyVariants(options)).toEqual(good);
    const prompt = complete.mock.calls[0][1];
    expect(prompt).toContain("There is NO confirmed booth");
    expect(prompt).not.toContain("(booth, where to find us");
  });

  it("grounds session copy in the saved room without assuming a booth", async () => {
    complete.mockResolvedValue({ text: JSON.stringify(good) });
    await generateCopyVariants({
      ...options,
      session: { title: "Collaboration in practice", room: "Room 101" } as ConferenceSession,
    });
    const prompt = complete.mock.calls[0][1];
    expect(prompt).toContain("Room: Room 101");
    expect(prompt).toContain("Title: Collaboration in practice");
    expect(prompt).toContain("There is NO confirmed booth");
  });

  it("retries all variants when any contains an invented booth", async () => {
    complete.mockResolvedValueOnce({ text: JSON.stringify(["Stop by our booth.", good[0]]) })
      .mockResolvedValueOnce({ text: JSON.stringify(good) });
    expect(await generateCopyVariants(options)).toEqual(good);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][1]).toContain("CORRECTION:");
  });

  it("rejects repeated booth claims instead of saving them", async () => {
    complete.mockResolvedValue({ text: '["Visit our exhibition stand.", "Stop by our booth."]' });
    await expect(generateCopyVariants(options)).rejects.toThrow("unconfirmed booth");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("allows booth copy only with explicit booth details", async () => {
    const text = ["Visit our booth 42.", "Meet our team at booth 42."];
    complete.mockResolvedValue({ text: JSON.stringify(text) });
    expect(await generateCopyVariants({
      ...options, conf: { ...conf, boothDetails: "Booth 42" },
    })).toEqual(text);
    expect(complete.mock.calls[0][1]).toContain("Confirmed booth details: Booth 42");
    expect(complete.mock.calls[0][1]).not.toContain("There is NO confirmed booth");
  });

  it("treats empty and whitespace booth details as no booth", async () => {
    complete.mockResolvedValue({ text: JSON.stringify(good) });
    await generateCopyVariants({ ...options, conf: { ...conf, boothDetails: "  " } });
    expect(complete.mock.calls[0][1]).toContain("There is NO confirmed booth");
  });

  it("catches booth and exhibitor synonyms but permits normal session invitations", () => {
    for (const text of ["Visit booth #4", "Find us in the expo hall", "We're exhibitors", "Visit our stand"]) {
      expect(hasUnconfirmedBoothClaim(text)).toBe(true);
    }
    expect(hasUnconfirmedBoothClaim("Join our session in Room 101 and connect with our team.")).toBe(false);
  });
});