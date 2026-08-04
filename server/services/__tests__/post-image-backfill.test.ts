/**
 * Tests for the post image backfill migration (0070_backfill_post_image_urls.sql).
 *
 * There are two complementary concerns:
 *
 * 1. Migration correctness — verify that the actual SQL in the migration file
 *    has the right structure (COALESCE order, correct WHERE conditions) so a
 *    future edit cannot silently break the backfill.
 *
 * 2. Generation-time invariant — verify that `resolveBrandAssetUrl`, the
 *    utility now used by marketing-saturn.ts at generation time, produces
 *    values consistent with the migration's COALESCE(file_url, url) rule and
 *    that the generation path never writes overrideBrandAssetId without a
 *    resolved overrideImageUrl.
 *
 * These tests exercise real code paths:
 *  - `resolveBrandAssetUrl` is the function imported by marketing-saturn.ts.
 *  - The migration SQL is read directly from the file on disk.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { describe, it } from "vitest";

import { resolveBrandAssetUrl } from "../brand-asset-url";

// ── Migration SQL assertion helpers ───────────────────────────────────────────

const MIGRATION_PATH = join(
  import.meta.dirname,
  "../../../migrations/0070_backfill_post_image_urls.sql",
);

function loadMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

/** Strip SQL comments and collapse whitespace for reliable substring checks. */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")  // strip line comments
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── Generation-time row-builder (mirrors marketing-saturn.ts ~line 5119) ──────
//
// Builds the spread that is pushed into generatedRows. The real code is:
//
//   const brandUrl = resolveBrandAssetUrl(img);
//   generatedRows.push({
//     ...buildBaseRow(v),
//     ...(brandUrl
//       ? { overrideBrandAssetId: img.id, overrideImageUrl: brandUrl }
//       : {}),
//   });
//
// The helper below encodes exactly that conditional — it imports the same
// `resolveBrandAssetUrl` function, so a change to that function is
// immediately reflected here.

interface BrandAssetLike {
  id: string;
  fileUrl?: string | null;
  url?: string | null;
}

function brandAssetFields(
  asset: BrandAssetLike,
): { overrideBrandAssetId: string; overrideImageUrl: string } | Record<string, never> {
  const brandUrl = resolveBrandAssetUrl(asset);
  return brandUrl
    ? { overrideBrandAssetId: asset.id, overrideImageUrl: brandUrl }
    : {};
}

// ── Tests: migration SQL structure ────────────────────────────────────────────

describe("migration 0070 — SQL structure", () => {
  it("migration file exists and is non-empty", () => {
    const sql = loadMigrationSql();
    assert.ok(sql.trim().length > 0, "migration file must not be empty");
  });

  it("targets the generated_posts table", () => {
    const sql = normalizeSql(loadMigrationSql());
    assert.ok(
      sql.includes("update generated_posts"),
      "must UPDATE generated_posts",
    );
  });

  it("sets override_image_url via COALESCE(file_url, url) — fileUrl takes precedence", () => {
    const sql = normalizeSql(loadMigrationSql());
    // The SET clause must use COALESCE with file_url before url so the
    // resolution order matches resolveBrandAssetUrl (fileUrl || url || null).
    assert.ok(
      sql.includes("set override_image_url = coalesce(ba.file_url, ba.url)"),
      `SET clause must be COALESCE(ba.file_url, ba.url); got:\n${sql}`,
    );
  });

  it("joins brand_assets to resolve the URL", () => {
    const sql = normalizeSql(loadMigrationSql());
    assert.ok(
      sql.includes("from brand_assets"),
      "migration must join brand_assets",
    );
  });

  it("only updates rows where override_image_url IS NULL (idempotent)", () => {
    const sql = normalizeSql(loadMigrationSql());
    assert.ok(
      sql.includes("override_image_url is null"),
      "WHERE clause must guard override_image_url IS NULL so re-runs don't overwrite",
    );
  });

  it("only updates rows where override_brand_asset_id IS NOT NULL", () => {
    const sql = normalizeSql(loadMigrationSql());
    assert.ok(
      sql.includes("override_brand_asset_id is not null"),
      "WHERE clause must require override_brand_asset_id IS NOT NULL",
    );
  });

  it("joins on the FK — generated_posts.override_brand_asset_id = ba.id", () => {
    const sql = normalizeSql(loadMigrationSql());
    assert.ok(
      sql.includes("generated_posts.override_brand_asset_id = ba.id"),
      "must join generated_posts to brand_assets via the FK",
    );
  });
});

// ── Tests: resolveBrandAssetUrl (real function used at generation time) ────────

describe("resolveBrandAssetUrl — COALESCE(fileUrl, url)", () => {
  it("returns fileUrl when both fileUrl and url are set (fileUrl wins)", () => {
    assert.equal(
      resolveBrandAssetUrl({
        fileUrl: "https://cdn.example.com/logo.png",
        url: "https://bucket.example.com/logo.png",
      }),
      "https://cdn.example.com/logo.png",
    );
  });

  it("falls back to url when fileUrl is null", () => {
    assert.equal(
      resolveBrandAssetUrl({ fileUrl: null, url: "https://bucket.example.com/banner.jpg" }),
      "https://bucket.example.com/banner.jpg",
    );
  });

  it("falls back to url when fileUrl is undefined", () => {
    assert.equal(
      resolveBrandAssetUrl({ url: "https://bucket.example.com/banner.jpg" }),
      "https://bucket.example.com/banner.jpg",
    );
  });

  it("returns null when both fileUrl and url are null", () => {
    assert.equal(resolveBrandAssetUrl({ fileUrl: null, url: null }), null);
  });

  it("returns null when both fileUrl and url are undefined", () => {
    assert.equal(resolveBrandAssetUrl({}), null);
  });

  it("returns null for empty-string fileUrl and null url", () => {
    // Empty string is falsy — treated as absent.
    assert.equal(resolveBrandAssetUrl({ fileUrl: "", url: null }), null);
  });

  it("resolution order matches migration COALESCE(file_url, url)", () => {
    // This test makes the contract explicit: fileUrl MUST shadow url.
    // If someone changes the function to `url || fileUrl`, this fails.
    const result = resolveBrandAssetUrl({
      fileUrl: "https://cdn.example.com/preferred.png",
      url: "https://bucket.example.com/fallback.png",
    });
    assert.equal(result, "https://cdn.example.com/preferred.png");
    assert.notEqual(result, "https://bucket.example.com/fallback.png");
  });
});

// ── Tests: generation-time invariant (no broken-state rows) ───────────────────

describe("generation-time brand-asset row builder — invariant: no overrideBrandAssetId without overrideImageUrl", () => {
  it("sets both overrideBrandAssetId and overrideImageUrl when fileUrl is set", () => {
    const fields = brandAssetFields({ id: "ba1", fileUrl: "https://cdn.example.com/logo.png", url: null });
    assert.equal(fields.overrideBrandAssetId, "ba1");
    assert.equal(fields.overrideImageUrl, "https://cdn.example.com/logo.png");
  });

  it("sets both fields when only url is set", () => {
    const fields = brandAssetFields({ id: "ba2", fileUrl: null, url: "https://bucket.example.com/banner.jpg" });
    assert.equal(fields.overrideBrandAssetId, "ba2");
    assert.equal(fields.overrideImageUrl, "https://bucket.example.com/banner.jpg");
  });

  it("sets neither field when asset has no URL — prevents recreating the broken state", () => {
    // When the brand asset carries no URL, we must not write overrideBrandAssetId
    // without overrideImageUrl, as that is exactly the broken state migration
    // 0070 was written to repair.
    const fields = brandAssetFields({ id: "ba3", fileUrl: null, url: null });
    assert.equal(
      "overrideBrandAssetId" in fields,
      false,
      "must not set overrideBrandAssetId when there is no resolved URL",
    );
    assert.equal(
      "overrideImageUrl" in fields,
      false,
      "must not set overrideImageUrl when there is no resolved URL",
    );
  });

  it("the two fields are always set together or never — the invariant holds across a batch", () => {
    const assets: BrandAssetLike[] = [
      { id: "ba1", fileUrl: "https://cdn.example.com/a1.png", url: null },
      { id: "ba2", fileUrl: null, url: "https://bucket.example.com/a2.png" },
      { id: "ba3", fileUrl: "https://cdn.example.com/a3.png", url: "https://bucket.example.com/a3-fallback.png" },
      { id: "ba4", fileUrl: null, url: null }, // no URL — must not create association
    ];

    for (const asset of assets) {
      const fields = brandAssetFields(asset);
      const hasId = "overrideBrandAssetId" in fields;
      const hasUrl = "overrideImageUrl" in fields;
      assert.equal(
        hasId,
        hasUrl,
        `overrideBrandAssetId and overrideImageUrl must both be set or both absent for asset ${asset.id}`,
      );
      if (hasId) {
        assert.ok(
          (fields as any).overrideImageUrl,
          `overrideImageUrl must be a non-empty string when set (asset ${asset.id})`,
        );
      }
    }
  });

  it("fileUrl shadows url when both present — consistent with migration COALESCE order", () => {
    const fields = brandAssetFields({
      id: "ba5",
      fileUrl: "https://cdn.example.com/preferred.png",
      url: "https://bucket.example.com/fallback.png",
    }) as { overrideBrandAssetId: string; overrideImageUrl: string };
    assert.equal(fields.overrideImageUrl, "https://cdn.example.com/preferred.png");
  });
});
