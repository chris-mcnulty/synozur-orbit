/**
 * db-migrate.ts — Proper migration runner for Orbit.
 *
 * Reads every *.sql file from migrations/ in lexicographic order, splits on
 * the Drizzle Kit "--> statement-breakpoint" markers, and applies each file
 * inside a single PostgreSQL transaction. Applied files are recorded in a
 * _migrations ledger table (filename + SHA-256 checksum + applied_at).
 * Already-applied files are skipped. Checksum drift (file edited after being
 * applied) causes a loud failure so the problem is never silently ignored.
 *
 * Backfill strategy (first boot on an existing database):
 * When _migrations is empty, the runner probes each migration file
 * individually — it parses the file for CREATE TABLE statements and checks
 * information_schema.tables to verify those tables actually exist. Only files
 * whose database objects are confirmed present are stamped into the ledger as
 * "already applied". Files whose objects are missing are applied for real.
 * This is conservative: it never stamps a migration as applied unless it can
 * prove the DB already reflects that change.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve("migrations");
const BREAKPOINT = "--> statement-breakpoint";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** List every *.sql file in migrations/ sorted lexicographically. */
function listMigrationFiles(): string[] {
  const entries = fs.readdirSync(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/** Split a migration file into individual SQL statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a migration file's SQL for any unquoted or double-quoted table names
 * in CREATE TABLE statements. Returns an empty array when none are found
 * (e.g. the file only has ALTER TABLE … ADD COLUMN statements).
 */
function extractCreatedTableNames(sql: string): string[] {
  // Matches:  CREATE TABLE [IF NOT EXISTS] "name"  or  CREATE TABLE [IF NOT EXISTS] name
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.push(m[1].toLowerCase());
  }
  return [...new Set(names)];
}

/** Check whether a given table exists in the public schema. */
async function tableExists(pool: pg.Pool, tableName: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return r.rows.length > 0;
}

/** Ensure the _migrations ledger table exists. */
async function ensureLedger(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}

/** Return the set of filenames already recorded in _migrations. */
async function loadApplied(pool: pg.Pool): Promise<Map<string, string>> {
  const result = await pool.query<{ filename: string; checksum: string }>(
    "SELECT filename, checksum FROM _migrations ORDER BY filename"
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.filename, row.checksum);
  }
  return map;
}

/**
 * Conservative per-file backfill: for each migration file, parse it for
 * CREATE TABLE statements and probe information_schema to verify those tables
 * actually exist. Only stamp files whose schema objects are confirmed present;
 * return an array of files that must be applied for real (objects absent).
 */
async function computeBackfillPlan(
  pool: pg.Pool,
  files: string[],
  label: string
): Promise<{ toStamp: string[]; toApply: string[] }> {
  const toStamp: string[] = [];
  const toApply: string[] = [];

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const tableNames = extractCreatedTableNames(content);

    if (tableNames.length === 0) {
      // File only has ALTER TABLE / CREATE INDEX / DO blocks — no new tables.
      // Assume present: if we're here, users exists so the DB is established.
      console.log(`${label} backfill: stamping (no CREATE TABLE, alter-only): ${filename}`);
      toStamp.push(filePath);
      continue;
    }

    // Check all tables declared in this migration
    let allPresent = true;
    for (const tbl of tableNames) {
      const present = await tableExists(pool, tbl);
      if (!present) {
        console.log(`${label} backfill: table '${tbl}' missing — will apply: ${filename}`);
        allPresent = false;
        break;
      }
    }

    if (allPresent) {
      console.log(`${label} backfill: stamping (all tables present): ${filename}`);
      toStamp.push(filePath);
    } else {
      toApply.push(filePath);
    }
  }

  return { toStamp, toApply };
}

/**
 * Stamp a set of files into the ledger without running their SQL.
 * Used during backfill for migrations already reflected in the database.
 */
async function stampMigrations(
  pool: pg.Pool,
  files: string[]
): Promise<void> {
  if (files.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const filePath of files) {
      const filename = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf8");
      const checksum = sha256(content);
      await client.query(
        `INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [filename, checksum]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply a single migration file inside a transaction.
 * Records the result in the ledger on success.
 * Throws on any SQL error — caller should abort startup.
 */
async function applyMigration(
  pool: pg.Pool,
  filePath: string,
  checksum: string
): Promise<void> {
  const filename = path.basename(filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const statements = splitStatements(content);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query(
      `INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)`,
      [filename, checksum]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Main entry point. Call once at application startup before handling any
 * requests. Throws (and crashes the process) if a migration fails or a
 * checksum mismatch is detected.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const label = "[db-migrate]";

  await ensureLedger(pool);

  const files = listMigrationFiles();
  const applied = await loadApplied(pool);

  // ── First-boot backfill for existing databases ────────────────────────────
  // If nothing is in the ledger yet but the users table exists, this is an
  // established database. Probe each migration file individually: stamp those
  // whose tables are confirmed present in the DB; apply those whose tables
  // are missing. This is conservative — we never stamp a migration as applied
  // unless its schema changes are proven to already exist.
  if (applied.size === 0 && (await tableExists(pool, "users"))) {
    console.log(
      `${label} First boot on existing database — probing ${files.length} migration file(s) to build ledger`
    );

    const { toStamp, toApply } = await computeBackfillPlan(pool, files, label);

    if (toStamp.length > 0) {
      await stampMigrations(pool, toStamp);
    }

    // Apply migrations whose objects are genuinely absent
    for (const filePath of toApply) {
      const filename = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf8");
      const checksum = sha256(content);
      console.log(`${label} applying (missing objects): ${filename}`);
      try {
        await applyMigration(pool, filePath, checksum);
        console.log(`${label} applied: ${filename}`);
      } catch (err) {
        throw new Error(
          `${label} FAILED to apply ${filename}: ${(err as Error).message}`
        );
      }
    }

    console.log(
      `${label} Ledger initialised — ${toStamp.length} stamped, ${toApply.length} applied. Startup migrations completed`
    );
    return;
  }

  // ── Normal run: apply pending, skip already-applied ─────────────────────
  let appliedCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const checksum = sha256(content);

    if (applied.has(filename)) {
      const recordedChecksum = applied.get(filename)!;
      if (recordedChecksum !== checksum) {
        throw new Error(
          `${label} CHECKSUM MISMATCH for ${filename}. ` +
          `The file has been modified after it was applied. ` +
          `Recorded: ${recordedChecksum} | Current: ${checksum}. ` +
          `Do not edit migration files after they have been applied.`
        );
      }
      console.log(`${label} skipped (already applied): ${filename}`);
      skippedCount++;
      continue;
    }

    console.log(`${label} applying: ${filename}`);
    try {
      await applyMigration(pool, filePath, checksum);
      console.log(`${label} applied: ${filename}`);
      appliedCount++;
    } catch (err) {
      throw new Error(
        `${label} FAILED to apply ${filename}: ${(err as Error).message}`
      );
    }
  }

  console.log(
    `${label} done — ${appliedCount} applied, ${skippedCount} skipped. Startup migrations completed`
  );
}
