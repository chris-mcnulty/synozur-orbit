import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type pg from "pg";
import { computeBackfillPlan, extractDroppedTableNames } from "./db-migrate";

/**
 * Regression test: on first boot against an established database (empty
 * _migrations ledger), destructive drop-only migrations whose target tables
 * still exist must be APPLIED, not backfill-stamped as already applied.
 * (Previously any file without CREATE TABLE was blindly stamped, so
 * 0076_drop_observatory_tables.sql would never run in production.)
 */

function fakePool(existingTables: Set<string>): pg.Pool {
  return {
    query: async (_sql: string, params?: unknown[]) => {
      const tbl = params?.[0] as string;
      return { rows: existingTables.has(tbl) ? [{ 1: 1 }] : [] };
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
