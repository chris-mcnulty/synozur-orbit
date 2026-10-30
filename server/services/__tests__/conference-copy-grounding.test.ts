import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conference, ConferenceSession } from "@shared/schema";

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../ai-provider", () => ({ completeForFeature: complete }));

import { generateCopyVariants, hasInventedMainEventClaim, hasUnconfirmedBoothClaim } from "../conference-promotion-service";

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

  it("retries invented sessionless claims and includes the registration link", async () => {
    complete.mockResolvedValueOnce({ text: '["Join our keynote session.", "We are attending the webinar."]' })
      .mockResolvedValueOnce({ text: '["Register for the webinar.", "Explore collaboration online."]' });
    const copies = await generateCopyVariants({
      ...options, mainEventOnly: true, conf: { ...conf, website: "https://example.com/register" },
    });
    expect(copies.every(copy => copy.includes("https://example.com/register"))).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("allows complete saved historical facts without treating them as a new schedule", async () => {
    const history = 'At TribalNet, our breakout session covered AI purchasing. The speakers discussed contract terms.';
    complete.mockResolvedValue({ text: JSON.stringify([
      `${history}\nRegister for the follow-up roundtable.`,
      "Explore AI governance at the roundtable.",
    ]) });
    const copies = await generateCopyVariants({
      ...options, mainEventOnly: true, conf: { ...conf, thematicBrief: history },
    });
    expect(copies[0]).toContain(history);
    expect(complete).toHaveBeenCalledTimes(1);
    const prompt = complete.mock.calls[0][1];
    expect(prompt).toContain("Historical sessions or presenters");
    expect(prompt).not.toContain("Invite attendees to the supplied sessions or to connect");
  });

  it("does not authorize invented claims just because the brief mentions sessions", () => {
    const history = "At TribalNet, our breakout session covered AI purchasing. The speakers discussed contract terms.";
    for (const text of [
      "Join our breakout session tomorrow.",
      "The speakers include a new keynote presenter.",
      "We are attending the roundtable.",
      `${history} Meet us at the venue.`,
    ]) {
      expect(hasInventedMainEventClaim(text, history)).toBe(true);
    }
    expect(hasInventedMainEventClaim(history, history)).toBe(false);
    expect(hasInventedMainEventClaim("The speakers discussed contract terms. Join our session.", history)).toBe(true);
    expect(hasInventedMainEventClaim("We are attending.", "It is not true that we are attending.")).toBe(true);
  });

  it("uses a targeted main-event correction without offering a team meeting or session", async () => {
    complete.mockResolvedValueOnce({ text: '["Join our session.", "Hear the speakers."]' })
      .mockResolvedValueOnce({ text: '["Register for the roundtable.", "Discuss AI governance."]' });
    await generateCopyVariants({ ...options, mainEventOnly: true });
    expect(complete.mock.calls[1][1]).toContain("Omit historical sessions and presenters entirely");
    expect(complete.mock.calls[1][1]).toContain("Invite readers to register");
    expect(complete.mock.calls[1][1]).not.toContain("Invite attendees to the supplied session.");
  });

  it("still rejects invented main-event claims after correction", async () => {
    complete.mockResolvedValue({ text: '["Join our session.", "Hear the speakers."]' });
    await expect(generateCopyVariants({ ...options, mainEventOnly: true })).rejects.toThrow("No new posts were saved");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not let historical booth mentions override missing booth confirmation", async () => {
    const history = "Visit our booth.";
    complete.mockResolvedValue({ text: JSON.stringify([history]) });
    await expect(generateCopyVariants({
      ...options, mainEventOnly: true, conf: { ...conf, thematicBrief: history },
    })).rejects.toThrow("unconfirmed booth");
  });

  it("keeps retry instructions grounded in the supplied session for session posts", async () => {
    complete.mockResolvedValueOnce({ text: '["Visit our booth."]' })
      .mockResolvedValueOnce({ text: JSON.stringify(good) });
    await generateCopyVariants({
      ...options, session: { title: "AI contracts" } as ConferenceSession,
    });
    expect(complete.mock.calls[1][1]).toContain("Use only the saved event and supplied session facts.");
    expect(complete.mock.calls[1][1]).not.toContain("using only the main event facts");
  });
});