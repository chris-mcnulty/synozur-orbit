/**
 * Tests for carousel slide image embedding in branded Word (.docx) exports.
 *
 * Covers:
 *   1. Real image bytes are embedded (word/media/ entries appear in the zip).
 *   2. When the image can't be fetched the alt-text is rendered as an italic
 *      caption instead (no extra media entry beyond the header logo).
 *   3. Non-image content (headings, bullets, body text) is unaffected by the
 *      image-embedding path.
 */

import { strict as assert } from "node:assert";
import JSZip from "jszip";
import { buildBrandedDocx, _testSetImageLoader } from "../docx-generator.js";

// ---------------------------------------------------------------------------
// Minimal PNG buffers – real, valid PNG bytes suitable for embedding.
// Each is a 1×1 image with a different fill colour so they produce distinct
// zip entries (the docx library deduplicates identical bytes by hash).
// ---------------------------------------------------------------------------
// 1×1 red pixel
const PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==",
  "base64",
);
// 1×1 blue pixel (different bytes → different hash)
const PNG_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12NgYGD4DwABBAEAHnOSQwAAAABJRU5ErkJggg==",
  "base64",
);
// 1×1 green pixel
const PNG_GREEN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12Nk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listMediaPngEntries(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter((e) => e.startsWith("word/media/") && e.endsWith(".png"));
}

/** Build a doc with no images so we know how many media entries exist by
 *  default (the header may embed the brand logo). */
async function baselineMediaCount(): Promise<number> {
  const buf = await buildBrandedDocx("Baseline", "Just some text.");
  return (await listMediaPngEntries(buf)).length;
}

// ---------------------------------------------------------------------------
// Test harness (mirrors other test files in this project).
// ---------------------------------------------------------------------------
let failures = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  const baseline = await baselineMediaCount();

  // -------------------------------------------------------------------------
  // 1. Image bytes embedded – happy path (single image)
  // -------------------------------------------------------------------------
  await test("embeds real PNG bytes when image URL is a safe internal path", async () => {
    _testSetImageLoader(async (_url: string) => PNG_RED);
    try {
      const buf = await buildBrandedDocx(
        "Carousel Test",
        `# Slide Deck\n\n![Slide 1 caption](/objects/slide1.png)\n\nSome body text.`,
      );
      const mediaEntries = await listMediaPngEntries(buf);
      assert.ok(
        mediaEntries.length > baseline,
        `Expected more than ${baseline} media PNG entries (baseline) but got ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
      );
    } finally {
      _testSetImageLoader(null);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Multiple distinct images are all embedded
  // -------------------------------------------------------------------------
  await test("embeds multiple images when markdown contains several standalone image lines", async () => {
    const images = [PNG_RED, PNG_BLUE, PNG_GREEN];
    let call = 0;
    _testSetImageLoader(async (_url: string) => images[call++ % images.length]);
    try {
      const buf = await buildBrandedDocx(
        "Multi-image Test",
        `![Slide 1](/objects/s1.png)\n\n![Slide 2](/objects/s2.png)\n\n![Slide 3](/objects/s3.png)`,
      );
      const mediaEntries = await listMediaPngEntries(buf);
      // 3 distinct images + whatever the baseline holds.
      assert.ok(
        mediaEntries.length >= baseline + 3,
        `Expected ≥ ${baseline + 3} PNG media entries for 3 distinct images but got ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
      );
    } finally {
      _testSetImageLoader(null);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Fallback – italic caption rendered when image fetch fails
  // -------------------------------------------------------------------------
  await test("renders italic alt-text caption when image fetch throws (no extra media)", async () => {
    _testSetImageLoader(async (_url: string) => {
      throw new Error("simulated storage failure");
    });
    try {
      const altText = "Slide showing Q3 pipeline";
      const buf = await buildBrandedDocx(
        "Fallback Test",
        `![${altText}](/objects/missing.png)`,
      );

      // Media entries must not exceed baseline (no extra image was embedded).
      const mediaEntries = await listMediaPngEntries(buf);
      assert.equal(
        mediaEntries.length,
        baseline,
        `Expected exactly ${baseline} media entries (baseline) on fallback but found ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
      );

      // The alt text must appear as a caption in the document XML.
      const zip = await JSZip.loadAsync(buf);
      const docXml = await zip.file("word/document.xml")!.async("string");
      assert.ok(
        docXml.includes(altText),
        `Expected alt-text caption "${altText}" in document XML but it was absent`,
      );
    } finally {
      _testSetImageLoader(null);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Fallback for external (non-safe) URLs – caption without any fetch
  // -------------------------------------------------------------------------
  await test("renders caption for external URLs without attempting to fetch", async () => {
    // No image loader override – the safe-URL guard must fire before the loader.
    const altText = "External image caption";
    const buf = await buildBrandedDocx(
      "External URL Test",
      `![${altText}](https://example.com/image.png)`,
    );

    // No extra media beyond baseline.
    const mediaEntries = await listMediaPngEntries(buf);
    assert.equal(
      mediaEntries.length,
      baseline,
      `Expected ${baseline} media entries for external URL but found ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
    );

    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");
    assert.ok(
      docXml.includes(altText),
      `Expected caption "${altText}" in document XML but it was absent`,
    );
  });

  // -------------------------------------------------------------------------
  // 5. Image line with no alt text and a failing URL produces no caption
  // -------------------------------------------------------------------------
  await test("image line with empty alt text produces no caption when fetch fails", async () => {
    _testSetImageLoader(async (_url: string) => {
      throw new Error("simulated failure");
    });
    try {
      const buf = await buildBrandedDocx("No-alt Test", `![](/objects/noalt.png)`);

      const zip = await JSZip.loadAsync(buf);
      const docXml = await zip.file("word/document.xml")!.async("string");
      // Raw markdown must not leak through.
      assert.ok(
        !docXml.includes("![]("),
        "Raw markdown image syntax must not appear in document XML",
      );
    } finally {
      _testSetImageLoader(null);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Non-image content is unaffected by the image-embedding path
  // -------------------------------------------------------------------------
  await test("non-image content (headings, bullets, body text) is rendered correctly", async () => {
    const buf = await buildBrandedDocx(
      "Text-only Test",
      `# Main heading\n\n## Sub heading\n\nA paragraph of body text.\n\n- Bullet one\n- Bullet two\n\n---\n\nAnother paragraph.`,
    );

    // Media entries must equal the baseline (header logo only, no content images).
    const mediaEntries = await listMediaPngEntries(buf);
    assert.equal(
      mediaEntries.length,
      baseline,
      `Expected ${baseline} media entries for text-only doc but found ${mediaEntries.length}`,
    );

    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");

    for (const expected of ["Main heading", "Sub heading", "body text", "Bullet one", "Bullet two"]) {
      assert.ok(
        docXml.includes(expected),
        `Expected "${expected}" to appear in document XML`,
      );
    }
    // Raw markdown constructs must not leak through.
    assert.ok(!docXml.includes("## "), 'Raw "## " heading syntax must not appear in document XML');
    assert.ok(!docXml.includes("- Bullet"), 'Raw "- Bullet" list syntax must not appear in document XML');
  });

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll 6 checks passed.`);
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
