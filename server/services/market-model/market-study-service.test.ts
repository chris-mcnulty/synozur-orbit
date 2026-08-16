/**
 * Tests for discoverCompetitorsForStudy — the URL-crawl + AI competitor-discovery
 * helper that was added in Task #740.
 *
 * Scope:
 *   1. Crawl throws  → graceful fallback to URL-only AI call; positive count returned.
 *   2. Crawl returns pages → buildCompetitorDiscoveryPrompt receives websiteContent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── module mocks (must be declared before any import that resolves them) ──────

vi.mock("../../db", () => ({ db: {} }));

vi.mock("../web-crawler", () => ({
  crawlCompetitorWebsite: vi.fn(),
}));

vi.mock("../../utils/url-validator", () => ({
  validateUrlWithDnsCheck: vi.fn(),
}));

vi.mock("../ai-provider", () => ({
  completeForFeature: vi.fn(),
}));

vi.mock("../ai-usage-logger", () => ({
  logAiUsage: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    findOrCreateOrganization: vi.fn(),
    incrementOrgRefCount: vi.fn(),
    createCompetitor: vi.fn(),
  },
}));

// Spy on the pure-core prompt builder so we can inspect the args it was called with.
vi.mock("./market-study-core", async (importOriginal) => {
  const real = await importOriginal<typeof import("./market-study-core")>();
  return {
    ...real,
    buildCompetitorDiscoveryPrompt: vi.fn(real.buildCompetitorDiscoveryPrompt),
  };
});

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { discoverCompetitorsForStudy } from "./market-study-service";
import { crawlCompetitorWebsite } from "../web-crawler";
import { validateUrlWithDnsCheck } from "../../utils/url-validator";
import { completeForFeature } from "../ai-provider";
import { logAiUsage } from "../ai-usage-logger";
import { storage } from "../../storage";
import { buildCompetitorDiscoveryPrompt } from "./market-study-core";

// ── shared test fixtures ──────────────────────────────────────────────────────

const OPTS_BASE = {
  tenantDomain: "test.example.com",
  marketId: "mkt-1",
  userId: "user-1",
  inputType: "url" as const,
  inputValue: "https://acme.com",
  count: 3,
};

/** A minimal completeForFeature response that yields two competitors. */
const AI_RESPONSE = {
  text: '[{"name":"CompA","url":"https://compa.io"},{"name":"CompB","url":"https://compb.io"}]',
  provider: "openai",
  model: "gpt-4o",
  usage: { inputTokens: 100, outputTokens: 50 },
  durationMs: 500,
};

beforeEach(() => {
  vi.clearAllMocks();

  // DNS validation passes by default.
  vi.mocked(validateUrlWithDnsCheck).mockResolvedValue({ isValid: true });

  // AI call returns two competitors.
  vi.mocked(completeForFeature).mockResolvedValue(AI_RESPONSE as any);
  vi.mocked(logAiUsage).mockResolvedValue(undefined);

  // Storage helpers succeed without real DB interaction.
  vi.mocked(storage.findOrCreateOrganization).mockResolvedValue({ id: "org-1" } as any);
  vi.mocked(storage.incrementOrgRefCount).mockResolvedValue(undefined);
  vi.mocked(storage.createCompetitor).mockResolvedValue({ id: "comp-1" } as any);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("discoverCompetitorsForStudy — crawl failure path", () => {
  it("still returns a positive competitor count when crawlCompetitorWebsite throws", async () => {
    vi.mocked(crawlCompetitorWebsite).mockRejectedValue(new Error("connection refused"));

    const result = await discoverCompetitorsForStudy(OPTS_BASE);

    // Two competitors from the mocked AI response should be persisted.
    expect(result.count).toBe(2);
    // The AI was still called even though the crawl failed.
    expect(completeForFeature).toHaveBeenCalledOnce();
  });

  it("calls buildCompetitorDiscoveryPrompt without websiteContent when crawl throws", async () => {
    vi.mocked(crawlCompetitorWebsite).mockRejectedValue(new Error("timeout"));

    await discoverCompetitorsForStudy(OPTS_BASE);

    expect(buildCompetitorDiscoveryPrompt).toHaveBeenCalledOnce();
    const callArg = vi.mocked(buildCompetitorDiscoveryPrompt).mock.calls[0][0];
    // websiteContent must be undefined — fallback to URL-only discovery.
    expect(callArg.websiteContent).toBeUndefined();
    expect(callArg.inputValue).toBe(OPTS_BASE.inputValue);
  });
});

describe("discoverCompetitorsForStudy — crawl success path", () => {
  it("passes websiteContent to buildCompetitorDiscoveryPrompt when crawl succeeds", async () => {
    vi.mocked(crawlCompetitorWebsite).mockResolvedValue({
      pages: [
        { title: "Acme Home", url: "https://acme.com/", content: "We make widgets for enterprise customers." },
        { title: "Acme Pricing", url: "https://acme.com/pricing", content: "Plans start at $99/mo." },
      ],
    } as any);

    const result = await discoverCompetitorsForStudy(OPTS_BASE);

    expect(result.count).toBe(2);

    expect(buildCompetitorDiscoveryPrompt).toHaveBeenCalledOnce();
    const callArg = vi.mocked(buildCompetitorDiscoveryPrompt).mock.calls[0][0];

    // websiteContent should be a non-empty string built from the crawled pages.
    expect(typeof callArg.websiteContent).toBe("string");
    expect(callArg.websiteContent!.length).toBeGreaterThan(0);
    // Content should include text from both pages.
    expect(callArg.websiteContent).toContain("Acme Home");
    expect(callArg.websiteContent).toContain("widgets for enterprise");
  });

  it("returns 0 when inputValue is blank regardless of crawl", async () => {
    const result = await discoverCompetitorsForStudy({ ...OPTS_BASE, inputValue: "   " });
    expect(result.count).toBe(0);
    expect(crawlCompetitorWebsite).not.toHaveBeenCalled();
  });

  it("skips crawl and passes no websiteContent for brief inputType", async () => {
    const result = await discoverCompetitorsForStudy({
      ...OPTS_BASE,
      inputType: "brief",
      inputValue: "We sell RevOps software to mid-market companies",
    });

    expect(result.count).toBe(2);
    expect(crawlCompetitorWebsite).not.toHaveBeenCalled();

    const callArg = vi.mocked(buildCompetitorDiscoveryPrompt).mock.calls[0][0];
    expect(callArg.websiteContent).toBeUndefined();
    expect(callArg.inputType).toBe("brief");
  });
});

describe("discoverCompetitorsForStudy — DNS/SSRF guard", () => {
  it("skips crawl and falls back to URL-only when DNS validation fails", async () => {
    vi.mocked(validateUrlWithDnsCheck).mockResolvedValue({ isValid: false, error: "private IP" });

    const result = await discoverCompetitorsForStudy(OPTS_BASE);

    expect(result.count).toBe(2); // still returns AI-based competitors
    expect(crawlCompetitorWebsite).not.toHaveBeenCalled();

    const callArg = vi.mocked(buildCompetitorDiscoveryPrompt).mock.calls[0][0];
    expect(callArg.websiteContent).toBeUndefined();
  });
});
