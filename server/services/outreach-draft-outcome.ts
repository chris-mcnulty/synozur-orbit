/** Operator-only outcomes must never become recipient-facing outreach touches. */
export type OutreachComposeCode = "OUTREACH_NEEDS_INPUT" | "OUTREACH_REFUSED" | "OUTREACH_INVALID_DRAFT";

export class OutreachComposeError extends Error {
  constructor(
    public readonly code: OutreachComposeCode,
    message: string,
    public readonly questions: string[] = [],
  ) {
    super(message);
    this.name = "OutreachComposeError";
  }
}

const assistantMeta = [
  /\b(?:I|we)\s+(?:can(?:not|'t|’t)|(?:am|are)\s+unable\s+to|won(?:'t|’t))\s+(?:help|assist|draft|write|compose|generate|create|provide)\b/i,
  /\b(?:before\s+I\s+can|(?:in\s+order|for\s+me)\s+to)\s+(?:draft|write|compose|generate|create)\b/i,
  /\b(?:I\s+need|I(?:'d|’d)\s+need|please\s+(?:provide|clarify|confirm))\b[\s\S]{0,200}\b(?:before\s+(?:drafting|writing|composing)|to\s+(?:draft|write|compose)\s+(?:this|the|an?)\s+(?:email|message|outreach))\b/i,
  /\bas\s+an?\s+(?:AI|language\s+model)\b/i,
  /\bI\s+(?:am\s+not\s+(?:able|comfortable)|have\s+to\s+decline|must\s+decline)\b/i,
];

/** Also protects approval of older saved assistant notes; no rewriting occurs. */
export function assertOutreachDraftContent(body: string, subject?: string | null): void {
  const text = [subject, body].filter(Boolean).join("\n").replace(/[’‘]/g, "'").replace(/\bI'm\b/gi, "I am");
  if (!body.trim() || /===(?:NEEDS_INPUT|REFUSED)===/i.test(text) || assistantMeta.some(pattern => pattern.test(text))) {
    throw new OutreachComposeError(
      "OUTREACH_INVALID_DRAFT",
      "Orbit received an assistant response instead of a recipient-ready message. Nothing was saved or sent. This generation failure does not require additional context.",
    );
  }
}

/** Parse explicit non-draft outcomes before looking for any recipient text. */
export function assertComposeOutcome(text: string): void {
  const outcome = text.match(/===(NEEDS_INPUT|REFUSED)===\s*([\s\S]*)/i);
  if (outcome) {
    const reason = outcome[2].trim().slice(0, 6000) || "The assistant did not produce a draft.";
    const needsInput = outcome[1].toUpperCase() === "NEEDS_INPUT";
    const questions = needsInput
      ? reason.split(/\n+/).map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
        .filter(line => line.includes("?")).slice(0, 10)
      : [];
    throw new OutreachComposeError(needsInput ? "OUTREACH_NEEDS_INPUT" : "OUTREACH_REFUSED", reason, questions);
  }
}
