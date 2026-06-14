/**
 * Outreach Composer — pure core.
 *
 * Assembles the composition prompt (dossier + voice + objections + the right
 * campaign resource for the step), enforces per-channel format/length
 * guardrails, and parses the model response. No I/O, so it is unit-testable;
 * the AI call + DB writes live in `outreach-composer-service.ts`.
 */

import type { OutreachChannel, CadenceStepPurpose } from "@shared/schema";

export const COMPOSER_SYSTEM_PROMPT =
  `You write 1:1 B2B sales outreach in the sender's real voice. Short, direct, ` +
  `human. Lead with the person and the ask; land on one concrete next step. No ` +
  `hype, no AI clichés ("circle back", "touch base", "leverage", "I hope this ` +
  `finds you well"), no urgency theater. Reference only facts you're given. The ` +
  `draft must be ready for a human to review and send — not a template.`;

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
}

// Per-channel guardrails. LinkedIn messages must be far shorter than email.
export const CHANNEL_LIMITS: Record<OutreachChannel, { maxChars: number; hasSubject: boolean }> = {
  email: { maxChars: 1500, hasSubject: true },
  linkedin: { maxChars: 600, hasSubject: false },
};

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
  const limits = CHANNEL_LIMITS[input.channel];

  const prospectBlock = [
    "## Prospect",
    `Name: ${input.prospect.name}`,
    input.prospect.title ? `Title: ${input.prospect.title}` : "",
    input.prospect.companyName ? `Company: ${input.prospect.companyName}` : "",
    input.dossier ? `\nResearch dossier:\n${input.dossier}` : "",
  ].filter(Boolean).join("\n");

  const stepBlock = [
    "## This touch",
    `Channel: ${input.channel}`,
    `Step ${input.stepNumber} — purpose: ${input.purpose}`,
    purposeGuidance(String(input.purpose)),
    input.salesGoal ? `Campaign goal: ${input.salesGoal}` : "",
    input.callToAction ? `Call to action: ${input.callToAction}` : "",
    input.resource
      ? `Include this resource naturally: ${input.resource.label ?? input.resource.resourceType ?? "resource"}${input.resource.url ? ` (${input.resource.url})` : ""}`
      : "",
  ].filter(Boolean).join("\n");

  const format = limits.hasSubject
    ? `## Response format\nRespond with exactly these two sections and nothing else:\n===SUBJECT===\n<a specific, non-deceptive subject line, max 80 chars>\n===BODY===\n<the email body, under ${limits.maxChars} characters, with a sign-off>`
    : `## Response format\nRespond with exactly this section and nothing else:\n===BODY===\n<the message, under ${limits.maxChars} characters — no subject line>`;

  return [
    `Write this outreach ${input.channel === "email" ? "email" : "LinkedIn message"}.`,
    input.strategicBlock,
    input.voiceBlock,
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
export function enforceLength(body: string, channel: OutreachChannel): string {
  const max = CHANNEL_LIMITS[channel].maxChars;
  if (body.length <= max) return body;
  const slice = body.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + "…";
}
