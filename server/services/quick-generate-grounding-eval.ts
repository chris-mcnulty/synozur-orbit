/**
 * High-recall checks for the optional live Quick Generate grounding eval.
 *
 * These checks deliberately flag possibilities rather than attempting to
 * prove that a phrase is false. A human reviews the compact live-eval report
 * whenever a flag is raised.
 */

export interface QuickGenerateGroundingFixture {
  id: string;
  prompt: string;
}

export type QuickGenerateGroundingFlagKind =
  | "possible_named_entity"
  | "possible_collection"
  | "possible_statistic";

export interface QuickGenerateGroundingFlag {
  kind: QuickGenerateGroundingFlagKind;
  value: string;
  excerpt: string;
}

/**
 * Sparse prompts make it conspicuous when a model fills in missing background.
 * They cover an event, a class with quantities, and a named installation.
 */
export const QUICK_GENERATE_EVAL_FIXTURES: readonly QuickGenerateGroundingFixture[] = [
  {
    id: "airfield-estates-event",
    prompt:
      "I'm showing three pieces at Airfield Estates in Woodinville through September — promote the event and thank the Woodinville Arts Alliance for sponsoring.",
  },
  {
    id: "northbridge-workshop",
    prompt:
      "Northbridge Studio will hold a ceramics workshop at 12 River Lane on October 14. Visitors can reserve one of 24 seats for $35.",
  },
  {
    id: "blue-thread-installation",
    prompt:
      "Mira Patel is bringing the 'Blue Thread' installation to Harbor Room from May 3 to May 18. Opening night is May 3 at 6 pm.",
  },
];

const NUMBER_WORD_VALUES: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
  thousand: 1000,
  million: 1_000_000,
};

const NUMBER_TOKEN = /(?:[$€£]\s*)?\d[\d,]*(?:\.\d+)?(?:\s*%|\s*(?:percent|per\s*cent))?/gi;
const NUMBER_WORD_TOKEN = new RegExp(`\\b(?:${Object.keys(NUMBER_WORD_VALUES).join("|")})\\b`, "gi");
const QUOTED_TEXT = /["“”'‘’]([^"“”'‘’\n]{2,80})["“”'‘’]/g;
const TITLE_CASE_PHRASE =
  /\b(?:[A-Z][\p{L}'’-]*|[A-Z]{2,})(?:\s+(?:&|and|of|the|at|in)\s+|\s+)(?:[A-Z][\p{L}'’-]*|[A-Z]{2,})(?:\s+(?:&|and|of|the|at|in)\s+|\s+(?:[A-Z][\p{L}'’-]*|[A-Z]{2,}))?/gu;
const ACRONYM = /\b[A-Z]{2,}(?:-[A-Z]{2,})?\b/g;
const COLLECTION_TERM = /\b(?:collection|series|product line|edition|range)\b/gi;
const STATISTIC_CLAIM =
  /\b(?:award-winning|best-selling|record-breaking|most popular|majority|dozens?|hundreds?|thousands?|millions?|double[ds]?|tripled|increased|grew|growth)\b/gi;
const GENERIC_TITLE_STARTS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "our",
  "your",
  "join",
  "discover",
  "celebrate",
  "welcome",
  "meet",
  "see",
  "read",
  "explore",
  "learn",
  "from",
  "on",
  "in",
  "at",
]);

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function hasSourcePhrase(prompt: string, value: string): boolean {
  return normalize(prompt).includes(normalize(value));
}

function excerptFor(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 52);
  const end = Math.min(text.length, index + length + 52);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function canonicalNumber(value: string): string {
  const numeric = Number(value.replace(/[$€£,\s%]/g, "").replace(/percent|per\s*cent/gi, ""));
  return Number.isFinite(numeric) ? String(numeric) : normalize(value);
}

function sourceNumberValues(prompt: string): Set<string> {
  const numbers = new Set<string>();
  for (const match of prompt.matchAll(NUMBER_TOKEN)) numbers.add(canonicalNumber(match[0]));
  for (const match of prompt.matchAll(NUMBER_WORD_TOKEN)) {
    numbers.add(String(NUMBER_WORD_VALUES[match[0].toLowerCase()]));
  }
  return numbers;
}

/**
 * Flag terms that look like added names, collection labels, or statistics.
 * This is a high-recall heuristic: a flag demands review, but is not itself a
 * claim that the output fabricated a fact.
 */
export function scanQuickGenerateGrounding(
  fixture: QuickGenerateGroundingFixture,
  output: string,
): QuickGenerateGroundingFlag[] {
  const flags: QuickGenerateGroundingFlag[] = [];
  const seen = new Set<string>();
  const add = (kind: QuickGenerateGroundingFlagKind, value: string, index: number) => {
    const key = `${kind}:${normalize(value)}`;
    if (seen.has(key) || hasSourcePhrase(fixture.prompt, value)) return;
    seen.add(key);
    flags.push({ kind, value: value.trim(), excerpt: excerptFor(output, index, value.length) });
  };

  for (const match of output.matchAll(QUOTED_TEXT)) {
    add("possible_named_entity", match[1], match.index ?? 0);
  }

  for (const match of output.matchAll(TITLE_CASE_PHRASE)) {
    const firstWord = match[0].trim().split(/\s+/)[0].toLowerCase();
    if (!GENERIC_TITLE_STARTS.has(firstWord)) add("possible_named_entity", match[0], match.index ?? 0);
  }

  for (const match of output.matchAll(ACRONYM)) {
    add("possible_named_entity", match[0], match.index ?? 0);
  }

  for (const match of output.matchAll(COLLECTION_TERM)) {
    add("possible_collection", match[0], match.index ?? 0);
  }

  const allowedNumbers = sourceNumberValues(fixture.prompt);
  for (const match of output.matchAll(NUMBER_TOKEN)) {
    if (!allowedNumbers.has(canonicalNumber(match[0]))) {
      add("possible_statistic", match[0], match.index ?? 0);
    }
  }
  for (const match of output.matchAll(NUMBER_WORD_TOKEN)) {
    const value = NUMBER_WORD_VALUES[match[0].toLowerCase()];
    if (!allowedNumbers.has(String(value))) add("possible_statistic", match[0], match.index ?? 0);
  }
  for (const match of output.matchAll(STATISTIC_CLAIM)) {
    add("possible_statistic", match[0], match.index ?? 0);
  }

  return flags;
}