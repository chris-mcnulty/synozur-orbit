/**
 * Outbound Voice service.
 *
 * Extracts a seller's personal "voice DNA" from their own Outlook Sent Items
 * (via the delegated Graph token) and stores it as a per-user voice profile so
 * outreach drafts sound like that person — the Cowork `outbound-voice` skill,
 * but grounded in real sent mail instead of a hand-authored descriptor.
 */

import { db } from "../db";
import {
  socialAccountVoiceProfiles,
  type SocialAccountVoiceProfile,
  type VoiceToneAttributes,
  type VoiceSampleSnippet,
} from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getValidGraphToken } from "./planner-graph-client";
import { completeForFeature } from "./ai-provider";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MIN_SAMPLES = 5;

export class VoiceExtractError extends Error {
  constructor(message: string, readonly code: "no_consent" | "forbidden" | "insufficient_samples" | "graph_error") {
    super(message);
    this.name = "VoiceExtractError";
  }
}

interface SentMessage {
  subject: string;
  bodyPreview: string;
}

async function fetchSentMessages(token: string, top = 25): Promise<SentMessage[]> {
  const url = `${GRAPH_BASE}/me/mailFolders/SentItems/messages?$top=${top}&$select=subject,bodyPreview&$orderby=sentDateTime%20desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403) {
    throw new VoiceExtractError("Mailbox read permission not granted — reconnect your mailbox.", "forbidden");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VoiceExtractError(`Graph error reading Sent Items (${res.status}): ${detail.slice(0, 200)}`, "graph_error");
  }
  const data = (await res.json()) as { value?: { subject?: string; bodyPreview?: string }[] };
  return (data.value ?? []).map((m) => ({ subject: m.subject ?? "", bodyPreview: m.bodyPreview ?? "" }));
}

const SYSTEM_PROMPT =
  `You are a writing-voice analyst. From a sample of one person's real sent emails, ` +
  `extract how they actually write so an assistant can draft in their voice. Be specific ` +
  `and evidence-based — infer only from the samples. Respond with STRICT JSON only.`;

interface ExtractedVoice {
  tone: VoiceToneAttributes;
  styleGuidance: string;
  preferredPhrases: string[];
  forbiddenPhrases: string[];
  sampleSnippets: VoiceSampleSnippet[];
}

function parseVoiceJson(text: string): ExtractedVoice {
  // Strip markdown fences if present, then take the first {...} block.
  const cleaned = text.replace(/```json\s*|\s*```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const raw = JSON.parse(json) as Partial<ExtractedVoice>;

  const clampNum = (n: unknown): number | undefined =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : undefined;

  return {
    tone: {
      formal: clampNum(raw.tone?.formal),
      playful: clampNum(raw.tone?.playful),
      technical: clampNum(raw.tone?.technical),
      warm: clampNum(raw.tone?.warm),
      bold: clampNum(raw.tone?.bold),
    },
    styleGuidance: typeof raw.styleGuidance === "string" ? raw.styleGuidance.slice(0, 2000) : "",
    preferredPhrases: Array.isArray(raw.preferredPhrases) ? raw.preferredPhrases.map(String).slice(0, 15) : [],
    forbiddenPhrases: Array.isArray(raw.forbiddenPhrases) ? raw.forbiddenPhrases.map(String).slice(0, 15) : [],
    sampleSnippets: Array.isArray(raw.sampleSnippets)
      ? raw.sampleSnippets
          .filter((s: any) => s && typeof s.content === "string")
          .slice(0, 5)
          .map((s: any) => ({ label: typeof s.label === "string" ? s.label : undefined, content: String(s.content).slice(0, 500) }))
      : [],
  };
}

export interface ExtractVoiceResult {
  profile: SocialAccountVoiceProfile;
  sampleCount: number;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
}

/** Find a seller's personal voice profile (ownerUserId set, no social account). */
export async function getPersonalVoiceProfile(userId: string): Promise<SocialAccountVoiceProfile | undefined> {
  const [row] = await db
    .select()
    .from(socialAccountVoiceProfiles)
    .where(and(eq(socialAccountVoiceProfiles.ownerUserId, userId), isNull(socialAccountVoiceProfiles.socialAccountId)));
  return row;
}

/** Extract the seller's voice from Sent Items and upsert their personal profile. */
export async function extractOutboundVoice(userId: string, tenantDomain: string): Promise<ExtractVoiceResult> {
  const token = await getValidGraphToken(userId);
  if (!token) {
    throw new VoiceExtractError("Your mailbox isn't connected. Connect it in outreach settings.", "no_consent");
  }

  const messages = await fetchSentMessages(token);
  if (messages.length < MIN_SAMPLES) {
    throw new VoiceExtractError(
      `Only ${messages.length} sent message(s) found — need at least ${MIN_SAMPLES} to extract a reliable voice.`,
      "insufficient_samples",
    );
  }

  const samples = messages
    .map((m, i) => `--- Email ${i + 1} ---\nSubject: ${m.subject}\n${m.bodyPreview}`)
    .join("\n\n");

  const prompt = [
    `Analyze these ${messages.length} real sent emails and extract the writer's voice.`,
    samples,
    `## Respond with STRICT JSON in exactly this shape:
{
  "tone": { "formal": 0.0-1.0, "playful": 0.0-1.0, "technical": 0.0-1.0, "warm": 0.0-1.0, "bold": 0.0-1.0 },
  "styleGuidance": "2-4 sentences on cadence, structure, greetings, sign-offs",
  "preferredPhrases": ["signature words/phrases they actually use"],
  "forbiddenPhrases": ["phrases that would sound nothing like them"],
  "sampleSnippets": [{ "label": "opener|signoff|ask", "content": "a short verbatim-style example" }]
}`,
  ].join("\n\n");

  const result = await completeForFeature("outreach_voice_extract", prompt, {
    tenantDomain,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 1200,
  });

  const voice = parseVoiceJson(result.text);

  const existing = await getPersonalVoiceProfile(userId);
  const values = {
    tenantDomain,
    ownerUserId: userId,
    socialAccountId: null,
    person: "first" as const,
    authorPerspective: "individual" as const,
    toneAttributes: voice.tone,
    styleGuidance: voice.styleGuidance,
    forbiddenPhrases: voice.forbiddenPhrases,
    preferredPhrases: voice.preferredPhrases,
    sampleSnippets: voice.sampleSnippets,
    createdBy: userId,
    updatedAt: new Date(),
  };

  let profile: SocialAccountVoiceProfile;
  if (existing) {
    const [updated] = await db
      .update(socialAccountVoiceProfiles)
      .set(values)
      .where(eq(socialAccountVoiceProfiles.id, existing.id))
      .returning();
    profile = updated;
  } else {
    const [created] = await db.insert(socialAccountVoiceProfiles).values(values).returning();
    profile = created;
  }

  return {
    profile,
    sampleCount: messages.length,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
    provider: result.provider,
  };
}
