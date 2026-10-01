/**
 * Dry-run only: validate a recovery file against connection-local TEMP tables.
 * Never writes real contact/campaign/market data. Always rolls back.
 */
import fs from "node:fs";
import { pool } from "../server/db";

const file = process.argv[2];
if (!file) throw new Error("Usage: tsx scripts/validate-outreach-recovery.ts <recovery.sql>");
const sql = fs.readFileSync(file, "utf8");
const match = sql.match(/\$orbit_recovery_payload\$([\s\S]*?)\$orbit_recovery_payload\$/);
if (!match) throw new Error("Recovery payload not found");
const data = JSON.parse(match[1]);
const tenant = data.prospects[0].tenant_domain;
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const table of ["marketing_contacts", "prospects", "outreach_touches"]) {
    await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
  }
  await client.query("CREATE TEMP TABLE outreach_campaigns (id varchar PRIMARY KEY, tenant_domain text, status text) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE markets (LIKE public.markets INCLUDING ALL) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE tenants (LIKE public.tenants INCLUDING ALL) ON COMMIT DROP");
  await client.query("INSERT INTO tenants (id, domain, name) VALUES ('recovery-test-tenant', $1, 'Recovery validation')", [tenant]);
  for (const id of new Set(data.prospects.map((p: { campaign_id: string }) => p.campaign_id))) {
    await client.query("INSERT INTO outreach_campaigns VALUES ($1, $2, 'draft')", [id, tenant]);
  }
  for (const id of new Set(data.prospects.map((p: { market_id: string }) => p.market_id))) {
    await client.query("INSERT INTO markets (id, tenant_id, name, created_by) VALUES ($1, 'recovery-test-tenant', 'Recovery validation', 'recovery-test-user')", [id]);
  }
  await client.query("ALTER TABLE prospects ADD FOREIGN KEY (contact_id) REFERENCES marketing_contacts(id)");
  await client.query("ALTER TABLE prospects ADD FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns(id)");
  await client.query("ALTER TABLE outreach_touches ADD FOREIGN KEY (prospect_id) REFERENCES prospects(id)");
  await client.query("ALTER TABLE outreach_touches ADD FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns(id)");
  await client.query("INSERT INTO marketing_contacts (id, tenant_domain, email) VALUES ('recovery-nontarget-check', 'nontarget.example', 'test@nontarget.example')");

  // Run within our rollback-only transaction, not the deliverable's COMMIT.
  const dryRunSql = sql.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  await client.query(dryRunSql);
  const { rows } = await client.query(`
    SELECT
      (SELECT count(*) FROM marketing_contacts WHERE tenant_domain = $1) AS contacts,
      (SELECT count(*) FROM prospects WHERE tenant_domain = $1) AS prospects,
      (SELECT count(*) FROM outreach_touches WHERE tenant_domain = $1) AS touches,
      (SELECT count(*) FROM outreach_touches WHERE tenant_domain = $1 AND status = 'sent') AS sent,
      (SELECT count(*) FROM outreach_touches WHERE tenant_domain = $1 AND status = 'draft_pending_approval') AS held,
      (SELECT count(*) FROM marketing_contacts WHERE tenant_domain = 'nontarget.example') AS other_tenant_preserved,
      (SELECT count(*) FROM marketing_contacts WHERE tenant_domain = $1 AND email_opt_out = false) AS unheld_contacts
  `, [tenant]);
  if (rows[0].other_tenant_preserved !== "1" || rows[0].unheld_contacts !== "0") {
    throw new Error("Tenant isolation/consent hold verification failed");
  }
  // Ensure the stored message text survives COPY unescaping and JSON transport.
  const { rows: recovered } = await client.query("SELECT id, body, subject, sent_at FROM outreach_touches WHERE tenant_domain = $1", [tenant]);
  for (const expected of data.touches) {
    const actual = recovered.find((r) => r.id === expected.id);
    if (!actual || actual.body !== expected.body || actual.subject !== expected.subject) {
      throw new Error("Recovered message content mismatch");
    }
  }
  console.log("TEMP-table validation passed:", rows[0]);
  // Replay must stop without overwriting the newly restored rows.
  await client.query("SAVEPOINT replay_check");
  await client.query("DROP TABLE orbit_recovery_payload");
  let replayBlocked = false;
  try {
    await client.query(dryRunSql);
  } catch (error: unknown) {
    replayBlocked = error instanceof Error && error.message.includes("tenant already has");
  }
  await client.query("ROLLBACK TO SAVEPOINT replay_check");
  if (!replayBlocked) throw new Error("Replay guard did not block recovery");
  console.log("Replay guard passed; all validation changes rolled back.");
} catch (error: unknown) {
  // Do not print pg error detail: it can contain personal contact data.
  console.error("Recovery validation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}