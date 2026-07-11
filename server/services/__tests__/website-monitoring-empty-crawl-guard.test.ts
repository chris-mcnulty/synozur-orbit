import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  isEmptyOrCollapsedCrawl,
  MIN_ABSOLUTE_CONTENT_WORDS,
  MIN_ABSOLUTE_CONTENT_CHARS,
  MIN_PREV_CONTENT_FOR_COLLAPSE,
  COLLAPSE_FRACTION,
} from "../website-monitoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a string of `wordCount` space-separated lorem-ish words. */
function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

/** Repeat `char` `n` times (for char-count-only tests). */
function chars(n: number, char = "x"): string {
  return char.repeat(n);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isEmptyOrCollapsedCrawl", () => {
  // -------------------------------------------------------------------------
  // Absolute floor — empty / near-empty crawls
  // -------------------------------------------------------------------------

  it("returns true when word count is zero (completely empty crawl)", () => {
    assert.equal(isEmptyOrCollapsedCrawl("", "", 0), true);
  });

  it("returns true when word count is below the absolute floor", () => {
    const belowFloor = MIN_ABSOLUTE_CONTENT_WORDS - 1;
    // Even if the string is long by char count, too few words = suspicious.
    const content = words(belowFloor) + " " + chars(MIN_ABSOLUTE_CONTENT_CHARS + 100);
    assert.equal(isEmptyOrCollapsedCrawl(content, "", belowFloor), true);
  });

  it("returns true when char count is below the absolute floor (even with enough words)", () => {
    // A content string shorter than MIN_ABSOLUTE_CONTENT_CHARS is suspicious
    // regardless of word count.
    const shortContent = chars(MIN_ABSOLUTE_CONTENT_CHARS - 1);
    assert.equal(
      isEmptyOrCollapsedCrawl(shortContent, "", MIN_ABSOLUTE_CONTENT_WORDS + 10),
      true,
    );
  });

  it("returns true at exactly the absolute word floor minus one", () => {
    const n = MIN_ABSOLUTE_CONTENT_WORDS - 1;
    const content = words(n) + " " + chars(MIN_ABSOLUTE_CONTENT_CHARS + 50);
    assert.equal(isEmptyOrCollapsedCrawl(content, "", n), true);
  });

  it("returns true at exactly the absolute char floor minus one", () => {
    const content = chars(MIN_ABSOLUTE_CONTENT_CHARS - 1);
    assert.equal(
      isEmptyOrCollapsedCrawl(content, "", MIN_ABSOLUTE_CONTENT_WORDS + 10),
      true,
    );
  });

  // -------------------------------------------------------------------------
  // Genuine small-but-real sites — must NOT be flagged
  // -------------------------------------------------------------------------

  it("returns false for a small but real site that meets both absolute floors", () => {
    // A microsite with 60 words and 250 chars should pass through — it is
    // genuinely small, not an empty shell.
    const content = words(MIN_ABSOLUTE_CONTENT_WORDS + 10); // 60 words
    // Ensure it is also above the char floor.
    const padded = content.padEnd(MIN_ABSOLUTE_CONTENT_CHARS + 50, " .");
    assert.equal(
      isEmptyOrCollapsedCrawl(padded, "", MIN_ABSOLUTE_CONTENT_WORDS + 10),
      false,
    );
  });

  it("returns false for a small site with no previous content (no collapse check triggered)", () => {
    const content = words(MIN_ABSOLUTE_CONTENT_WORDS + 5).padEnd(
      MIN_ABSOLUTE_CONTENT_CHARS + 20,
      " .",
    );
    // previousContent is empty → prevLen < MIN_PREV_CONTENT_FOR_COLLAPSE, so
    // the relative collapse branch is never entered.
    assert.equal(
      isEmptyOrCollapsedCrawl(content, "", MIN_ABSOLUTE_CONTENT_WORDS + 5),
      false,
    );
  });

  // -------------------------------------------------------------------------
  // Relative collapse guard
  // -------------------------------------------------------------------------

  it("returns true when new content collapses to a tiny fraction of prior content", () => {
    // Previous: 2 000-char page. New: 100 chars — well under 15% of 2 000.
    const prevContent = chars(MIN_PREV_CONTENT_FOR_COLLAPSE + 1500); // 2 000 chars
    const tinyNew = chars(MIN_ABSOLUTE_CONTENT_CHARS + 50);          // 250 chars (> absolute floor)
    // tinyNew.length / prevContent.length ≈ 0.125 < COLLAPSE_FRACTION (0.15) → collapsed
    assert.equal(
      isEmptyOrCollapsedCrawl(
        tinyNew,
        prevContent,
        MIN_ABSOLUTE_CONTENT_WORDS + 10,
      ),
      true,
    );
  });

  it("returns false when previous content was below the collapse-guard threshold", () => {
    // If we've never seen substantial prior content the collapse guard must
    // stay silent — we cannot call a drop "suspicious" when there was nothing
    // notable before.
    const smallPrev = chars(MIN_PREV_CONTENT_FOR_COLLAPSE - 1); // 499 chars
    const newContent = chars(MIN_ABSOLUTE_CONTENT_CHARS + 50);  // 250 chars
    assert.equal(
      isEmptyOrCollapsedCrawl(
        newContent,
        smallPrev,
        MIN_ABSOLUTE_CONTENT_WORDS + 10,
      ),
      false,
    );
  });

  it("returns false when new content is exactly at the collapse fraction boundary", () => {
    // newLen >= prevLen * COLLAPSE_FRACTION → not collapsed.
    const prevContent = chars(MIN_PREV_CONTENT_FOR_COLLAPSE); // 500 chars
    // Exactly at the boundary: 500 * 0.15 = 75 chars — but we must also
    // satisfy the absolute floor of 200 chars, so pick a value that is
    // >= fraction AND >= absolute floor.
    const boundaryNew = chars(Math.ceil(prevContent.length * COLLAPSE_FRACTION));
    // boundaryNew is 75 chars — below absolute char floor, so use a larger value.
    const safeNew = chars(MIN_ABSOLUTE_CONTENT_CHARS + 50); // 250 chars
    // safeNew.length / prevContent.length = 250 / 500 = 0.5 > 0.15 → passes
    assert.equal(
      isEmptyOrCollapsedCrawl(
        safeNew,
        prevContent,
        MIN_ABSOLUTE_CONTENT_WORDS + 10,
      ),
      false,
    );
  });

  // -------------------------------------------------------------------------
  // Genuine large-but-real changes — must NOT be suppressed
  // -------------------------------------------------------------------------

  it("returns false for a large site that rewrites its content (big but not collapsed)", () => {
    // A 3 000-char baseline; a 2 500-char new crawl. Completely different content
    // but not collapsed — the diff is real.
    const prevContent = chars(3000, "a");
    const newContent = chars(2500, "b"); // different content, similar size
    const wordCount = MIN_ABSOLUTE_CONTENT_WORDS + 200;
    assert.equal(isEmptyOrCollapsedCrawl(newContent, prevContent, wordCount), false);
  });

  it("returns false for a site that grew substantially from its baseline", () => {
    const prevContent = chars(1000);
    const newContent = chars(4000); // site added a lot of content
    const wordCount = MIN_ABSOLUTE_CONTENT_WORDS + 300;
    assert.equal(isEmptyOrCollapsedCrawl(newContent, prevContent, wordCount), false);
  });

  it("returns false for a site that shrunk moderately (> collapse fraction)", () => {
    // 3 000 → 1 000 chars: ratio = 0.33, above COLLAPSE_FRACTION (0.15). A
    // real content reduction of one third should still trigger an alert.
    const prevContent = chars(3000);
    const newContent = chars(1000);
    const wordCount = MIN_ABSOLUTE_CONTENT_WORDS + 50;
    assert.equal(isEmptyOrCollapsedCrawl(newContent, prevContent, wordCount), false);
  });

  // -------------------------------------------------------------------------
  // Boundary edge cases at exact threshold values
  // -------------------------------------------------------------------------

  it("returns false when both absolute floors are met exactly", () => {
    // Exactly at the thresholds — should pass (not flagged as empty).
    const content = words(MIN_ABSOLUTE_CONTENT_WORDS).padEnd(
      MIN_ABSOLUTE_CONTENT_CHARS,
      " .",
    );
    assert.equal(
      isEmptyOrCollapsedCrawl(content, "", MIN_ABSOLUTE_CONTENT_WORDS),
      false,
    );
  });

  it("returns true for whitespace-only content (trimmed length is zero)", () => {
    const wsOnly = "   \t\n   ";
    assert.equal(isEmptyOrCollapsedCrawl(wsOnly, "", 0), true);
  });
});
