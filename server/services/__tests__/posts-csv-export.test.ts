/**
 * Unit tests for the isOrbitDirectPost helper.
 *
 * This is the routing predicate that decides whether a post is published
 * natively by Orbit (excluded from CSV) or needs an external scheduler
 * (included in CSV). Tests cover all four classification branches plus
 * the paused-but-autoPublish edge case that triggered the original bug.
 */

import { describe, it, expect } from "vitest";
import { isOrbitDirectPost } from "../posts-csv-export";

function makeMap(entries: [string, boolean][]): Map<string, boolean> {
  return new Map(entries);
}

describe("isOrbitDirectPost", () => {
  // ── Explicit CSV override ────────────────────────────────────────────────
  describe("deliveryMode='csv' (explicit override)", () => {
    it("returns false (CSV-eligible) even when account has autoPublish=true", () => {
      const post = { deliveryMode: "csv", socialAccountId: "acct-1" };
      const map = makeMap([["acct-1", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(false);
    });

    it("returns false even with no account link at all", () => {
      const post = { deliveryMode: "csv", socialAccountId: null };
      expect(isOrbitDirectPost(post, new Map())).toBe(false);
    });
  });

  // ── autoPublish=true → Orbit owns the post ───────────────────────────────
  describe("deliveryMode=null + autoPublish=true", () => {
    it("returns true (Orbit-direct) for a normal auto-publish account", () => {
      const post = { deliveryMode: null, socialAccountId: "acct-1" };
      const map = makeMap([["acct-1", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(true);
    });

    it("returns true even when the account is publishingPaused (paused ≠ CSV)", () => {
      // publishingPaused is a worker gate, not an ownership signal.
      // The account still owns the post; exporting it to CSV while paused
      // would cause duplicates when Orbit publishing resumes.
      const post = { deliveryMode: null, socialAccountId: "acct-paused" };
      // autoPublishMap only tracks the autoPublish flag — paused is irrelevant
      const map = makeMap([["acct-paused", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(true);
    });
  });

  // ── autoPublish=false → external scheduler handles this post ─────────────
  describe("deliveryMode=null + autoPublish=false", () => {
    it("returns false (CSV-eligible) when account has autoPublish=false", () => {
      const post = { deliveryMode: null, socialAccountId: "acct-2" };
      const map = makeMap([["acct-2", false]]);
      expect(isOrbitDirectPost(post, map)).toBe(false);
    });
  });

  // ── No linked account → conservative inclusion ───────────────────────────
  describe("deliveryMode=null + no linked account", () => {
    it("returns false (CSV-eligible) when socialAccountId is null", () => {
      const post = { deliveryMode: null, socialAccountId: null };
      expect(isOrbitDirectPost(post, new Map())).toBe(false);
    });

    it("returns false (CSV-eligible) when account is not in the map", () => {
      const post = { deliveryMode: null, socialAccountId: "unknown-acct" };
      const map = makeMap([["other-acct", true]]);
      expect(isOrbitDirectPost(post, map)).toBe(false);
    });
  });

  // ── Mixed accounts in one campaign ───────────────────────────────────────
  describe("mixed campaign: some autoPublish=true, some false", () => {
    const autoPublishMap = makeMap([
      ["x-acct", true],          // X — Orbit-direct (e.g. August New Cascadia bug scenario)
      ["fb-acct", false],        // Facebook — needs CSV
    ]);

    it("excludes X posts from CSV when X has autoPublish=true", () => {
      const xPost = { deliveryMode: null, socialAccountId: "x-acct" };
      expect(isOrbitDirectPost(xPost, autoPublishMap)).toBe(true);
    });

    it("includes Facebook posts in CSV when Facebook has autoPublish=false", () => {
      const fbPost = { deliveryMode: null, socialAccountId: "fb-acct" };
      expect(isOrbitDirectPost(fbPost, autoPublishMap)).toBe(false);
    });

    it("explicit deliveryMode='csv' on X account still exports to CSV", () => {
      const xCsvPost = { deliveryMode: "csv", socialAccountId: "x-acct" };
      expect(isOrbitDirectPost(xCsvPost, autoPublishMap)).toBe(false);
    });
  });
});
