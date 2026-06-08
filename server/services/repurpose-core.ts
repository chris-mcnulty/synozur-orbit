/**
 * Repurposing engine — pure core.
 *
 * Variant parsing, platform normalization, and length guardrails for turning a
 * long-form asset into a batch of social variants. No I/O, so it is testable.
 */

export const SUPPORTED_PLATFORMS = ["linkedin", "twitter", "instagram", "facebook"] as const;
export type RepurposePlatform = (typeof SUPPORTED_PLATFORMS)[number];

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
    out.push({
      platform,
      content: clampForPlatform(content, platform),
      hashtags: normalizeHashtags(raw?.hashtags),
      angle: (() => {
        const a = String(raw?.angle ?? "").trim();
        return a || null;
      })(),
    });
  }
  return out;
}
