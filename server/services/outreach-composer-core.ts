/**
 * Outreach Composer — pure core.
 *
 * Assembles the composition prompt (dossier + voice + objections + the right
 * campaign resource for the step), enforces per-channel format/length
 * guardrails, and parses the model response. No I/O, so it is unit-testable;
 * the AI call + DB writes live in `outreach-composer-service.ts`.
 */

import type { OutreachChannel, CadenceStepPurpose } from "@shared/schema";
import {
  linkedinCharLimit,
  type LinkedInFormat,
  type OutreachIntent,
} from "@shared/linkedin-outreach";
import { BANNED_WORDS, STRUCTURAL_ANTI_PATTERNS } from "./copywriter-service";

export const COMPOSER_SYSTEM_PROMPT =
  `You write 1:1 B2B sales outreach in the sender's real voice. Short, direct, ` +
  `human. Lead with the person and the ask; land on one concrete next step. No ` +
  `hype, no urgency theater. Reference only facts you're given. The draft must ` +
  `be ready for a human to review and send — not a template.\n\n` +
  `Banned words and phrases — never use: ${BANNED_WORDS}; also "I hope this finds you well".\n\n` +
  STRUCTURAL_ANTI_PATTERNS + "\n\n" +
  `Additional patterns that kill 1:1 credibility — never write:\n` +
  `- Fake-strong verb openers: "Excited to share", "Thrilled to connect", "Wanted to reach out"\n` +
  `- Throat-clearing openers: "I wanted to take a moment", "I was hoping we could", "I'm reaching out because"\n` +
  `- Generic benefit claims: "help you save time/money/resources", "drive results", "boost performance" without specifics`;

export interface ComposeResource {
  label?: string | null;
  resourceType?: string | null;
  url?: string | null;
}

export interface ComposePromptInput {
  channel: OutreachChannel;
  stepNumber: number;
  purpose: CadenceStepPurpose | string;
  prospect: { name: string; title?: string | null; companyName?: string | null };
  dossier?: string | null;
  salesGoal?: string | null;
  callToAction?: string | null;
  /** Pre-formatted strategic context block (voice/positioning/objections). */
  strategicBlock?: string;
  voiceBlock?: string;
  resource?: ComposeResource | null;
  /** LinkedIn message shape — connect-request note vs direct message. */
  linkedinFormat?: LinkedInFormat | null;
  /** Draft intent — an ask (outreach) vs warm, no-ask (engagement). */
  intent?: OutreachIntent | null;
  /**
   * When the campaign is anchored to a real event, this pre-formatted block
   * carries the facts (name, date, location, URL). The model must use these
   * verbatim and never invent or substitute event details.
   */
  eventBlock?: string | null;
}

// Per-channel guardrails. LinkedIn messages must be far shorter than email; the
// exact LinkedIn ceiling depends on the message shape (connect note vs DM).
export const CHANNEL_LIMITS: Record<OutreachChannel, { maxChars: number; hasSubject: boolean }> = {
  email: { maxChars: 1500, hasSubject: true },
  linkedin: { maxChars: 600, hasSubject: false },
};

/** Resolve the char ceiling for a touch, honoring the LinkedIn message shape. */
export function channelLimit(channel: OutreachChannel, linkedinFormat?: LinkedInFormat | null): number {
  if (channel === "linkedin") return linkedinCharLimit(linkedinFormat);
  return CHANNEL_LIMITS[channel].maxChars;
}

/** Guidance the model follows for each LinkedIn message shape. */
function linkedinFormatGuidance(format: LinkedInFormat | null | undefined): string {
  if (format === "connect_request") {
    return "This is a LinkedIn connection-request note (max 300 characters). Be brief and specific about why you want to connect. Do NOT paste a URL — links aren't clickable in a connection note and waste characters; reference any resource by name only.";
  }
  return "This is a LinkedIn direct message to an existing connection. Conversational and short.";
}

/** Guidance the model follows for the draft's intent. */
function intentGuidance(intent: OutreachIntent | null | undefined): string {
  if (intent === "engagement") {
    return "Intent: ENGAGEMENT — warm and specific to their recent work, post, or role. Start a genuine conversation. Do NOT make a hard ask or pitch; no meeting request.";
  }
  return "Intent: OUTREACH — earn a reply and land on one concrete next step.";
}

const PURPOSE_GUIDANCE: Record<string, string> = {
  intro: "First touch — earn a reply. One sharp reason this is relevant to them, one light ask.",
  value: "Add a specific, concrete proof point or insight. Still short. Re-state the ask.",
  case_study: "Reference a relevant client outcome or example. Keep it factual, not boastful.",
  invite: "Invite them to the event. Make the value of attending obvious; clear RSVP ask.",
  breakup: "Last touch — brief, gracious, leave the door open. No guilt, no pressure.",
};

export function purposeGuidance(purpose: string): string {
  return PURPOSE_GUIDANCE[purpose] ?? PURPOSE_GUIDANCE.intro;
}

/** Build the composition prompt for one touch. */
export function buildComposePrompt(input: ComposePromptInput): string {
  const hasSubject = CHANNEL_LIMITS[input.channel].hasSubject;
  const maxChars = channelLimit(input.channel, input.linkedinFormat);

  const prospectBlock = [
    "## Prospect",
    `Name: ${input.prospect.name}`,
    input.prospect.title ? `Title: ${input.prospect.title}` : "",
    input.prospect.companyName ? `Company: ${input.prospect.companyName}` : "",
    input.dossier ? `\nResearch dossier:\n${input.dossier}` : "",
  ].filter(Boolean).join("\n");

  const isLinkedIn = input.channel === "linkedin";
  // A connect-request note can't carry a clickable link, so don't ask the model
  // to embed the resource URL there — name it instead.
  const resourceLine = input.resource
    ? isLinkedIn && input.linkedinFormat === "connect_request"
      ? `Reference this resource by name (no link): ${input.resource.label ?? input.resource.resourceType ?? "resource"}`
      : `Include this resource naturally: ${input.resource.label ?? input.resource.resourceType ?? "resource"}${input.resource.url ? ` (${input.resource.url})` : ""}`
    : "";

  const stepBlock = [
    "## This touch",
    `Channel: ${input.channel}`,
    isLinkedIn ? linkedinFormatGuidance(input.linkedinFormat) : "",
    intentGuidance(input.intent),
    `Step ${input.stepNumber} — purpose: ${input.purpose}`,
    purposeGuidance(String(input.purpose)),
    input.salesGoal ? `Campaign goal: ${input.salesGoal}` : "",
    input.callToAction ? `Call to action: ${input.callToAction}` : "",
    resourceLine,
  ].filter(Boolean).join("\n");

  const format = hasSubject
    ? `## Response format\nRespond with exactly these two sections and nothing else:\n===SUBJECT===\n<a specific, non-deceptive subject line, max 80 chars>\n===BODY===\n<the email body, under ${maxChars} characters, with a sign-off>`
    : `## Response format\nRespond with exactly this section and nothing else:\n===BODY===\n<the message, under ${maxChars} characters — no subject line>`;

  return [
    `Write this outreach ${input.channel === "email" ? "email" : "LinkedIn message"}.`,
    input.strategicBlock,
    input.voiceBlock,
    input.eventBlock,
    prospectBlock,
    stepBlock,
    format,
  ].filter(Boolean).join("\n\n");
}

export interface ParsedDraft {
  subject: string | null;
  body: string;
}

/** Parse the ===SUBJECT===/===BODY=== response. Falls back gracefully. */
export function parseComposeResponse(text: string, channel: OutreachChannel): ParsedDraft {
  const subjMatch = text.match(/===SUBJECT===\s*([\s\S]*?)(?:===BODY===|$)/i);
  const bodyMatch = text.match(/===BODY===\s*([\s\S]*)$/i);

  let subject = subjMatch ? subjMatch[1].trim() : null;
  let body = bodyMatch ? bodyMatch[1].trim() : text.trim();

  if (channel === "linkedin") subject = null;
  if (subject === "") subject = null;
  return { subject, body };
}

/** Hard-trim a body to the channel limit, cutting on a word boundary. */
export function enforceLength(
  body: string,
  channel: OutreachChannel,
  linkedinFormat?: LinkedInFormat | null,
): string {
  const max = channelLimit(channel, linkedinFormat);
  if (body.length <= max) return body;
  const slice = body.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…";
}
