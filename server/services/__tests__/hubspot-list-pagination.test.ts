/**
 * Pagination-safety tests for listAllContactsFromHubspotList.
 *
 * An oversized HubSpot list must be rejected explicitly — never silently
 * truncated — because a partial import would silently omit send recipients.
 * Covers over-cap, exactly-at-cap-with-more-pages, and page-cap exhaustion.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    getHubspotConnection: vi.fn().mockResolvedValue({
      tenantDomain: "acme.example.com",
      encryptedAccessToken: "enc",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }),
  },
}));
vi.mock("../../utils/encryption", () => ({
  decryptSecret: () => "token",
  encryptSecret: (s: string) => s,
}));

import { listAllContactsFromHubspotList } from "../hubspot-integration";

function contactPage(count: number, startVid: number) {
  return {
    contacts: Array.from({ length: count }, (_, i) => ({
      vid: startVid + i,
      properties: { email: { value: `u${startVid + i}@example.com` } },
      "identity-profiles": [],
    })),
  };
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function queuePages(pages: any[]) {
  for (const p of pages) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => p });
  }
}

beforeEach(() => fetchMock.mockReset());

describe("listAllContactsFromHubspotList — oversized-list safety", () => {
  it("follows vid-offset pagination across pages and returns the full membership", async () => {
    queuePages([
      { ...contactPage(100, 0), "has-more": true, "vid-offset": 100 },
      { ...contactPage(50, 100), "has-more": false },
    ]);
    const out = await listAllContactsFromHubspotList("acme.example.com", "10", 500);
    expect(out).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("vidOffset=100");
  });

  it("rejects a list that exceeds the cap", async () => {
    queuePages([
      { ...contactPage(100, 0), "has-more": true, "vid-offset": 100 },
      { ...contactPage(100, 100), "has-more": true, "vid-offset": 200 },
    ]);
    await expect(listAllContactsFromHubspotList("acme.example.com", "10", 150))
      .rejects.toThrow(/exceeds the supported import size/);
  });

  it("rejects a list exactly at the cap when HubSpot reports more pages remain", async () => {
    queuePages([
      { ...contactPage(100, 0), "has-more": true, "vid-offset": 100 },
      // Exactly at cap (200) but has-more is still true — a subsequent empty
      // page must not be able to sneak a partial snapshot through.
      { ...contactPage(100, 100), "has-more": true, "vid-offset": 200 },
    ]);
    await expect(listAllContactsFromHubspotList("acme.example.com", "10", 200))
      .rejects.toThrow(/exceeds the supported import size/);
  });

  it("accepts a list exactly at the cap when there are no more pages", async () => {
    queuePages([
      { ...contactPage(100, 0), "has-more": true, "vid-offset": 100 },
      { ...contactPage(100, 100), "has-more": false },
    ]);
    const out = await listAllContactsFromHubspotList("acme.example.com", "10", 200);
    expect(out).toHaveLength(200);
  });

  it("rejects a has-more response with a missing vid-offset cursor", async () => {
    queuePages([
      { ...contactPage(100, 0), "has-more": true }, // no vid-offset at all
    ]);
    await expect(listAllContactsFromHubspotList("acme.example.com", "10", 500))
      .rejects.toThrow(/without a usable vid-offset/);
  });

  it("rejects a has-more response with a non-numeric vid-offset cursor", async () => {
    queuePages([
      { ...contactPage(100, 0), "has-more": true, "vid-offset": "not-a-cursor" },
    ]);
    await expect(listAllContactsFromHubspotList("acme.example.com", "10", 500))
      .rejects.toThrow(/without a usable vid-offset/);
  });

  it("treats page-cap exhaustion as an error, never a partial snapshot", async () => {
    // Adversarial pagination: pages keep claiming has-more with tiny counts
    // so the loop cap trips before the size cap does.
    const pages = Array.from({ length: 10 }, (_, i) => ({
      ...contactPage(1, i), "has-more": true, "vid-offset": i + 1,
    }));
    queuePages(pages);
    // maxContacts 100 → maxPages = ceil(100/100)+2 = 3 loop iterations.
    await expect(listAllContactsFromHubspotList("acme.example.com", "10", 100))
      .rejects.toThrow(/pagination did not terminate/);
  });
});
