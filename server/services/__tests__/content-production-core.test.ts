import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  clampToLength,
  normalizeSlug,
  validateInternalLinks,
  parseOptimizationResponse,
  SEO_TITLE_MAX,
  META_DESC_MAX,
} from "../seo-aeo-core";
import {
  coercePlatform,
  clampForPlatform,
  parseVariants,
  extractCarouselSlides,
  isLongformRepurposeFormat,
  longformFormatToAssetType,
} from "../repurpose-core";


describe("content-production-core", () => {
  // ── SEO/AEO core ──────────────────────────────────────────────────────────
  it("clampToLength trims at a word boundary, no mid-word cut", () => {
    assert.equal(clampToLength("short title", 60), "short title");
    const long = "This is a fairly long marketing title that definitely exceeds sixty characters in total";
    const clamped = clampToLength(long, SEO_TITLE_MAX)!;
    assert.ok(clamped.length <= SEO_TITLE_MAX);
    assert.ok(!clamped.endsWith(" "));
    assert.ok(long.startsWith(clamped));
    assert.equal(clampToLength("   ", 60), null);
  });

  it("normalizeSlug lowercases and hyphenates", () => {
    assert.equal(normalizeSlug("How To X: A Guide!"), "how-to-x-a-guide");
    assert.equal(normalizeSlug("  --Already-Slugged--  "), "already-slugged");
    assert.equal(normalizeSlug(""), null);
  });

  it("validateInternalLinks drops hallucinated and self links, dedupes, uses canonical title", () => {
    const inventory = [
      { id: "a1", title: "Real Asset One" },
      { id: "a2", title: "Real Asset Two" },
    ];
    const suggestions = [
      { anchorText: "see this", targetAssetId: "a1", reason: "related" },
      { anchorText: "ghost", targetAssetId: "nope", reason: "x" }, // hallucinated -> drop
      { anchorText: "dupe", targetAssetId: "a1", reason: "y" }, // duplicate -> drop
      { targetAssetId: "a2", reason: "z" }, // no anchor -> falls back to title
      { anchorText: "self", targetAssetId: "self-id", reason: "" },
    ];
    const out = validateInternalLinks(suggestions, inventory, "self-id");
    assert.equal(out.length, 2);
    assert.equal(out[0].targetAssetId, "a1");
    assert.equal(out[0].targetTitle, "Real Asset One");
    assert.equal(out[1].anchorText, "Real Asset Two"); // anchor fallback
  });

  it("parseOptimizationResponse applies guardrails + link validation", () => {
    const inventory = [{ id: "k1", title: "Pillar Page" }];
    const json = JSON.stringify({
      seoTitle: "A".repeat(120),
      metaDescription: "B".repeat(300),
      slug: "My Slug Here",
      targetKeyword: "demand gen",
      keywords: ["a", "b"],
      answerBlocks: [{ question: "Q1?", answer: "A1." }, { question: "", answer: "drop" }],
      faq: [{ question: "F?", answer: "FA." }],
      internalLinks: [
        { anchorText: "link", targetAssetId: "k1", reason: "r" },
        { anchorText: "bad", targetAssetId: "ghost", reason: "r" },
      ],
      contentGaps: ["gap one", "gap two"],
    });
    const p = parseOptimizationResponse("```json\n" + json + "\n```", inventory);
    assert.ok(p.seoTitle!.length <= SEO_TITLE_MAX);
    assert.ok(p.metaDescription!.length <= META_DESC_MAX);
    assert.equal(p.slug, "my-slug-here");
    assert.equal(p.answerBlocks.length, 1);
    assert.equal(p.internalLinks.length, 1);
    assert.equal(p.internalLinks[0].targetAssetId, "k1");
    assert.deepEqual(p.contentGaps, ["gap one", "gap two"]);
  });

  // ── Repurpose core ────────────────────────────────────────────────────────
  it("coercePlatform maps x -> twitter and falls back to linkedin", () => {
    assert.equal(coercePlatform("X"), "twitter");
    assert.equal(coercePlatform("Twitter"), "twitter");
    assert.equal(coercePlatform("mastodon"), "linkedin");
  });

  it("clampForPlatform enforces twitter 280 at word boundary", () => {
    const long = "word ".repeat(100).trim();
    const clamped = clampForPlatform(long, "twitter");
    assert.ok(clamped.length <= 280);
    assert.ok(!clamped.endsWith(" "));
    // LinkedIn has no hard limit here
    assert.equal(clampForPlatform(long, "linkedin"), long);
  });

  it("parseVariants normalizes hashtags, platforms, clamps, and reads imagePrompt", () => {
    const arr = JSON.stringify([
      { platform: "x", content: "Hello world", hashtags: ["#Growth", "demand gen"], angle: "stat", imagePrompt: "A bold chart on dark bg" },
      { platform: "linkedin", content: "  ", hashtags: [], angle: "" }, // empty content -> dropped
      { platform: "LinkedIn", content: "A longer post body.", hashtags: "#a #b" },
    ]);
    const variants = parseVariants(arr);
    assert.equal(variants.length, 2);
    assert.equal(variants[0].platform, "twitter");
    assert.deepEqual(variants[0].hashtags, ["Growth", "demandgen"]);
    assert.equal(variants[0].angle, "stat");
    assert.equal(variants[0].imagePrompt, "A bold chart on dark bg");
    assert.deepEqual(variants[1].hashtags, ["a", "b"]);
    assert.equal(variants[1].angle, null);
    assert.equal(variants[1].imagePrompt, null); // absent -> null
  });

  it("video_shot_list is a valid long-form format mapped to a video asset", () => {
    assert.equal(isLongformRepurposeFormat("video_shot_list"), true);
    assert.equal(longformFormatToAssetType("video_shot_list"), "video");
    assert.equal(isLongformRepurposeFormat("not_a_format"), false);
  });

  it("extractCarouselSlides parses ### Slide headings with body lines", () => {
    const body = [
      "### Slide 1: Hook the reader",
      "A punchy opener that grabs attention.",
      "",
      "### Slide 2: The problem",
      "Most teams struggle with this.",
      "Second supporting line.",
      "",
      "### Slide 3: The fix",
      "Here is how to solve it.",
    ].join("\n");
    const slides = extractCarouselSlides(body);
    assert.equal(slides.length, 3);
    assert.deepEqual(slides.map((s) => s.index), [1, 2, 3]);
    assert.equal(slides[0].headline, "Hook the reader");
    assert.equal(slides[0].body, "A punchy opener that grabs attention.");
    assert.equal(slides[1].headline, "The problem");
    assert.equal(slides[1].body, "Most teams struggle with this. Second supporting line.");
    assert.equal(slides[2].headline, "The fix");
  });

  it("extractCarouselSlides handles headings without the Slide N prefix", () => {
    const body = ["## Big idea", "Supporting detail.", "", "## Next idea", "More detail."].join("\n");
    const slides = extractCarouselSlides(body);
    assert.equal(slides.length, 2);
    assert.equal(slides[0].headline, "Big idea");
    assert.equal(slides[0].index, 1);
    assert.equal(slides[1].headline, "Next idea");
  });

  it("extractCarouselSlides falls back to blank-line blocks with no headings", () => {
    const body = ["First slide headline", "first body", "", "Second slide headline", "second body"].join("\n");
    const slides = extractCarouselSlides(body);
    assert.equal(slides.length, 2);
    assert.equal(slides[0].headline, "First slide headline");
    assert.equal(slides[0].body, "first body");
    assert.equal(slides[1].headline, "Second slide headline");
  });

  it("extractCarouselSlides strips markdown emphasis and returns [] for empty", () => {
    assert.deepEqual(extractCarouselSlides(""), []);
    assert.deepEqual(extractCarouselSlides("   \n  "), []);
    const slides = extractCarouselSlides("### Slide 1\n**Bold headline**\n_subtitle_");
    assert.equal(slides.length, 1);
    assert.equal(slides[0].headline, "Bold headline");
  });

});
