/**
 * Optional, quota-consuming integration evaluation for Quick Generate.
 *
 * It runs the three production drafting paths against a configured live
 * provider, using sparse fixture prompts. It fails on high-recall grounding
 * flags and prints every output so a reviewer can decide whether any flag is
 * a true fabrication. It never runs in the normal test suite.
 *
 * Enable with:
 *   npm run test:quick-generate-live-eval
 *
 * Optional overrides:
 *   QUICK_GENERATE_EVAL_PROVIDER=replit_anthropic
 *   QUICK_GENERATE_EVAL_MODEL=claude-sonnet-4-5
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));

vi.mock("../strategic-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../strategic-context")>();
  return {
    ...actual,
    loadStrategicContext: vi.fn().mockResolvedValue({ brandIdentity: "" }),
  };
});

// The production service functions call completeForFeature. The live eval
// replaces only that DB-configured resolver with a direct call to the selected
// real provider, so it exercises the real prompt builders and response parsers
// without requiring an AI configuration row or using a cached result.
vi.mock("../ai-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai-provider")>();
  return { ...actual, completeForFeature: vi.fn() };
});

import { AI_MODELS, AI_PROVIDERS } from "@shared/schema";
import { completeForFeature, getProvider } from "../ai-provider";
import {
  QUICK_GENERATE_EVAL_FIXTURES,
  scanQuickGenerateGrounding,
} from "../quick-generate-grounding-eval";
import {
  quickDraftBlog,
  quickDraftNewsletter,
  quickDraftSocialPosts,
} from "../quick-generate-service";

const enabled = process.env.RUN_QUICK_GENERATE_LIVE_EVAL === "1";
const liveDescribe = enabled ? describe : describe.skip;
const providerKey = process.env.QUICK_GENERATE_EVAL_PROVIDER ?? AI_PROVIDERS.REPLIT_ANTHROPIC;
const model = process.env.QUICK_GENERATE_EVAL_MODEL ?? "claude-sonnet-4-5";

function flattenOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenOutput).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(flattenOutput).filter(Boolean).join("\n");
  }
  return "";
}

liveDescribe(
  "Quick Generate grounding against a live model",
  () => {
    beforeAll(() => {
      const provider = getProvider(providerKey);
      if (!provider) throw new Error(`Unknown QUICK_GENERATE_EVAL_PROVIDER: ${providerKey}`);
      if (!provider.isAvailable()) {
        throw new Error(`Quick Generate live eval provider "${providerKey}" is unavailable in this environment.`);
      }
      if (!(AI_MODELS[providerKey] ?? []).includes(model)) {
        throw new Error(`Model "${model}" is not configured for provider "${providerKey}".`);
      }

      vi.mocked(completeForFeature).mockImplementation(async (_feature, userPrompt, options) =>
        provider.complete(model, userPrompt, {
          systemPrompt: options?.systemPrompt,
          maxTokens: options?.maxTokens,
          temperature: 0,
        }),
      );
    });

    for (const fixture of QUICK_GENERATE_EVAL_FIXTURES) {
      it(
        `${fixture.id} stays within the prompt's facts`,
        async () => {
          const ctx = {
            tenantDomain: "quick-generate-live-eval.invalid",
            prompt: fixture.prompt,
            isDefaultMarket: true,
          };
          const [social, newsletter, blog] = await Promise.all([
            quickDraftSocialPosts({ ...ctx, platforms: ["linkedin"], count: 1 }),
            quickDraftNewsletter(ctx),
            quickDraftBlog(ctx),
          ]);

          const outputs = [
            { deliverable: "social", text: flattenOutput(social.posts) },
            { deliverable: "newsletter", text: flattenOutput(newsletter) },
            { deliverable: "blog", text: flattenOutput(blog) },
          ];
          const flags = outputs.flatMap(({ deliverable, text }) =>
            scanQuickGenerateGrounding(fixture, text).map((flag) => ({ deliverable, ...flag })),
          );

          // This report is intentional: heuristic flags require a human to
          // inspect the live output before treating a provider drift as a bug.
          console.info(
            "[quick-generate-live-eval]",
            JSON.stringify({ fixture: fixture.id, provider: providerKey, model, outputs, flags }, null, 2),
          );
          expect(flags, `Grounding flags for ${fixture.id}; inspect the printed live-eval report.`).toEqual([]);
        },
        120_000,
      );
    }
  },
  390_000,
);