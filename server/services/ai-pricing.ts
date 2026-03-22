import { AI_MODEL_INFO } from "@shared/schema";

type PricingTier = {
  inputPer1M: number;
  outputPer1M: number;
};

const MODEL_PRICING: Record<string, PricingTier> = {
  "gpt-5.4": { inputPer1M: 5.0, outputPer1M: 15.0 },
  "gpt-5.2": { inputPer1M: 5.0, outputPer1M: 15.0 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4-turbo": { inputPer1M: 10.0, outputPer1M: 30.0 },
  "gpt-4": { inputPer1M: 30.0, outputPer1M: 60.0 },
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  "claude-sonnet-4-5": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-sonnet-4-5-20250514": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0 },
  "claude-sonnet-4": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-opus-4": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-5-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-opus": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25 },
};

const DEFAULT_PRICING: PricingTier = { inputPer1M: 3.0, outputPer1M: 15.0 };

const ZERO_COST_PROVIDERS = new Set(['azure_foundry']);

export function calculateEstimatedCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider?: string,
): string {
  if (provider && ZERO_COST_PROVIDERS.has(provider)) {
    return "0.000000";
  }

  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const modelInfo = AI_MODEL_INFO[model];
    if (modelInfo) {
      pricing = {
        inputPer1M: modelInfo.costPer1kPrompt * 1000,
        outputPer1M: modelInfo.costPer1kCompletion * 1000,
      };
    }
  }
  if (!pricing) pricing = DEFAULT_PRICING;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  const totalCost = inputCost + outputCost;

  return totalCost.toFixed(6);
}

export function getModelPricing(model: string): PricingTier {
  return MODEL_PRICING[model] || DEFAULT_PRICING;
}

export function formatCostDollars(costString: string): string {
  const dollars = parseFloat(costString);
  if (isNaN(dollars)) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(6)}`;
  if (dollars < 1) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
