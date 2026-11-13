import { randomUUID } from "crypto";
import type { OutreachChannel } from "@shared/schema";
import type { LinkedInFormat } from "@shared/linkedin-outreach";
import { completeForFeature, type AICompletionResult } from "./ai-provider";
import { COMPOSER_SYSTEM_PROMPT, channelLimit, parseComposeResponse } from "./outreach-composer-core";
import { ensureOutreachCopyQuality } from "./outreach-copy-quality";
import { OutreachComposeError, assertOutreachDraftContent } from "./outreach-draft-outcome";

/** Fresh generation, at most one factual-source-preserving edit and one fresh
 * regeneration. Nothing in this pipeline persists, approves or sends a message.
 */
export async function generateVerifiedOutreachDraft(opts: {
  prompt: string; tenantDomain: string; channel: OutreachChannel;
  linkedinFormat?: LinkedInFormat | null; voiceBlock?: string;
}) {
  const reference = randomUUID();
  let calls = 0, repairUsed = false;
  let lastFailure = "response format";
  const usage = { inputTokens: 0, outputTokens: 0 };
  const complete: typeof completeForFeature = async (feature, prompt, options) => {
    if (calls >= 3) throw new OutreachComposeError("OUTREACH_INVALID_DRAFT", "Automatic recovery limit reached.");
    calls++;
    const result = await completeForFeature(feature, prompt, { ...options, skipCache: true });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    return result;
  };
  for (let generation = 0; generation < 2 && calls < 3; generation++) {
    const max = channelLimit(opts.channel, opts.linkedinFormat);
    const recovery = generation ? [
      "## Automatic generation recovery",
      `The previous output failed ${lastFailure}. Generate a fresh, complete draft from the original supplied facts above, not from any rejected draft.`,
      `Keep the body under ${Math.floor(max * 0.8)} characters, including greeting, links and sign-off. Return ONLY the required complete subject/body sections. Do not add explanations or request more facts to fix a formatting or writing problem.`,
    ].join("\n") : "";
    const result: AICompletionResult = await complete("outreach_composer", [opts.prompt, recovery].filter(Boolean).join("\n\n"), {
      tenantDomain: opts.tenantDomain, systemPrompt: COMPOSER_SYSTEM_PROMPT, maxTokens: 4096,
    });
    let stage: "format" | "writing" = "format";
    try {
      const draft = parseComposeResponse(result.text, opts.channel);
      stage = "writing";
      const checked = await ensureOutreachCopyQuality({
        ...opts, draft, diagnosticReference: reference,
        complete: async (...args) => {
          if (repairUsed) throw new OutreachComposeError("OUTREACH_INVALID_DRAFT", "Writing repair was already attempted.");
          repairUsed = true;
          return complete(...args);
        },
      });
      return { draft: checked.draft, usage, model: result.model, provider: result.provider };
    } catch (error) {
      if (!(error instanceof OutreachComposeError) || error.code !== "OUTREACH_INVALID_DRAFT") throw error;
      // Never reinterpret refusals, assistant commentary or real clarification
      // questions as an invitation to generate a recipient-facing message.
      if (stage === "format" && result.text.trim()) {
        try { assertOutreachDraftContent(result.text); } catch { throw error; }
      }
      lastFailure = stage === "format" ? "response format" : "writing checks";
      console.warn("[outreach-generation] Verification failed", JSON.stringify({
        reference, stage, generation: generation + 1, calls, channel: opts.channel,
        model: result.model, provider: result.provider, responseCharacters: result.text.length,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      }));
    }
  }
  throw new OutreachComposeError("OUTREACH_INVALID_DRAFT",
    `Orbit could not verify the generated draft's ${lastFailure} after automatic recovery. Your saved brief and context are unchanged; no additional facts are required. Nothing was saved or sent. Retrying requests a fresh draft. If this repeats, share this diagnostic reference: ${reference}.`);
}
