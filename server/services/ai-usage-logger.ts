/**
 * Lightweight AI usage logger for background services.
 *
 * Background services (briefing generation, social monitoring, website monitoring,
 * executive summaries, full regeneration) cannot import from server/routes/helpers.ts
 * without creating a circular dependency. This standalone module lets them call
 * storage.logAiUsage() with the same cost-calculation logic as the route-level helper.
 */

import { storage } from "../storage";
import { calculateEstimatedCost } from "./ai-pricing";

export interface AiUsageContext {
  tenantDomain?: string | null;
  marketId?: string | null;
  userId?: string | null;
}

export async function logAiUsage(
  ctx: AiUsageContext,
  operation: string,
  provider: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | undefined,
  durationMs?: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    // Anthropic uses input_tokens/output_tokens; OpenAI uses prompt_tokens/completion_tokens
    const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
    const estimatedCost = calculateEstimatedCost(model, inputTokens, outputTokens, provider);

    await storage.logAiUsage({
      tenantDomain: ctx.tenantDomain ?? null,
      marketId: ctx.marketId ?? null,
      userId: ctx.userId ?? null,
      provider,
      model,
      operation,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost,
      durationMs: durationMs ?? null,
      ...(metadata ? { metadata } : {}),
    });
  } catch (error) {
    // Usage logging must never throw — a logging failure should not abort the AI operation
    console.error("[AI Usage Logger] Failed to log usage:", error);
  }
}
