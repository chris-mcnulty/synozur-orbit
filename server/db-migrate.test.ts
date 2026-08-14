import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type pg from "pg";
import {
  computeBackfillPlan,
  extractDroppedTableNames,
  extractCreatedIndexNames,
} from "./db-migrate";

/**
 * Regression tests for computeBackfillPlan.
 *
 * Covers:
 * - Destructive drop-only migrations whose target tables still exist must be
 *   APPLIED, not stamped. (0076_drop_observatory_tables pattern)
 * - Index-only migrations (no CREATE TABLE) must be APPLIED when any of their
 *   indexes are absent from pg_indexes, and STAMPED only when all are present.
 *   (0083/0084 pattern — previously any file without CREATE TABLE was blindly
 *   stamped, so index-only migrations would never reach production databases.)
 */

function fakePool(
  existingTables: Set<string>,
  existingIndexes: Set<string> = new Set()
): pg.Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const name = params?.[0] as string;
      // Route to correct lookup based on the query text
      if (sql.includes("pg_indexes")) {
        return { rows: existingIndexes.has(name) ? [{ 1: 1 }] : [] };
      }
      return { rows: existingTables.has(name) ? [{ 1: 1 }] : [] };
    },
  } as unknown as pg.Pool;
}

let dir: string;
const write = (name: string, sql: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, sql);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-test-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("extractDroppedTableNames", () => {
  it("finds quoted and unquoted names with IF EXISTS", () => {
    const sql = `DROP TABLE IF EXISTS "obs_findings";\nDROP TABLE obs_scans CASCADE;`;
    expect(extractDroppedTableNames(sql).sort()).toEqual(["obs_findings", "obs_scans"]);
  });
});

describe("extractCreatedIndexNames", () => {
  it("finds plain and unique indexes with and without IF NOT EXISTS", () => {
    const sql = [
      `CREATE INDEX IF NOT EXISTS "products_tenant_idx" ON products (tenant_domain);`,
      `CREATE UNIQUE INDEX content_uniq ON content_assets (tenant_domain, slug);`,
      `CREATE INDEX my_idx ON other_table (col);`,
    ].join("\n");
    expect(extractCreatedIndexNames(sql).sort()).toEqual([
      "content_uniq",
      "my_idx",
      "products_tenant_idx",
    ]);
  });

  it("returns empty array for a file with no CREATE INDEX", () => {
    const sql = `ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text;`;
    expect(extractCreatedIndexNames(sql)).toEqual([]);
  });
});

describe("computeBackfillPlan destructive-migration handling", () => {
  it("applies (does not stamp) a drop-only migration whose tables still exist", async () => {
    const dropFile = write(
      "0076_drop_observatory_tables.sql",
      `DROP TABLE IF EXISTS "obs_findings";--> statement-breakpoint\nDROP TABLE IF EXISTS "obs_scans";`
    );
    const pool = fakePool(new Set(["obs_findings", "users"]));
    const { toStamp, toApply } = await computeBackfillPlan(pool, [dropFile], "[test]");
    expect(toApply).toEqual([dropFile]);
    expect(toStamp).toEqual([]);
  });

  it("stamps a drop-only migration whose tables are already gone", async () => {
    const dropFile = write(
      "0076_drop_gone.sql",
      `DROP TABLE IF EXISTS "obs_findings";`
    );
    const pool = fakePool(new Set(["users"]));
    const { toStamp, toApply } = await computeBackfillPlan(pool, [dropFile], "[test]");
    expect(toStamp).toEqual([dropFile]);
    expect(toApply).toEqual([]);
  });

  it("still stamps alter-only migrations with no drops", async () => {
    const alterFile = write(
      "0050_alter_only.sql",
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text;`
    );
    const pool = fakePool(new Set(["users"]));
    const { toStamp, toApply } = await computeBackfillPlan(pool, [alterFile], "[test]");
    expect(toStamp).toEqual([alterFile]);
    expect(toApply).toEqual([]);
  });

  it("still applies create-table migrations whose tables are missing", async () => {
    const createFile = write(
      "0051_create_missing.sql",
      `CREATE TABLE IF NOT EXISTS "brand_assets" (id text primary key);`
    );
    const pool = fakePool(new Set(["users"]));
    const { toStamp, toApply } = await computeBackfillPlan(pool, [createFile], "[test]");
    expect(toApply).toEqual([createFile]);
    expect(toStamp).toEqual([]);
  });
});

describe("computeBackfillPlan index-only migration handling", () => {
  it("applies (does not stamp) an index-only migration when any index is absent", async () => {
    const indexFile = write(
      "0084_tenant_scope_indexes.sql",
      [
        `CREATE INDEX IF NOT EXISTS "products_tenant_idx" ON products (tenant_domain);`,
        `--> statement-breakpoint`,
        `CREATE INDEX IF NOT EXISTS "content_assets_tenant_idx" ON content_assets (tenant_domain);`,
      ].join("\n")
    );
    // Only products_tenant_idx is present; content_assets_tenant_idx is missing
    const pool = fakePool(
      new Set(["users"]),
      new Set(["products_tenant_idx"])
    );
    const { toStamp, toApply } = await computeBackfillPlan(pool, [indexFile], "[test]");
    expect(toApply).toEqual([indexFile]);
    expect(toStamp).toEqual([]);
  });

  it("stamps an index-only migration when all indexes are already present", async () => {
    const indexFile = write(
      "0083_homepage_speed_indexes.sql",
      [
        `CREATE INDEX IF NOT EXISTS "markets_tenant_idx" ON markets (tenant_domain);`,
        `--> statement-breakpoint`,
        `CREATE INDEX IF NOT EXISTS "competitors_tenant_idx" ON competitors (tenant_domain);`,
      ].join("\n")
    );
    const pool = fakePool(
      new Set(["users"]),
      new Set(["markets_tenant_idx", "competitors_tenant_idx"])
    );
    const { toStamp, toApply } = await computeBackfillPlan(pool, [indexFile], "[test]");
    expect(toStamp).toEqual([indexFile]);
    expect(toApply).toEqual([]);
  });
});
