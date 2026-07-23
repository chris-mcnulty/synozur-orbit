/**
 * Repurposing engine — pure core.
 *
 * Variant parsing, platform normalization, and length guardrails for turning a
 * long-form asset into a batch of social variants. No I/O, so it is testable.
 */

import type { CarouselSlide, RepurposeMeta } from "@shared/schema";
import { POLARIS_OUTLINE_GUIDANCE } from "./polaris-outline";
import { BANNED_WORDS, STRUCTURAL_ANTI_PATTERNS } from "./copywriter-service";

export const SUPPORTED_PLATFORMS = ["linkedin", "twitter", "instagram", "facebook"] as const;
export type RepurposePlatform = (typeof SUPPORTED_PLATFORMS)[number];

// ─── Multi-format repurposer (Task: multi-format content repurposer) ──────────
// One source asset → a menu of output types, generated as a batch. Each format
// carries its own structure and Cowork-style metadata, and routes to either the
// social posts pipeline (posts/carousels) or the Content Library (snippets).

export const REPURPOSE_BATCH_FORMATS = [
  "linkedin_post",
  "linkedin_carousel",
  "video_script",
  "video_shot_list",
  "blog_snippet",
  "whitepaper_snippet",
  "email_snippet",
] as const;
export type RepurposeBatchFormat = (typeof REPURPOSE_BATCH_FORMATS)[number];

export function isRepurposeBatchFormat(v: unknown): v is RepurposeBatchFormat {
  return (REPURPOSE_BATCH_FORMATS as readonly string[]).includes(String(v));
}

export interface RepurposeFormatDef {
  key: RepurposeBatchFormat;
  label: string;
  // Where the generated asset lands.
  destination: "posts" | "library";
  // For posts: linkedin single vs. 5-slide carousel.
  platform?: RepurposePlatform;
  postFormat?: "single" | "carousel";
  // For library snippets: the contentAssets.assetType to store under.
  assetType?: string;
  // Metadata "platform" label shown to the user (channel, not network slug).
  channelLabel: string;
  // Whether the user can request several of this type in one batch.
  maxCount: number;
  // Format-specific drafting guidance baked into the prompt.
  guidance: string;
}

export const REPURPOSE_FORMAT_DEFS: Record<RepurposeBatchFormat, RepurposeFormatDef> = {
  linkedin_post: {
    key: "linkedin_post",
    label: "LinkedIn single post",
    destination: "posts",
    platform: "linkedin",
    postFormat: "single",
    channelLabel: "LinkedIn",
    maxCount: 6,
    guidance:
      "A single LinkedIn post, 120-220 words. Open with a concrete hook (a tension, a question, or a hard-won lesson), make one clear point drawn from the source, and end on the call to action. No hashtags. Plain, direct, no hype.",
  },
  linkedin_carousel: {
    key: "linkedin_carousel",
    label: "LinkedIn carousel",
    destination: "posts",
    platform: "linkedin",
    postFormat: "carousel",
    channelLabel: "LinkedIn",
    maxCount: 3,
    guidance:
      "A 5-slide LinkedIn carousel: slide 1 is the cover (a kicker label and a strong headline that frames the problem), slides 2-4 are body slides (each a single idea: a headline plus 1-2 short supporting lines), slide 5 is the close (a takeaway and the call to action). Also write a short post caption to accompany the carousel.",
  },
  video_script: {
    key: "video_script",
    label: "Video script (60-70s)",
    destination: "library",
    assetType: "video",
    channelLabel: "Video",
    maxCount: 3,
    guidance:
      "A 60-70 second spoken video script in Markdown: a 0-3s hook, beat-by-beat spoken lines with brief [VISUAL] cues, ending on the call to action. Write for the ear, short sentences.",
  },
  video_shot_list: {
    key: "video_shot_list",
    label: "Video shot list (AI-video prompts)",
    destination: "library",
    assetType: "video",
    channelLabel: "Video",
    maxCount: 3,
    guidance:
      "A shot list for an AI video tool in Markdown: 6-10 numbered shots. Each shot is a self-contained text-to-video prompt describing the scene, subject, motion, framing, and mood, plus the on-screen caption line for that shot. This is a text prompt list only, no rendering.",
  },
  blog_snippet: {
    key: "blog_snippet",
    label: "Blog post snippet",
    destination: "library",
    assetType: "blog_post",
    channelLabel: "Blog",
    maxCount: 3,
    guidance:
      "A blog post starting snippet in Markdown: a working H1, a hook intro paragraph, and an outline of 3-5 H2 section headings with a sentence of guidance under each. A starting point a writer expands into a full post, not a finished article.",
  },
  whitepaper_snippet: {
    key: "whitepaper_snippet",
    label: "Whitepaper snippet",
    destination: "library",
    assetType: "whitepaper",
    channelLabel: "Whitepaper",
    maxCount: 2,
    guidance:
      "A whitepaper starting snippet in Markdown: a title, a one-paragraph executive summary, and an outline of the sections (problem framing, our point of view, a framework/approach, conclusion) with a sentence of guidance under each. A scaffold to expand, not a finished paper.",
  },
  email_snippet: {
    key: "email_snippet",
    label: "Email / newsletter snippet",
    destination: "library",
    assetType: "other",
    channelLabel: "Email",
    maxCount: 3,
    guidance:
      "An email/newsletter starting snippet in Markdown: a subject line as the title, a short preview line, a personal intro, one value section drawn from the source, and a clear call to action. A starting point to expand.",
  },
};

// Synozur voice rules, baked into every repurpose prompt.
export const SYNOZUR_VOICE_RULES = [
  "Write in Synozur's voice: calm, direct, anti-hype. A wartime-consigliere tone, plain and concrete, no marketing fluff or breathless adjectives.",
  "Use sentence case for every headline, title, and kicker (capitalize only the first word and proper nouns).",
  "Do not use em dashes. Use a period or a comma instead.",
  "Do not use hashtags anywhere.",
  "Do not fabricate statistics, customer names, or quotes. Stay grounded in the source and the brand positioning.",
  `Banned words — never use: ${BANNED_WORDS}.`,
  STRUCTURAL_ANTI_PATTERNS,
].join("\n- ");

/**
 * Enforce the Synozur voice rules that can be applied mechanically: strip em/en
 * dashes and hashtags. Tone and sentence case are handled by the prompt; this is
 * the safety net so a stray em dash or hashtag never ships.
 */
export function applySynozurVoice(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*\u2014\s*/g, ", ") // em dash → comma
    .replace(/\s*\u2013\s*/g, "-") // en dash → hyphen
    .replace(/#(?=[A-Za-z0-9_])/g, "") // strip the # but keep the word
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

// Long-form / derivative formats the repurposer can spin a source asset into,
// beyond the social platforms. These become content_assets (not generated_posts).
// Reviving the breadth of the original repurposing engine.
export const LONGFORM_REPURPOSE_FORMATS = [
  "blog_post",
  "newsletter",
  "video_script",
  "video_shot_list",
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
  video_shot_list:
    "Turn the source into a video shot list — a production-ready, shot-by-shot plan (not a spoken script). Render in Markdown as a numbered list of 6-12 shots. For each shot include: the shot type/framing (e.g. wide, medium, close-up, screen recording, B-roll), what's on screen, any on-screen text/lower-third, and the matching voiceover or audio cue. Open on a hook shot and end on the CTA shot.",
  podcast_outline: POLARIS_OUTLINE_GUIDANCE,
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
    case "video_shot_list":
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

// ─── Multi-format batch parsing ───────────────────────────────────────────────

/** Robustly pull a JSON array out of a model response (handles code fences). */
export function extractJsonArray(text: string): any[] {
  const cleaned = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const a = JSON.parse(match[0]);
        if (Array.isArray(a)) return a;
      } catch {
        /* fall through */
      }
    }
  }
  return [];
}

function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function lines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Build the Cowork-style metadata block from a raw item + the format channel. */
function metaFrom(raw: any, def: RepurposeFormatDef): RepurposeMeta {
  return {
    platform: def.channelLabel,
    format: def.label,
    coreIdea: str(raw?.coreIdea ?? raw?.core_idea),
    cta: str(raw?.cta ?? raw?.callToAction ?? raw?.call_to_action),
    bestPostingWindow: str(raw?.bestPostingWindow ?? raw?.best_posting_window ?? raw?.postingWindow),
  };
}

// A generated post bound for the social posts pipeline (single or carousel).
export interface GeneratedPostItem {
  kind: "post";
  format: RepurposeBatchFormat;
  platform: RepurposePlatform;
  postFormat: "single" | "carousel";
  content: string; // post body, or the carousel's caption
  slides: CarouselSlide[] | null;
  imagePrompt: string | null;
  meta: RepurposeMeta;
}

// A generated snippet bound for the Content Library.
export interface GeneratedAssetItem {
  kind: "asset";
  format: RepurposeBatchFormat;
  assetType: string;
  title: string;
  body: string; // Markdown
  meta: RepurposeMeta;
}

export type GeneratedRepurposeItem = GeneratedPostItem | GeneratedAssetItem;

/** Parse single LinkedIn posts: array of { content, coreIdea, cta, bestPostingWindow, imagePrompt }. */
export function parsePostItems(text: string, def: RepurposeFormatDef): GeneratedPostItem[] {
  const out: GeneratedPostItem[] = [];
  for (const raw of extractJsonArray(text)) {
    const content = applySynozurVoice(String(raw?.content ?? raw?.body ?? "").trim());
    if (!content) continue;
    out.push({
      kind: "post",
      format: def.key,
      platform: def.platform ?? "linkedin",
      postFormat: "single",
      content,
      slides: null,
      imagePrompt: str(raw?.imagePrompt ?? raw?.image_prompt),
      meta: metaFrom(raw, def),
    });
  }
  return out;
}

/** Parse carousels: array of { caption, slides: [{role, kicker, headline, supportingLines}], ...meta }. */
export function parseCarouselItems(text: string, def: RepurposeFormatDef): GeneratedPostItem[] {
  const out: GeneratedPostItem[] = [];
  for (const raw of extractJsonArray(text)) {
    const rawSlides: any[] = Array.isArray(raw?.slides) ? raw.slides : [];
    if (rawSlides.length === 0) continue;
    const slides: CarouselSlide[] = rawSlides.slice(0, 5).map((s, i) => {
      const role: CarouselSlide["role"] =
        i === 0 ? "cover" : i === Math.min(rawSlides.length, 5) - 1 ? "close" : "body";
      return {
        index: i + 1,
        role: (s?.role === "cover" || s?.role === "body" || s?.role === "close") ? s.role : role,
        kicker: str(s?.kicker) ? applySynozurVoice(String(s.kicker)) : null,
        headline: applySynozurVoice(String(s?.headline ?? s?.title ?? "").trim()),
        supportingLines: lines(s?.supportingLines ?? s?.supporting_lines ?? s?.lines ?? s?.body).map(
          applySynozurVoice,
        ),
        imageUrl: null,
      };
    }).filter((s) => s.headline);
    if (slides.length === 0) continue;
    const caption = applySynozurVoice(
      String(raw?.caption ?? raw?.content ?? slides[0]?.headline ?? "").trim(),
    );
    out.push({
      kind: "post",
      format: def.key,
      platform: def.platform ?? "linkedin",
      postFormat: "carousel",
      content: caption || slides[0].headline,
      slides,
      imagePrompt: str(raw?.imagePrompt ?? raw?.image_prompt),
      meta: metaFrom(raw, def),
    });
  }
  return out;
}

/** Parse library snippets: array of { title, body, coreIdea, cta, bestPostingWindow }. */
export function parseAssetItems(text: string, def: RepurposeFormatDef): GeneratedAssetItem[] {
  const out: GeneratedAssetItem[] = [];
  for (const raw of extractJsonArray(text)) {
    const body = applySynozurVoice(String(raw?.body ?? raw?.content ?? "").trim());
    if (!body) continue;
    out.push({
      kind: "asset",
      format: def.key,
      assetType: def.assetType ?? "other",
      title: applySynozurVoice(String(raw?.title ?? def.label).trim()) || def.label,
      body,
      meta: metaFrom(raw, def),
    });
  }
  return out;
}

export interface ParsedCarouselSlide {
  // 1-based slide number as it appears in the deck.
  index: number;
  // The punchy headline rendered large on the slide.
  headline: string;
  // Supporting line(s) rendered smaller beneath the headline (may be empty).
  body: string;
}

/**
 * Parse a generated carousel body (the Markdown shape from
 * LONGFORM_REPURPOSE_GUIDANCE.carousel) into discrete slides. Each slide is a
 * "### Slide N" heading followed by a headline line and 1-2 supporting lines.
 *
 * Tolerant of variations: a missing "Slide N" prefix, "##"/"###" levels, or a
 * "Headline:" / "Slide 1:" inline form. Falls back to splitting on blank-line
 * blocks when no headings are present so we still render something usable.
 */
export function extractCarouselSlides(body: string): ParsedCarouselSlide[] {
  const text = String(body ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const headingRe = /^#{2,3}\s*(?:slide\s*\d+\s*[:.\-]?\s*)?(.*)$/i;
  const lines = text.split("\n");
  const hasHeadings = lines.some((l) => /^#{2,3}\s/.test(l.trim()));

  const stripMd = (s: string) =>
    s
      .replace(/^[#>\-*\d.\s]+/, "")
      .replace(/\*\*|__|`/g, "")
      .trim();

  let slides: ParsedCarouselSlide[] = [];

  if (hasHeadings) {
    type Block = { headingRest: string; lines: string[] };
    const blocks: Block[] = [];
    let current: Block | null = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (/^#{2,3}\s/.test(line)) {
        const rest = (line.match(headingRe)?.[1] ?? "").trim();
        current = { headingRest: rest, lines: [] };
        blocks.push(current);
      } else if (current) {
        if (line) current.lines.push(line);
      } else if (line) {
        // Content before the first heading — start an implicit block.
        current = { headingRest: "", lines: [line] };
        blocks.push(current);
      }
    }

    for (const b of blocks) {
      const contentLines = b.lines.map(stripMd).filter(Boolean);
      let headline = stripMd(b.headingRest);
      if (!headline) headline = contentLines.shift() ?? "";
      if (!headline) continue;
      slides.push({ index: 0, headline, body: contentLines.join(" ").trim() });
    }
  } else {
    // No headings → split into blank-line blocks, first line = headline.
    const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
    slides = chunks
      .map((chunk) => {
        const parts = chunk.split("\n").map(stripMd).filter(Boolean);
        return { index: 0, headline: parts.shift() ?? "", body: parts.join(" ").trim() };
      })
      .filter((s) => s.headline);
  }

  return slides.map((s, i) => ({ ...s, index: i + 1 }));
}
