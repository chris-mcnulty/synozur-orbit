/**
 * Deterministic quality gate for AI-generated social posts.
 *
 * Prompting is the primary control, but these patterns are cheap to detect and
 * should never be persisted when a model ignores the writing brief. This is
 * intentionally narrow: it blocks repeatable AI setups without rewriting or
 * judging human-authored copy.
 */

type SlopPattern = {
  label: string;
  pattern: RegExp;
};

const SOCIAL_POST_SLOP_PATTERNS: SlopPattern[] = [
  { label: "hot-take opener", pattern: /^\s*(?:hot\s+take|unpopular\s+opinion|controversial\s+opinion)\s*[:!-]?\s*/i },
  { label: "what-if opener", pattern: /^\s*what\s+if\b/i },
  { label: "rhetorical setup", pattern: /^\s*(?:did\s+you\s+know|think\s+about\s+it|plot\s+twist)\s*[:!?-]?\s*/i },
  { label: "faux-insight opener", pattern: /^\s*(?:here(?:'s| is)\s+the\s+thing|what\s+(?:most|many)\s+people\s+(?:miss|don't\s+realize)|the\s+real\s+question\s+is)\b/i },
  { label: "throat-clearing opener", pattern: /^\s*(?:in\s+(?:today'?s|a)\b.{0,60}\b(?:world|landscape)|it'?s\s+no\s+secret|now\s+more\s+than\s+ever|as\s+we\s+all\s+know|in\s+an\s+era\s+of)\b/i },
  { label: "binary contrast", pattern: /\bnot\s+(?:just|only)\b[\s\S]{1,140}?\bbut\s+(?:also\s+)?\b/i },
  { label: "fake-profound kicker", pattern: /\b(?:at\s+the\s+end\s+of\s+the\s+day|when\s+all\s+is\s+said\s+and\s+done|only\s+time\s+will\s+tell|the\s+future\s+belongs\s+to)\b/i },
];

/**
 * Short prompt block shared by every social-copy generation flow.
 */
export const SOCIAL_POST_NO_SLOP_RULES = [
  "Do not open with a question, \"hot take,\" \"unpopular opinion,\" \"what if,\" \"did you know,\" or any other rhetorical setup.",
  "Do not use throat-clearing, faux-insight setups, binary contrasts, colon-reveal drama, importance puffery, fake-profound kickers, or summary-recap endings.",
  "Start with a concrete fact, specific observation, practical tradeoff, or hard-won lesson grounded in the supplied material.",
  "Do not write generic industry commentary. Name the mechanism, decision, detail, or consequence that makes the point worth reading.",
].join("\n- ");

/**
 * Returns the named no-slop patterns found in generated copy. Callers should
 * reject AI output with a violation, rather than silently rewriting it.
 */
export function findSocialPostSlopViolations(content: string): string[] {
  const text = content.trim();
  if (!text) return [];
  return SOCIAL_POST_SLOP_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}