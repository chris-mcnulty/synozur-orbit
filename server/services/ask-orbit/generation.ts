import Anthropic from "@anthropic-ai/sdk";
import type { RequestContext } from "../../context";
import type { OrbitAnswer, OrbitSource } from "@shared/ask-orbit";
import { logAiUsage } from "../ai-usage-logger";
import { SYSTEM_PROMPT, validateAnswer } from "./grounding";

export const ASK_ORBIT_MODEL = "claude-sonnet-4-5";

/** Same managed Anthropic convention as intelligence briefings, without SDK
 * retries or caches: one reservation authorizes at most one provider attempt. */
export async function generateAnswer(
  ctx: RequestContext,
  question: string,
  history: string[],
  sources: OrbitSource[],
  signal: AbortSignal,
  attemptId: string,
): Promise<OrbitAnswer> {
  const start = Date.now();
  let input = 0, output = 0, outcome = "failed";
  try {
    signal.throwIfAborted();
    const client = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      maxRetries: 0,
      timeout: 120_000,
    });
    const stream = await client.messages.create({
      model: ASK_ORBIT_MODEL, max_tokens: 2400, stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify({
        priorQuestions: history.slice(-6).map(q => q.slice(0, 2000)),
        question,
        evidence: sources.map(s => ({ sourceId: s.sourceId, title: s.title, date: s.date, stale: s.stale, text: s.text })),
      }) }],
    }, { signal });
    let raw = "";
    for await (const event of stream) {
      signal.throwIfAborted();
      if (event.type === "message_start") {
        input = event.message.usage.input_tokens;
        output = event.message.usage.output_tokens;
      }
      if (event.type === "message_delta") output = event.usage.output_tokens;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        raw += event.delta.text;
        if (raw.length > 24_000) throw new Error("Answer exceeded its safety limit.");
      }
    }
    signal.throwIfAborted();
    const answer = validateAnswer(raw.trim(), sources);
    outcome = "completed";
    return answer;
  } finally {
    if (signal.aborted) outcome = "cancelled";
    await logAiUsage(ctx, "ask_orbit", "anthropic", ASK_ORBIT_MODEL,
      { input_tokens: input, output_tokens: output }, Date.now() - start,
      { attemptId, outcome, tokensMayBeIncomplete: outcome !== "completed" });
  }
}
