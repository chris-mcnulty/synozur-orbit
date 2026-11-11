import { SOCIAL_EDITORIAL_POLICY } from "../prompts/social-editorial-policy";
import { findSocialPostSlopViolations } from "./social-post-writing-quality";

/** Style only. Never adds facts or overrides an engagement message's no-ask intent. */
export const OUTREACH_WRITING_RULES = [
  "Outreach writing rules:",
  "No em dashes in the subject or body. Use commas, periods, or line breaks.",
  "No hashtags or decorative bold. Use natural sentence case, preserving proper names and acronyms.",
  "Follow the selected voice profile. Preserve its distinctive vocabulary and cadence.",
  "Respect the requested intent: engagement does not require a sales CTA. Keep genuine recipient questions and specific meeting asks.",
  SOCIAL_EDITORIAL_POLICY,
].join("\n");

export function findOutreachWritingViolations(text: string): string[] {
  // Inspect prose, not URLs or quoted evidence, for rhetorical patterns.
  const prose = text.replace(/https?:\/\/\S+|"[^"\n]*"|“[^”\n]*”/g, "");
  const lines = prose.split("\n").filter(line => line.trim());
  return [...new Set([
    ...findSocialPostSlopViolations(text),
    ...lines.flatMap(findSocialPostSlopViolations),
    ...(/[—]/u.test(prose) ? ["em dash"] : []),
    ...(/(?:^|\s)#[\p{L}\p{N}_]+/u.test(prose) ? ["hashtag"] : []),
    ...(/\*\*[^*]+\*\*/.test(prose) ? ["decorative bold"] : []),
    ...(/\b(?:I hope this finds you well|excited to share|thrilled to connect|wanted to reach out|I wanted to take a moment|I was hoping we could|I'm reaching out because)\b/i.test(prose)
      ? ["generic outreach opener"] : []),
  ])];
}
