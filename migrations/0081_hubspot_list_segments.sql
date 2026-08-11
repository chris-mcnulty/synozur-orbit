-- HubSpot-list-backed segments (Task: use HubSpot lists as send audiences).
-- A segment with source='hubspot_list' mirrors membership FROM a HubSpot
-- contact list (snapshot import + on-demand/pre-send refresh) instead of
-- evaluating rule_json. Rules-based segments keep source='rules'.

ALTER TABLE "marketing_segments" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'rules';
ALTER TABLE "marketing_segments" ADD COLUMN IF NOT EXISTS "hubspot_list_name" text;
ALTER TABLE "marketing_segments" ADD COLUMN IF NOT EXISTS "hubspot_sync_status" text;
ALTER TABLE "marketing_segments" ADD COLUMN IF NOT EXISTS "hubspot_sync_error" text;
ALTER TABLE "marketing_segments" ADD COLUMN IF NOT EXISTS "last_hubspot_sync_at" timestamp;

-- One linked segment per (tenant, hubspot list) for hubspot_list-sourced rows.
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_segments_hubspot_list_uniq"
  ON "marketing_segments" ("tenant_domain", "hubspot_list_id")
  WHERE "source" = 'hubspot_list';
