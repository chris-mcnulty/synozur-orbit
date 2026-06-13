/**
 * Outreach Compliance — pure scanning core.
 *
 * Every generated draft is scanned before a human approves it. This is the
 * Cowork `compliance` skill + the "AI-cliché removal" requirement: it catches
 * banned phrases / AI slop, blocks suppressed or self-addressed recipients, and
 * runs light CAN-SPAM structural checks. No I/O, so it is unit-testable; the
 * suppression list + own-domains are passed in by the service.
 */

export type ComplianceFlagKind =
  | "cliche"
  | "banned_phrase"
  | "suppression"
  | "self_email"
  | "can_spam";

export interface ComplianceFlag {
  kind: ComplianceFlagKind;
  detail: string;
}

export interface ComplianceResult {
  /** False when a HARD blocker is present (suppression / self-email). */
  pass: boolean;
  flags: ComplianceFlag[];
  suggestedFixes: string[];
}

export interface ComplianceInput {
  channel: "email" | "linkedin";
  subject?: string | null;
  body: string;
  recipientEmail?: string | null;
  /** Lowercased suppressed addresses (unsubscribe/bounce/spam/manual). */
  suppressedEmails?: string[];
  /** Tenant's own domains, e.g. ["synozur.com"] — guards against self-email. */
  ownDomains?: string[];
  /** Extra forbidden phrases from the voice profile. */
  forbiddenPhrases?: string[];
}

// AI-slop / hype register to strip. Drawn from the SYNOZUR voice guidelines'
// "banned register" plus the usual LLM tells. Matched case-insensitively as
// whole-ish phrases.
export const DEFAULT_CLICHES: string[] = [
  "circle back",
  "touch base",
  "synergy",
  "move the needle",
  "deep dive",
  "world-class",
  "game-changer",
  "game changer",
  "in today's fast-paced world",
  "in the ever-evolving",
  "ever-changing landscape",
  "i hope this email finds you well",
  "i hope this message finds you well",
  "delve",
  "tapestry",
  "unlock the power",
  "unlock the potential",
  "elevate your",
  "seamless",
  "navigate the complexities",
  "it's worth noting",
  "at the end of the day",
  "robust solution",
  "cutting-edge",
  "paradigm shift",
  "low-hanging fruit",
  "boil the ocean",
];

// "leverage" as a verb is banned, but "leverage" the noun is fine. Match the
// unambiguous verb forms, plus base "leverage" only in a verb context (preceded
// by to/and/we/they/you/can/will/let's…) so "real leverage" (noun) is allowed.
const LEVERAGE_VERB =
  /\b(?:leverages|leveraged|leveraging)\b|\b(?:to|and|we|they|you|i|can|will|would|should|please|let's|lets|'ll)\s+leverage\b/i;

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function findPhrases(haystack: string, phrases: string[]): string[] {
  const lower = haystack.toLowerCase();
  const hits: string[] = [];
  for (const p of phrases) {
    const pn = p.trim().toLowerCase();
    if (pn && lower.includes(pn)) hits.push(p.trim());
  }
  return Array.from(new Set(hits));
}

/**
 * Scan a draft. Suppression and self-email are HARD blockers (pass=false);
 * clichés, banned phrases, and CAN-SPAM issues are advisory flags.
 */
export function scanCompliance(input: ComplianceInput): ComplianceResult {
  const flags: ComplianceFlag[] = [];
  const suggestedFixes: string[] = [];
  const text = `${input.subject ?? ""}\n${input.body ?? ""}`;

  // ── Hard blockers ──────────────────────────────────────────────────────────
  const recipient = (input.recipientEmail ?? "").trim().toLowerCase();
  if (recipient) {
    if ((input.suppressedEmails ?? []).includes(recipient)) {
      flags.push({ kind: "suppression", detail: `${recipient} is on the suppression list.` });
    }
    if ((input.ownDomains ?? []).map((d) => d.toLowerCase()).includes(domainOf(recipient))) {
      flags.push({ kind: "self_email", detail: `${recipient} is an internal address — don't send outreach to your own domain.` });
    }
  }

  // ── Advisory: clichés / AI slop ─────────────────────────────────────────────
  const clicheHits = findPhrases(text, DEFAULT_CLICHES);
  if (LEVERAGE_VERB.test(text)) clicheHits.push("leverage (verb)");
  for (const c of clicheHits) {
    flags.push({ kind: "cliche", detail: `Cliché / AI-slop: "${c}"` });
  }
  if (clicheHits.length > 0) {
    suggestedFixes.push("Rewrite the flagged phrases in plain, direct language — short declaratives, no hype.");
  }

  // ── Advisory: voice-profile forbidden phrases ───────────────────────────────
  const bannedHits = findPhrases(text, input.forbiddenPhrases ?? []);
  for (const b of bannedHits) {
    flags.push({ kind: "banned_phrase", detail: `Forbidden by voice profile: "${b}"` });
  }

  // ── Advisory: CAN-SPAM structural (email only) ──────────────────────────────
  if (input.channel === "email") {
    if (!(input.subject ?? "").trim()) {
      flags.push({ kind: "can_spam", detail: "Email has no subject line." });
      suggestedFixes.push("Add a clear, non-deceptive subject line.");
    }
    if ((input.subject ?? "").length > 120) {
      flags.push({ kind: "can_spam", detail: "Subject line is very long (>120 chars)." });
    }
  }

  const hardBlock = flags.some((f) => f.kind === "suppression" || f.kind === "self_email");
  return { pass: !hardBlock, flags, suggestedFixes: Array.from(new Set(suggestedFixes)) };
}
