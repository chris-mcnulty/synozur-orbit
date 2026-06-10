/**
 * Repurposing engine — pure core.
 *
 * Variant parsing, platform normalization, and length guardrails for turning a
 * long-form asset into a batch of social variants. No I/O, so it is testable.
 */

export const SUPPORTED_PLATFORMS = ["linkedin", "twitter", "instagram", "facebook"] as const;
export type RepurposePlatform = (typeof SUPPORTED_PLATFORMS)[number];

// Long-form / derivative formats the repurposer can spin a source asset into,
// beyond the social platforms. These become content_assets (not generated_posts).
// Reviving the breadth of the original repurposing engine.
export const LONGFORM_REPURPOSE_FORMATS = [
  "blog_post",
  "newsletter",
  "video_script",
  "podcast_outline",
  "whitepaper",
  "carousel",
] as const;
export type LongformRepurposeFormat = (typeof LONGFORM_REPURPOSE_FORMATS)[number];

export function isLongformRepurposeFormat(v: unknown): v is LongformRepurposeFormat {
  return (LONGFORM_REPURPOSE_FORMATS as readonly string[]).includes(String(v));
}

// Drafting guidance per derivative format (parallels editorial-calendar-core's
// FORMAT_GUIDANCE, but covers the repurpose-only formats too).
export const LONGFORM_REPURPOSE_GUIDANCE: Record<LongformRepurposeFormat, string> = {
  blog_post:
    "Rework the source into a standalone 700-1100 word blog post in Markdown: a fresh H1, a hook intro, 3-5 H2 sections, and a conclusion leading to the CTA. Don't just copy — re-angle for a blog reader.",
  newsletter:
    "Rework the source into an email newsletter in Markdown: a subject line as the title, a personal intro, 1-3 short value sections drawn from the source, and a clear CTA.",
  video_script:
    "Turn the source into a short-form video script: a 0-3s hook, beat-by-beat spoken lines with brief [VISUAL] cues, ending on the CTA. 45-90 seconds of spoken content.",
  podcast_outline:
    "Turn the source into a two-host podcast outline in Markdown: episode title, a one-line premise, 4-7 talking-point segments (with a sentence of guidance each), 2-3 pull-quote moments, and an outro CTA.",
  whitepaper:
    "Expand the source into a whitepaper draft in Markdown: executive summary, problem framing, our point of view, a framework/approach, and a conclusion + CTA. Authoritative and well-structured.",
  carousel:
    "Turn the source into a social carousel: 6-10 slides. Render in Markdown with each slide as '### Slide N' followed by a punchy headline and 1-2 supporting lines. Slide 1 hooks; the last slide is the CTA.",
};

/** Map a derivative repurpose format onto the contentAssets.assetType enum. */
export function longformFormatToAssetType(format: LongformRepurposeFormat): string {
  switch (format) {
    case "blog_post":
      return "blog_post";
    case "whitepaper":
      return "whitepaper";
    case "video_script":
      return "video";
    default:
      // newsletter, podcast_outline, carousel
      return "other";
  }
}

// Hard character limits enforced after generation.
export const PLATFORM_LIMITS: Partial<Record<string, number>> = {
  twitter: 280,
};

export function coercePlatform(value: unknown): RepurposePlatform {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "x") return "twitter";
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(v) ? (v as RepurposePlatform) : "linkedin";
}

/** Clamp content to a platform's hard limit at a word boundary. */
export function clampForPlatform(content: string, platform: string): string {
  const limit = PLATFORM_LIMITS[platform];
  const s = content.trim();
  if (!limit || s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface RepurposeVariant {
  platform: RepurposePlatform;
  content: string;
  hashtags: string[];
  angle: string | null;
  // A suggested image-generation prompt for the paired visual, so the post and
  // its visual stay coupled from the moment of generation.
  imagePrompt: string | null;
}

function normalizeHashtags(raw: unknown): string[] {
  let arr: string[] = [];
  if (Array.isArray(raw)) arr = raw.map((h) => String(h));
  else if (typeof raw === "string") arr = raw.split(/[\s,]+/);
  return arr
    .map((h) => h.replace(/^#/, "").replace(/\s+/g, "").trim())
    .filter((h) => h.length > 0 && h.length < 50);
}

/** Parse and normalize the model's JSON array of variants, applying limits. */
export function parseVariants(text: string): RepurposeVariant[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let arr: any[] = [];
  try {
    const parsed = JSON.parse(cleaned);
    arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.variants) ? parsed.variants : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        arr = JSON.parse(match[0]);
      } catch {
        arr = [];
      }
    }
  }

  const out: RepurposeVariant[] = [];
  for (const raw of arr) {
    const content = String(raw?.content ?? "").trim();
    if (!content) continue;
    const platform = coercePlatform(raw?.platform);
    const str = (v: unknown): string | null => {
      const s = String(v ?? "").trim();
      return s || null;
    };
    out.push({
      platform,
      content: clampForPlatform(content, platform),
      hashtags: normalizeHashtags(raw?.hashtags),
      angle: str(raw?.angle),
      imagePrompt: str(raw?.imagePrompt ?? raw?.image_prompt),
    });
  }
  return out;
}
