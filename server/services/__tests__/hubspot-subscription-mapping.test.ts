/**
 * Tests for HubSpot per-category subscription mapping.
 *
 * Covers:
 * - isOptedOutForSubscription (core per-subscription helper)
 * - isOptedOutFromStatusPayload (global aggregate fallback)
 * - pushUnsubscribe / pushSubscribe subscription ID resolution chain:
 *     1. subscriptionIdOverride (direct override — skips lookup)
 *     2. hubspot_subscription_mappings table (by category name)
 *     3. global defaultSubscriptionId (fallback)
 *     4. undefined → skipped (no HubSpot call)
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, expect, beforeEach } from "vitest";
import {
  isOptedOutForSubscription,
  isOptedOutFromStatusPayload,
} from "../hubspot-email-sync-core";

// ── Top-level mocks (hoisted by Vitest) ─────────────────────────────────────
const mockGetHubspotSubscriptionId = vi.fn<[string, string], Promise<string | null>>();
const mockGetHubspotConnection = vi.fn();
const mockGetTenantByDomain = vi.fn();

vi.mock("../../storage", () => ({
  storage: {
    getHubspotSubscriptionId: (...args: unknown[]) => mockGetHubspotSubscriptionId(...args as [string, string]),
    getHubspotConnection: (...args: unknown[]) => mockGetHubspotConnection(...args),
    getTenantByDomain: (...args: unknown[]) => mockGetTenantByDomain(...args),
  },
}));

vi.mock("../hubspot-integration", () => ({
  getTenantAccessToken: vi.fn().mockResolvedValue({ accessToken: "tok" }),
  hasHubspotEmailScopes: vi.fn().mockReturnValue(true),
  HUBSPOT_REST_HOST: "https://api.hubapi.com",
}));

vi.mock("../plan-policy", () => ({
  checkFeatureAccessAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Shared base connection — scoped so tests can override defaultSubscriptionId
const BASE_CONN = {
  hubspotPortalId: "12345",
  defaultSubscriptionId: "global-sub-111",
  scopes: ["communication_preferences.read_write"],
};

const TENANT = "test.example.com";
const EMAIL = "user@example.com";

// ── isOptedOutForSubscription ────────────────────────────────────────────────

describe("isOptedOutForSubscription", () => {
  it("returns false for null / empty / malformed payloads", () => {
    assert.equal(isOptedOutForSubscription(null, "123"), false);
    assert.equal(isOptedOutForSubscription({}, "123"), false);
    assert.equal(isOptedOutForSubscription({ subscriptionStatuses: [] }, "123"), false);
    assert.equal(isOptedOutForSubscription("nope", "123"), false);
  });

  it("returns false when the target subscription ID is absent", () => {
    const payload = {
      subscriptionStatuses: [{ id: "999", status: "UNSUBSCRIBED" }],
    };
    assert.equal(isOptedOutForSubscription(payload, "123"), false);
  });

  it("returns true when the matching entry is UNSUBSCRIBED", () => {
    const payload = {
      subscriptionStatuses: [
        { id: "newsletter-id", status: "UNSUBSCRIBED" },
        { id: "product-id", status: "SUBSCRIBED" },
      ],
    };
    assert.equal(isOptedOutForSubscription(payload, "newsletter-id"), true);
  });

  it("returns false when the target is SUBSCRIBED even if others are opted out", () => {
    const payload = {
      subscriptionStatuses: [
        { id: "newsletter-id", status: "SUBSCRIBED" },
        { id: "product-id", status: "UNSUBSCRIBED" },
      ],
    };
    assert.equal(isOptedOutForSubscription(payload, "newsletter-id"), false);
    assert.equal(isOptedOutForSubscription(payload, "product-id"), true);
  });

  it("checks each subscription independently", () => {
    const payload = {
      subscriptionStatuses: [
        { id: "A", status: "UNSUBSCRIBED" },
        { id: "B", status: "SUBSCRIBED" },
        { id: "C", status: "UNSUBSCRIBED" },
      ],
    };
    assert.equal(isOptedOutForSubscription(payload, "A"), true);
    assert.equal(isOptedOutForSubscription(payload, "B"), false);
    assert.equal(isOptedOutForSubscription(payload, "C"), true);
  });
});

// ── isOptedOutFromStatusPayload (global aggregate) ───────────────────────────

describe("isOptedOutFromStatusPayload — global aggregate", () => {
  it("true only when all subscriptions UNSUBSCRIBED and none SUBSCRIBED", () => {
    assert.equal(
      isOptedOutFromStatusPayload({
        subscriptionStatuses: [{ id: "1", status: "UNSUBSCRIBED" }, { id: "2", status: "UNSUBSCRIBED" }],
      }),
      true,
    );
  });

  it("false when at least one subscription remains SUBSCRIBED", () => {
    assert.equal(
      isOptedOutFromStatusPayload({
        subscriptionStatuses: [{ id: "1", status: "UNSUBSCRIBED" }, { id: "2", status: "SUBSCRIBED" }],
      }),
      false,
    );
  });

  it("false for empty / missing subscription list (opt-in by default)", () => {
    assert.equal(isOptedOutFromStatusPayload(null), false);
    assert.equal(isOptedOutFromStatusPayload({}), false);
    assert.equal(isOptedOutFromStatusPayload({ subscriptionStatuses: [] }), false);
  });
});

// ── pushUnsubscribe — subscription ID resolution chain ───────────────────────

describe("pushUnsubscribe — subscription ID resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const MAPPED_ID = "mapped-sub-999";
  const DEFAULT_ID = "global-sub-111";
  const OVERRIDE = "direct-override-777";

  function makeFetch(ok = true, status = 200) {
    return vi.fn().mockResolvedValue({ ok, status } as Response);
  }

  it("uses mapped subscription ID when hubspot_subscription_mappings has an entry for the category", async () => {
    mockGetTenantByDomain.mockResolvedValue({ plan: "enterprise" });
    mockGetHubspotConnection.mockResolvedValue(BASE_CONN);
    mockGetHubspotSubscriptionId.mockResolvedValue(MAPPED_ID);

    const fetchSpy = makeFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const { pushUnsubscribe } = await import("../hubspot-email-sync");
    const result = await pushUnsubscribe(TENANT, EMAIL, undefined, "Newsletter");

    assert.equal(result, "ok");
    expect(mockGetHubspotSubscriptionId).toHaveBeenCalledWith(TENANT, "Newsletter");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    assert.equal(body.subscriptionId, MAPPED_ID);

    vi.unstubAllGlobals();
  });

  it("falls back to the global default when no category mapping exists", async () => {
    mockGetTenantByDomain.mockResolvedValue({ plan: "enterprise" });
    mockGetHubspotConnection.mockResolvedValue({ ...BASE_CONN, defaultSubscriptionId: DEFAULT_ID });
    mockGetHubspotSubscriptionId.mockResolvedValue(null); // no mapping

    const fetchSpy = makeFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const { pushUnsubscribe } = await import("../hubspot-email-sync");
    const result = await pushUnsubscribe(TENANT, EMAIL, undefined, "Newsletter");

    assert.equal(result, "ok");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    assert.equal(body.subscriptionId, DEFAULT_ID);

    vi.unstubAllGlobals();
  });

  it("uses subscriptionIdOverride directly, bypassing the mapping table", async () => {
    mockGetTenantByDomain.mockResolvedValue({ plan: "enterprise" });
    mockGetHubspotConnection.mockResolvedValue(BASE_CONN);
    mockGetHubspotSubscriptionId.mockResolvedValue(MAPPED_ID); // would win if consulted

    const fetchSpy = makeFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const { pushUnsubscribe } = await import("../hubspot-email-sync");
    await pushUnsubscribe(TENANT, EMAIL, OVERRIDE);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    assert.equal(body.subscriptionId, OVERRIDE);
    // Mapping table must NOT be consulted when override is given
    expect(mockGetHubspotSubscriptionId).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("returns 'skipped' (no HubSpot call) when neither mapping nor default is configured", async () => {
    mockGetTenantByDomain.mockResolvedValue({ plan: "enterprise" });
    mockGetHubspotConnection.mockResolvedValue({ ...BASE_CONN, defaultSubscriptionId: null });
    mockGetHubspotSubscriptionId.mockResolvedValue(null);

    const fetchSpy = makeFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const { pushUnsubscribe } = await import("../hubspot-email-sync");
    const result = await pushUnsubscribe(TENANT, EMAIL, undefined, "Newsletter");

    assert.equal(result, "skipped");
    assert.equal(fetchSpy.mock.calls.length, 0);

    vi.unstubAllGlobals();
  });
});
