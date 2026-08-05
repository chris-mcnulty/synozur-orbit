/**
 * Focused tests verifying that every background-service AI call
 * fires logAiUsage() with the correct tenant / operation context.
 *
 * Each test:
 *   1. Mocks the Anthropic client so no real network call is made.
 *   2. Mocks ai-usage-logger so we can assert logAiUsage was called.
 *   3. Exercises the service function and confirms the log entry shape.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach } from "vitest";

// ── Hoist shared fns so they are available inside vi.mock() factories ──────────
// vi.mock() calls are hoisted to the top of the file at compile time, so any
// variables referenced in their factory bodies must also be hoisted via vi.hoisted().

const { mockLogAiUsage, mockCreate } = vi.hoisted(() => ({
  mockLogAiUsage: vi.fn().mockResolvedValue(undefined),
  mockCreate: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../ai-usage-logger", () => ({
  logAiUsage: mockLogAiUsage,
}));

vi.mock("@anthropic-ai/sdk", () => {
  function MockAnthropic(this: any) {
    this.messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

vi.mock("../../storage", () => ({
  storage: {
    logAiUsage: vi.fn().mockResolvedValue(undefined),
    getBattlecardByCompetitor: vi.fn().mockResolvedValue(null),
    createBattlecard: vi.fn().mockResolvedValue({ id: "bc1" }),
    getLatestPricingSnapshotForCompetitor: vi.fn().mockResolvedValue(null),
    createPricingSnapshot: vi.fn().mockResolvedValue({ id: "s1" }),
    createActivity: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../web-crawler", () => ({
  crawlPricingPage: vi.fn().mockResolvedValue({ content: "pricing content" }),
}));

vi.mock("../notifications", () => ({
  notifications: { dispatch: vi.fn().mockResolvedValue(undefined) },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { analyzeArtifact } from "../sentiment-analyzer";
import { extractPricingTiers, analyzePricingChanges } from "../pricing-intelligence";
import { generateBattlecardForCompetitor } from "../battlecard-generator";

// ── Helpers ───────────────────────────────────────────────────────────────────

function anthropicResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AI usage logging — background services", () => {
  beforeEach(() => {
    mockLogAiUsage.mockClear();
    mockCreate.mockClear();
  });

  // ── sentiment-analyzer ─────────────────────────────────────────────────────

  describe("sentiment-analyzer: analyzeArtifact", () => {
    it("logs analyze_sentiment with tenant context after a successful call", async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({ sentimentScore: 0.4, toneLabel: "confident", toneNote: "Upbeat launch copy." }),
        ),
      );

      const result = await analyzeArtifact(
        "We are thrilled to launch our new product today!",
        { competitorName: "AcmeCorp", tenantDomain: "tenant-a.example.com", marketId: "mkt-123" },
      );

      assert.ok(result, "should return a result");
      assert.equal(result?.toneLabel, "confident");
      assert.equal(mockLogAiUsage.mock.calls.length, 1, "logAiUsage called once");

      const [ctx, operation, provider, model] = mockLogAiUsage.mock.calls[0];
      assert.equal(ctx.tenantDomain, "tenant-a.example.com");
      assert.equal(ctx.marketId, "mkt-123");
      assert.equal(operation, "analyze_sentiment");
      assert.equal(provider, "anthropic");
      assert.ok(typeof model === "string" && model.startsWith("claude"), `expected claude model, got: ${model}`);
    });

    it("does NOT log when text is too short (no AI call made)", async () => {
      const result = await analyzeArtifact("hi");
      assert.equal(result?.skipped, "too_short");
      assert.equal(mockCreate.mock.calls.length, 0);
      assert.equal(mockLogAiUsage.mock.calls.length, 0);
    });

    it("does NOT log when API key is absent (heuristic fallback path)", async () => {
      const savedKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
      delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
      try {
        // Force the module to re-check isAnalyzerAvailable() with no key.
        await analyzeArtifact("This sentence is long enough to pass the length check.");
      } finally {
        if (savedKey !== undefined) process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = savedKey;
      }
      assert.equal(mockLogAiUsage.mock.calls.length, 0);
    });
  });

  // ── pricing-intelligence: extractPricingTiers ──────────────────────────────

  describe("pricing-intelligence: extractPricingTiers", () => {
    it("logs extract_pricing_tiers with tenant context", async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            pricingModel: "subscription",
            currency: "USD",
            hasFreeTier: false,
            tiers: [{
              name: "Pro", price: "$49/mo", priceAmount: 49,
              billingPeriod: "monthly", currency: "USD",
              features: ["Feature A"], cta: null, isHighlighted: false, audience: null,
            }],
          }),
        ),
      );

      const result = await extractPricingTiers(
        "AcmeCorp",
        // content must be > 100 chars to trigger the AI call
        "Pro plan $49/month with Feature A included for all subscribers. ".repeat(5),
        "tenant-b.example.com",
        "mkt-456",
      );

      assert.ok(result.tiers.length > 0, "should extract at least one tier");
      assert.equal(mockLogAiUsage.mock.calls.length, 1);

      const [ctx, operation, provider] = mockLogAiUsage.mock.calls[0];
      assert.equal(ctx.tenantDomain, "tenant-b.example.com");
      assert.equal(ctx.marketId, "mkt-456");
      assert.equal(operation, "extract_pricing_tiers");
      assert.equal(provider, "anthropic");
    });

    it("does NOT log when content is too short (early return, no AI call)", async () => {
      const result = await extractPricingTiers("AcmeCorp", "short");
      assert.deepEqual(result.tiers, []);
      assert.equal(mockCreate.mock.calls.length, 0);
      assert.equal(mockLogAiUsage.mock.calls.length, 0);
    });
  });

  // ── pricing-intelligence: analyzePricingChanges ────────────────────────────

  describe("pricing-intelligence: analyzePricingChanges", () => {
    it("logs analyze_pricing_changes with tenant context", async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            noSignificantChanges: false,
            categories: ["price_changed"],
            changes: [{ kind: "price_changed", description: "Pro went up $10", significance: "high" }],
            narrative: "Pro tier price increased from $49 to $59/mo.",
          }),
        ),
      );

      const prev = [{ name: "Pro", price: "$49/mo", priceAmount: 49, billingPeriod: "monthly" as const, currency: "USD", features: [], cta: null, isHighlighted: false, audience: null }];
      const curr = [{ name: "Pro", price: "$59/mo", priceAmount: 59, billingPeriod: "monthly" as const, currency: "USD", features: [], cta: null, isHighlighted: false, audience: null }];

      await analyzePricingChanges("AcmeCorp", prev, curr, 15, "tenant-c.example.com", "mkt-789");

      assert.equal(mockLogAiUsage.mock.calls.length, 1);
      const [ctx, operation] = mockLogAiUsage.mock.calls[0];
      assert.equal(ctx.tenantDomain, "tenant-c.example.com");
      assert.equal(ctx.marketId, "mkt-789");
      assert.equal(operation, "analyze_pricing_changes");
    });
  });

  // ── battlecard-generator ───────────────────────────────────────────────────

  describe("battlecard-generator: generateBattlecardForCompetitor", () => {
    it("logs generate_battlecard with tenant, market, and user context", async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            strengths: ["Fast"], weaknesses: ["Expensive"],
            ourAdvantages: ["Better UX"],
            objections: [{ objection: "Too costly", response: "ROI > cost" }],
            talkTracks: [{ scenario: "Competitive eval", script: "We outperform on X Y Z." }],
            quickStats: { pricing: "$99/mo", marketPosition: "Mid-market", targetAudience: "SMBs", keyProducts: "Core" },
          }),
        ),
      );

      const fakeCompetitor: any = {
        id: "comp-1", name: "Rival Inc.", url: "https://rival.com", analysisData: null,
      };

      const result = await generateBattlecardForCompetitor({
        competitor: fakeCompetitor,
        ourCompanyName: "Us Corp",
        ourPositioning: "We are the better choice",
        tenantDomain: "tenant-d.example.com",
        marketId: "mkt-d",
        userId: "user-42",
      });

      assert.equal(result.status, "created");
      assert.equal(mockLogAiUsage.mock.calls.length, 1);

      const [ctx, operation, provider, model, usage] = mockLogAiUsage.mock.calls[0];
      assert.equal(ctx.tenantDomain, "tenant-d.example.com");
      assert.equal(ctx.marketId, "mkt-d");
      assert.equal(ctx.userId, "user-42");
      assert.equal(operation, "generate_battlecard");
      assert.equal(provider, "anthropic");
      assert.ok(typeof model === "string" && model.startsWith("claude"), `expected claude model, got: ${model}`);
      assert.ok(usage != null, "usage object should be passed through");
    });
  });
});
