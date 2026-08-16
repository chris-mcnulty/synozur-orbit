/**
 * Confirms that the Strategic Intelligence Stack (SIS) block produced by
 * buildMarketIntelligenceContext is injected into the messaging-framework
 * prompt — and absent when there is no market data — for both code paths:
 *
 *   1. The manual POST /api/projects/:projectId/recommendations/messaging_framework/generate route
 *   2. The buildRegenMessagingPrompt helper used by the full-regeneration messagingTask
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Hoisted spies (available inside vi.mock factories which are hoisted) ──────

const anthropicCreate = vi.hoisted(() => vi.fn());
const mockBuildMIC = vi.hoisted(() => vi.fn<() => Promise<string>>());

// ─── Module mocks ──────────────────────────────────────────────────────────────

// Anthropic SDK: replace with a class whose messages.create is the hoisted spy.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
  },
}));

// SIS context builder — the focal point of all tests below.
vi.mock("../market-intelligence-context", () => ({
  buildMarketIntelligenceContext: (...args: unknown[]) => mockBuildMIC(...args),
}));

// Storage — minimal stubs so the route can reach the Anthropic call.
vi.mock("../../storage", () => ({
  storage: {
    getClientProject: vi.fn(),
    getProjectProducts: vi.fn(),
    getPersonasByContext: vi.fn(),
    getMarket: vi.fn(),
    getLongFormRecommendationByType: vi.fn(),
    createLongFormRecommendation: vi.fn(),
    updateLongFormRecommendation: vi.fn(),
  },
}));

// Request-context helpers.
vi.mock("../../context", () => ({
  getRequestContext: vi.fn(),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../routes/helpers", () => ({
  guardManualAction: vi.fn().mockResolvedValue(true),
  guardFeature: vi.fn().mockResolvedValue(true),
  toContextFilter: vi.fn().mockReturnValue({}),
  validateResourceContext: vi.fn().mockReturnValue(true),
  logAiUsage: vi.fn().mockResolvedValue(undefined),
  computeLatestSourceDataTimestamp: vi.fn(),
  hasCrossTenantReadAccess: vi.fn(),
}));

vi.mock("../strategic-context", () => ({
  formatPersonaContextForPrompt: vi.fn().mockReturnValue(""),
}));

// ─── Static imports (resolved after vi.mock calls are applied) ─────────────────

import { storage } from "../../storage";
import { getRequestContext } from "../../context";
import { registerIntelligenceRoutes } from "../../routes/intelligence";
import { buildRegenMessagingPrompt } from "../full-regeneration-service";

// ─── Shared test fixtures ──────────────────────────────────────────────────────

const FAKE_PROJECT = {
  id: "proj-1",
  name: "Acme Project",
  clientName: "Acme Corp",
  marketId: "mkt-1",
  tenantDomain: "acme.test",
} as any;

const FAKE_CTX = {
  tenantDomain: "acme.test",
  marketId: "mkt-1",
  userId: "user-1",
} as any;

const ANTHROPIC_OK_RESPONSE = {
  content: [{ type: "text", text: "## Messaging Framework\nGreat content." }],
  usage: { input_tokens: 10, output_tokens: 20 },
};

const SIS_BLOCK = [
  "",
  "STRATEGIC MARKET INTELLIGENCE (from the completed market analysis — treat this as the authoritative view of segments and channel opportunities):",
  "",
  "Top Market Segments (ranked by priority):",
  "- Enterprise SaaS [priority 9/10] (TAM ~USD 5.0B, SAM ~USD 1.2B) — large companies needing workflow automation",
].join("\n");

// ─── Route tests ───────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());
  registerIntelligenceRoutes(app);
  return app;
}

describe("messaging_framework/generate route — SIS injection", () => {
  beforeEach(() => {
    vi.mocked(getRequestContext).mockResolvedValue(FAKE_CTX);
    vi.mocked(storage.getClientProject).mockResolvedValue(FAKE_PROJECT);
    vi.mocked(storage.getProjectProducts).mockResolvedValue([]);
    vi.mocked(storage.getPersonasByContext).mockResolvedValue([]);
    vi.mocked(storage.getMarket).mockResolvedValue({ businessType: "b2b" } as any);
    vi.mocked(storage.getLongFormRecommendationByType).mockResolvedValue(null);
    vi.mocked(storage.createLongFormRecommendation).mockResolvedValue({ id: "rec-1" } as any);
    anthropicCreate.mockResolvedValue(ANTHROPIC_OK_RESPONSE);
    anthropicCreate.mockClear();
  });

  it("includes the SIS block in the prompt when buildMarketIntelligenceContext returns a non-empty string", async () => {
    mockBuildMIC.mockResolvedValue(SIS_BLOCK);

    const app = buildTestApp();
    const res = await request(app)
      .post("/api/projects/proj-1/recommendations/messaging_framework/generate")
      .send({ targetAudience: "enterprise buyers" });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(anthropicCreate.mock.calls.length, 1, "Expected exactly one Anthropic call");

    const sentPrompt: string = anthropicCreate.mock.calls[0][0].messages[0].content;
    assert.ok(
      sentPrompt.includes(SIS_BLOCK),
      "Expected the SIS block to appear verbatim in the Anthropic prompt",
    );
    // The interpolation rule is: context ? `\n${context}\n` : ""
    // So the block must be wrapped with newlines on each side.
    assert.ok(
      sentPrompt.includes("\n" + SIS_BLOCK + "\n"),
      "Expected the SIS block to be wrapped with newlines in the prompt",
    );
  });

  it("does not add extra blank lines or SIS noise when buildMarketIntelligenceContext returns empty string", async () => {
    mockBuildMIC.mockResolvedValue("");

    const app = buildTestApp();
    const res = await request(app)
      .post("/api/projects/proj-1/recommendations/messaging_framework/generate")
      .send({});

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(anthropicCreate.mock.calls.length, 1, "Expected exactly one Anthropic call");

    const sentPrompt: string = anthropicCreate.mock.calls[0][0].messages[0].content;

    assert.ok(
      !sentPrompt.includes("STRATEGIC MARKET INTELLIGENCE"),
      "Expected no SIS header in the prompt when context is empty",
    );
    // The SIS block must not inject any of its distinctive content.
    assert.ok(
      !sentPrompt.includes("Top Market Segments"),
      "Expected no SIS segment list in the prompt when context is empty",
    );
    assert.ok(
      !sentPrompt.includes("Top GTM Opportunities"),
      "Expected no SIS opportunity list in the prompt when context is empty",
    );
  });
});

// ─── buildRegenMessagingPrompt (full-regeneration messaging task) ───────────────

describe("buildRegenMessagingPrompt — SIS injection", () => {
  const BASE_OPTS = {
    companyName: "Acme Corp",
    websiteUrl: "https://acme.test",
    description: "We automate workflows.",
    isB2C: false,
  };

  it("includes the SIS block in the B2B prompt when marketIntelligenceContext is non-empty", () => {
    const prompt = buildRegenMessagingPrompt({ ...BASE_OPTS, marketIntelligenceContext: SIS_BLOCK });

    assert.ok(
      prompt.includes(SIS_BLOCK),
      "Expected the SIS block to appear in the B2B regen prompt",
    );
    assert.ok(
      prompt.includes("\n" + SIS_BLOCK + "\n"),
      "Expected the SIS block to be wrapped with newlines in the B2B regen prompt",
    );
  });

  it("includes the SIS block in the B2C prompt when marketIntelligenceContext is non-empty", () => {
    const prompt = buildRegenMessagingPrompt({
      ...BASE_OPTS,
      isB2C: true,
      marketIntelligenceContext: SIS_BLOCK,
    });

    assert.ok(
      prompt.includes(SIS_BLOCK),
      "Expected the SIS block to appear in the B2C regen prompt",
    );
    assert.ok(
      prompt.includes("\n" + SIS_BLOCK + "\n"),
      "Expected the SIS block to be wrapped with newlines in the B2C regen prompt",
    );
  });

  it("does not add extra blank lines or SIS noise in the B2B prompt when marketIntelligenceContext is empty", () => {
    const prompt = buildRegenMessagingPrompt({ ...BASE_OPTS, marketIntelligenceContext: "" });

    assert.ok(
      !prompt.includes("STRATEGIC MARKET INTELLIGENCE"),
      "Expected no SIS header in the B2B regen prompt when context is empty",
    );
    assert.ok(
      !prompt.includes("\n\n\n"),
      "Expected no triple-blank-line runs in the B2B regen prompt when SIS block is absent",
    );
  });

  it("does not add extra blank lines or SIS noise in the B2C prompt when marketIntelligenceContext is empty", () => {
    const prompt = buildRegenMessagingPrompt({
      ...BASE_OPTS,
      isB2C: true,
      marketIntelligenceContext: "",
    });

    assert.ok(
      !prompt.includes("STRATEGIC MARKET INTELLIGENCE"),
      "Expected no SIS header in the B2C regen prompt when context is empty",
    );
    assert.ok(
      !prompt.includes("\n\n\n"),
      "Expected no triple-blank-line runs in the B2C regen prompt when SIS block is absent",
    );
  });
});
