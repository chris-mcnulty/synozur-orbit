/**
 * Tests for carousel slide image embedding in branded Word (.docx) exports.
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeAll } from "vitest";
import JSZip from "jszip";
import { buildBrandedDocx, _testSetImageLoader } from "../docx-generator.js";

const PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12NgYGD4DwABBAEAHnOSQwAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_GREEN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12Nk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function listMediaPngEntries(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter((e) => e.startsWith("word/media/") && e.endsWith(".png"));
}

describe("docx-generator", () => {
  let baseline = 0;

  beforeAll(async () => {
    const buf = await buildBrandedDocx("Baseline", "Just some text.");
    baseline = (await listMediaPngEntries(buf)).length;
  });

  it("embeds real PNG bytes when image URL is a safe internal path", async () => {
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

  it("embeds multiple images when markdown contains several standalone image lines", async () => {
    const images = [PNG_RED, PNG_BLUE, PNG_GREEN];
    let call = 0;
    _testSetImageLoader(async (_url: string) => images[call++ % images.length]);
    try {
      const buf = await buildBrandedDocx(
        "Multi-image Test",
        `![Slide 1](/objects/s1.png)\n\n![Slide 2](/objects/s2.png)\n\n![Slide 3](/objects/s3.png)`,
      );
      const mediaEntries = await listMediaPngEntries(buf);
      assert.ok(
        mediaEntries.length >= baseline + 3,
        `Expected ≥ ${baseline + 3} PNG media entries for 3 distinct images but got ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
      );
    } finally {
      _testSetImageLoader(null);
    }
  });

  it("renders italic alt-text caption when image fetch throws (no extra media)", async () => {
    _testSetImageLoader(async (_url: string) => {
      throw new Error("simulated storage failure");
    });
    try {
      const altText = "Slide showing Q3 pipeline";
      const buf = await buildBrandedDocx("Fallback Test", `![${altText}](/objects/missing.png)`);
      const mediaEntries = await listMediaPngEntries(buf);
      assert.equal(
        mediaEntries.length,
        baseline,
        `Expected exactly ${baseline} media entries (baseline) on fallback but found ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
      );
      const zip = await JSZip.loadAsync(buf);
      const docXml = await zip.file("word/document.xml")!.async("string");
      assert.ok(docXml.includes(altText), `Expected alt-text caption "${altText}" in document XML but it was absent`);
    } finally {
      _testSetImageLoader(null);
    }
  });

  it("renders caption for external URLs without attempting to fetch", async () => {
    const altText = "External image caption";
    const buf = await buildBrandedDocx("External URL Test", `![${altText}](https://example.com/image.png)`);
    const mediaEntries = await listMediaPngEntries(buf);
    assert.equal(
      mediaEntries.length,
      baseline,
      `Expected ${baseline} media entries for external URL but found ${mediaEntries.length}: ${mediaEntries.join(", ")}`,
    );
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");
    assert.ok(docXml.includes(altText), `Expected caption "${altText}" in document XML but it was absent`);
  });

  it("image line with empty alt text produces no caption when fetch fails", async () => {
    _testSetImageLoader(async (_url: string) => {
      throw new Error("simulated failure");
    });
    try {
      const buf = await buildBrandedDocx("No-alt Test", `![](/objects/noalt.png)`);
      const zip = await JSZip.loadAsync(buf);
      const docXml = await zip.file("word/document.xml")!.async("string");
      assert.ok(!docXml.includes("![]("), "Raw markdown image syntax must not appear in document XML");
    } finally {
      _testSetImageLoader(null);
    }
  });

  it("non-image content (headings, bullets, body text) is rendered correctly", async () => {
    const buf = await buildBrandedDocx(
      "Text-only Test",
      `# Main heading\n\n## Sub heading\n\nA paragraph of body text.\n\n- Bullet one\n- Bullet two\n\n---\n\nAnother paragraph.`,
    );
    const mediaEntries = await listMediaPngEntries(buf);
    assert.equal(mediaEntries.length, baseline, `Expected ${baseline} media entries for text-only doc but found ${mediaEntries.length}`);
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");
    for (const expected of ["Main heading", "Sub heading", "body text", "Bullet one", "Bullet two"]) {
      assert.ok(docXml.includes(expected), `Expected "${expected}" to appear in document XML`);
    }
    assert.ok(!docXml.includes("## "), 'Raw "## " heading syntax must not appear in document XML');
    assert.ok(!docXml.includes("- Bullet"), 'Raw "- Bullet" list syntax must not appear in document XML');
  });
});
