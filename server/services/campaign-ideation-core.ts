/**
 * Campaign ideation — pure core.
 *
 * Builds the AI prompt that turns a user's message + scanned news + the latest
 * intelligence indicators/action items + strategic grounding into several
 * candidate campaign ideas, and parses the model's JSON back into typed ideas.
 * No I/O, so it is unit-testable.
 */

import { CAMPAIGN_TYPES, type CampaignType } from "@shared/schema";

export interface CampaignIdea {
  title: string;
  campaignType: CampaignType;
  objective: string;
  /** Suggested audience as free-text persona descriptors. */
  suggestedAudience: string[];
  rationale: string;
  /** The signals (news headlines, action items) that motivated this idea. */
  signals: string[];
}

export interface SubjectNewsInput {
  subject: string;
  headlines: { title: string; source: string; snippet: string }[];
}

export interface IdeationPromptInput {
  /** The user's own message/angle, if any. */
  message?: string;
  /** Assembled strategic-context block (MPF/GTM/personas/competitive). */
  strategicBlock: string;
  /** Latest intelligence indicators + urgent action items. */
  intelBlock: string;
  /** Scanned news per subject. */
  news: SubjectNewsInput[];
  count: number;
}

function coerceCampaignType(value: unknown): CampaignType {
  const v = String(value ?? "").trim().toLowerCase();
  return (CAMPAIGN_TYPES as readonly string[]).includes(v) ? (v as CampaignType) : "theme";
}

export function formatNewsForPrompt(news: SubjectNewsInput[]): string {
  const blocks = news
    .filter((n) => n.headlines.length > 0)
    .map((n) => {
      const lines = n.headlines
        .slice(0, 5)
        .map((h) => `  - ${h.title}${h.source ? ` (${h.source})` : ""}${h.snippet ? ` — ${h.snippet.slice(0, 160)}` : ""}`)
        .join("\n");
      return `Subject: ${n.subject}\n${lines}`;
    });
  return blocks.length ? `## Scanned news signals\n${blocks.join("\n\n")}` : "";
}

const SYSTEM_PROMPT =
  "You are a B2B marketing strategist. You propose distinct, demand-grounded campaign ideas that fit the " +
  "company's positioning and respond to real market signals. You never fabricate facts. Respond with valid JSON only.";

export function getIdeationSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildIdeationPrompt(input: IdeationPromptInput): string {
  const newsBlock = formatNewsForPrompt(input.news);
  const messageBlock = input.message?.trim()
    ? `## The marketer's intended message / angle\n${input.message.trim()}\nLean into this where it is supported by the signals; do not contradict it.`
    : "";

  return [
    `Propose ${input.count} distinct marketing campaign ideas as JSON. Each must be grounded in the company's positioning AND a real signal below (a news item, an intelligence action item, or the marketer's message).`,
    messageBlock,
    input.strategicBlock,
    input.intelBlock,
    newsBlock,
    `## Rules
- Each idea must be genuinely different (different angle, audience, or moment) — no near-duplicates.
- Tie every idea to at least one concrete signal; cite the signal text in "signals".
- Choose the most fitting campaignType: ${CAMPAIGN_TYPES.join(" | ")} (theme = ongoing awareness; event = a dated event/webinar; offering = product/service launch or spotlight).
- The objective must be specific and outcome-oriented (what we promote + why now).
- "suggestedAudience" is 1-3 short persona descriptors drawn from the personas above where possible.

## Output format
Respond with a JSON object: { "ideas": [ ... ] }. Each idea has:
- "title": string (a short campaign name)
- "campaignType": one of ${CAMPAIGN_TYPES.join(" | ")}
- "objective": string
- "suggestedAudience": string[]
- "rationale": string (why this will land now)
- "signals": string[] (the signal text(s) this responds to)`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeIdea(raw: any): CampaignIdea | null {
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const objective = typeof raw?.objective === "string" ? raw.objective.trim() : "";
  if (!title || !objective) return null;

  const strArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === "string" && v.trim()) return [v.trim()];
    return [];
  };

  return {
    title,
    campaignType: coerceCampaignType(raw?.campaignType ?? raw?.campaign_type ?? raw?.type),
    objective,
    suggestedAudience: strArray(raw?.suggestedAudience ?? raw?.suggested_audience ?? raw?.audience),
    rationale: typeof raw?.rationale === "string" ? raw.rationale.trim() : "",
    signals: strArray(raw?.signals),
  };
}

export function parseCampaignIdeas(text: string): CampaignIdea[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let arr: any[] = [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) arr = parsed;
    else if (Array.isArray(parsed?.ideas)) arr = parsed.ideas;
    else if (Array.isArray(parsed?.campaigns)) arr = parsed.campaigns;
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        arr = JSON.parse(match[0]);
      } catch {
        arr = [];
      }
    }
  }
  return arr.map(normalizeIdea).filter((i): i is CampaignIdea => i !== null);
}
