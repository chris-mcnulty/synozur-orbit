/**
 * Deterministic quality gate for AI-generated social posts.
 *
 * Prompting is the primary control, but these patterns are cheap to detect and
 * should never be persisted when a model ignores the writing brief. This is
 * intentionally narrow: it blocks repeatable AI setups without rewriting or
 * judging human-authored copy.
 */

import { SOCIAL_EDITORIAL_POLICY } from "../prompts/social-editorial-policy";

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
  { label: "binary reframe", pattern: /\b(?:(?:this|it|that|the\s+(?:question|problem|issue|challenge))\s+(?:is\s+not|isn't|isn’t)|(?:it|that)['’]s\s+not)\s+[^.!?\n]{1,100}[.!?,;—–-]\s*(?:(?:this|it|that)\s+is|(?:it|that)['’]s)\s+\S/i },
  { label: "negative listing", pattern: /(?:^|[.!?]\s+|\n)\s*not\s+(?:a|an)\s+[^.!?\n]{1,70}\.\s*not\s+(?:a|an)\s+[^.!?\n]{1,70}\./i },
  { label: "what-if reframe", pattern: /\bwhat\s+if\s+(?:i\s+told\s+you|(?:this|it|that)\s+(?:is|was|were|isn't|isn’t)\s+(?:really|actually))\b/i },
  { label: "self-answered dramatic question", pattern: /(?:^|[.!?]\s+|\n)\s*(?:the\s+(?:result|answer|secret|catch|truth)|why\s+does\s+(?:this|it)\s+matter)\s*\?\s*\S/i },
  { label: "fake-profound kicker", pattern: /\b(?:at\s+the\s+end\s+of\s+the\s+day|when\s+all\s+is\s+said\s+and\s+done|only\s+time\s+will\s+tell|the\s+future\s+belongs\s+to)\b/i },
];

/**
 * Short prompt block shared by every social-copy generation flow.
 */
export const SOCIAL_POST_NO_SLOP_RULES = SOCIAL_EDITORIAL_POLICY;

/**
 * Returns the named no-slop patterns found in generated copy. Callers should
 * check only newly generated output, never manual saves or publishing history.
 */
export function findSocialPostSlopViolations(content: string): string[] {
  // Quoted examples and links are evidence, not the author's rhetorical setup.
  const text = content
    .replace(/https?:\/\/\S+/g, "")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, "")
    .replace(/^>\s.*$/gm, "")
    .trim();
  if (!text) return [];
  return SOCIAL_POST_SLOP_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}