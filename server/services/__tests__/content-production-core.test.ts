import { strict as assert } from "node:assert";
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
} from "../repurpose-core";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

(async () => {
  // ── SEO/AEO core ──────────────────────────────────────────────────────────
  await test("clampToLength trims at a word boundary, no mid-word cut", () => {
    assert.equal(clampToLength("short title", 60), "short title");
    const long = "This is a fairly long marketing title that definitely exceeds sixty characters in total";
    const clamped = clampToLength(long, SEO_TITLE_MAX)!;
    assert.ok(clamped.length <= SEO_TITLE_MAX);
    assert.ok(!clamped.endsWith(" "));
    assert.ok(long.startsWith(clamped));
    assert.equal(clampToLength("   ", 60), null);
  });

  await test("normalizeSlug lowercases and hyphenates", () => {
    assert.equal(normalizeSlug("How To X: A Guide!"), "how-to-x-a-guide");
    assert.equal(normalizeSlug("  --Already-Slugged--  "), "already-slugged");
    assert.equal(normalizeSlug(""), null);
  });

  await test("validateInternalLinks drops hallucinated and self links, dedupes, uses canonical title", () => {
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

  await test("parseOptimizationResponse applies guardrails + link validation", () => {
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
  await test("coercePlatform maps x -> twitter and falls back to linkedin", () => {
    assert.equal(coercePlatform("X"), "twitter");
    assert.equal(coercePlatform("Twitter"), "twitter");
    assert.equal(coercePlatform("mastodon"), "linkedin");
  });

  await test("clampForPlatform enforces twitter 280 at word boundary", () => {
    const long = "word ".repeat(100).trim();
    const clamped = clampForPlatform(long, "twitter");
    assert.ok(clamped.length <= 280);
    assert.ok(!clamped.endsWith(" "));
    // LinkedIn has no hard limit here
    assert.equal(clampForPlatform(long, "linkedin"), long);
  });

  await test("parseVariants normalizes hashtags, platforms, and clamps", () => {
    const arr = JSON.stringify([
      { platform: "x", content: "Hello world", hashtags: ["#Growth", "demand gen"], angle: "stat" },
      { platform: "linkedin", content: "  ", hashtags: [], angle: "" }, // empty content -> dropped
      { platform: "LinkedIn", content: "A longer post body.", hashtags: "#a #b" },
    ]);
    const variants = parseVariants(arr);
    assert.equal(variants.length, 2);
    assert.equal(variants[0].platform, "twitter");
    assert.deepEqual(variants[0].hashtags, ["Growth", "demandgen"]);
    assert.equal(variants[0].angle, "stat");
    assert.deepEqual(variants[1].hashtags, ["a", "b"]);
    assert.equal(variants[1].angle, null);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll content-production-core tests passed");
})();
