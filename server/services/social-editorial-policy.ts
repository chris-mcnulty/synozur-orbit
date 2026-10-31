/**
 * Platform presentation rules, independent of brand voice and factual sources.
 * These rules also run at delivery boundaries, where URLs can be reintroduced.
 */
export const INSTAGRAM_EDITORIAL_GUIDE =
  "Instagram feed: default to 30-80 words, with one concrete opening observation and short paragraphs. " +
  "Do not expand a thin source into an essay. Longer captions are appropriate only when explicitly requested. " +
  "Do not lead with price unless the post explicitly announces an offer. " +
  "No raw URLs, tracking links, or markdown links in the caption. Keep source URLs as metadata, not copy. " +
  "Do not claim 'link in bio' or 'shop in bio': the profile destination has not been verified. " +
  "A CTA is optional; finish on a relevant detail rather than forcing a purchase, question, or 'follow for more'. " +
  "Never invent an anecdote, personal experience, dates, elapsed years, materials, exhibition details, or image details. " +
  "Use only supplied evidence, not assumptions about an image you have not inspected.";

export function isCascadiaAccount(accountName: string): boolean {
  // Match the publishing identity, never mentions of a competitor in grounding.
  const identity = accountName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(?:cascadia|cascadiaoceanic)(?:photography)?(?:instagram|facebook|linkedin|twitter|x)?$/.test(identity);
}

export function accountEditorialGuide(accountName: string): string {
  if (!isCascadiaAccount(accountName)) return "";
  return `Cascadia Oceanic editorial profile (style only, not a factual source):
Write as an artist inviting someone to look closely, not as a catalog or B2B sales copywriter.
Lead with a supported visual detail, documented artistic choice, or true story behind the work.
Keep the voice observant, specific, restrained, and accessible. Avoid grand claims, corporate vocabulary, fabricated sensory detail, and forced punchlines.
Do not open with the title, dimensions, price, or purchase instructions unless this is explicitly a sales announcement.
Use first-person accounts only when the supplied source attributes the experience to the artist.
Give each post one purpose: discovery, process, place, or a verified physical-print/exhibition update.
Sales language and CTAs are optional, not a requirement. Preserve the artist's meaning and avoid engagement bait.
Never invent capture conditions, accidental focus, abandoned buildings, elapsed years, print materials, exhibitions, or gallery endorsements.
If an assigned angle lacks evidence, use a simpler supported observation instead.
Do not suggest replacing the actual artwork with generated imagery.`;
}

export const CASCADIA_CONTENT_ANGLES = [
  { name: "look closely", directive: "Lead with one visual detail explicitly described in the source and explain what it helps the viewer notice." },
  { name: "documented creative choice", directive: "Describe one documented framing, focus, exposure, or treatment choice. Do not invent the artist's intent or experience." },
  { name: "place and context", directive: "Use verified context about the work or place to add meaning. Do not infer location history or capture conditions." },
  { name: "physical work", directive: "Use supplied facts about the physical print or a confirmed exhibition. If none exist, use a supported observation about the artwork instead." },
  { name: "another way of seeing", directive: "Explore a different source-supported detail without repeating the other openings or inventing a story." },
];

export function instagramCaption(text: string): string {
  return text.split("\n")
    .map(original => {
      const line = original
        .replace(/\[([^\]]+)\]\(\s*(?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
        .replace(/<(?:https?:\/\/)[^>]+>/gi, "")
        .replace(/(?:https?:\/\/|www\.)[^\s<>)]+/gi, "")
        .replace(/(?<![@\w])(?:[a-z0-9-]+\.)+(?:com|org|net|art|photography|gallery|io)(?:\/[^\s<>)]*)?\b/gi, "")
        .replace(/(^|\s)\/r\/[a-z0-9_-]+(?:\?[^\s]*)?/gi, "$1");
      if (line === original) return original;
      const clean = line.replace(/[ \t]{2,}/g, " ").trim();
      // Only remove a CTA if removing its link made it an orphan.
      return /^(?:(?:learn|read|see|find out)\s+more|(?:shop|buy|view|explore)(?:\s+(?:now|here|the\s+(?:print|collection|work)))?)\s*[:→-]?\s*$/i.test(clean) ? "" : clean;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function socialCaptionForDelivery(platform: string, text: string): string {
  return platform.toLowerCase() === "instagram" ? instagramCaption(text) : text;
}
