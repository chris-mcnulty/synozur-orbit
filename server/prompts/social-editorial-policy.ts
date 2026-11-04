/**
 * Canonical social-copy editorial policy.
 * Adapted from petergyang/no-ai-slop (MIT), supplied by the project owner.
 * This is style guidance, never a factual source or a tenant voice profile.
 * Keep agent workflow instructions and editor changelogs out of published copy.
 */
export const SOCIAL_EDITORIAL_POLICY = [
  'Do not open with a question, "hot take," "unpopular opinion," "what if," "did you know," or any other rhetorical setup.',
  'Avoid binary contrasts: "This is not X. It is Y", "The question isn’t X, it’s Y", "not just X but Y", and "Not a X. Not a Y. A Z." State the substantive point directly.',
  'Do not use "What if I told you", "What if this is really that", self-answered dramatic questions, throat-clearing, faux-insight setups, colon-reveal drama, importance puffery, fake-profound kickers, or summary-recap endings.',
  "Start with a concrete fact, specific observation, practical tradeoff, or lesson grounded in the supplied material. Do not invent personal experience.",
  "Name the mechanism, decision, detail, or consequence. Remove generic industry commentary, decorative metaphors, vague attribution, audience flattery, and empty marketing claims.",
  "Avoid synonym cycling, robotic rhythm, stacked dramatic fragments, and lists of three unless the substance calls for three. Preserve natural cadence, useful uncertainty, and real tradeoffs.",
  "Prefer direct verbs and specific language. Avoid corporate filler, but preserve precise technical terms, product names, literal uses, and attributed quotations. Never remove a word solely because it appears on a generic banned-word list.",
  "Preserve all supplied facts, names, numbers, dates, URLs, quotations, and the intended action. Add no claims, examples, statistics, quotes, or opinions. Style rules supply NO facts.",
  "Follow the supplied brand voice and channel constraints. Do not impose another brand's tone, a mandatory sales CTA, hashtags, or decorative formatting.",
  "Before returning, check for these patterns and fix only affected sentences. Preserve meaning and unaffected copy. Return only the requested output format, never an evaluation or What changed section.",
].join("\n- ");
