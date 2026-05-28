-- Pricing intelligence: scheduled pricing monitor needs a per-competitor
-- "last check" timestamp so we can interval-gate the sweep without scanning
-- the snapshots table. Mirrors lastSocialCrawl / lastWebsiteMonitor pattern.

ALTER TABLE "competitors"
    ADD COLUMN IF NOT EXISTS "last_pricing_check" timestamp;
--> statement-breakpoint

-- Backfill existing rows from the latest snapshot so the first run of the
-- scheduled job doesn't trigger a thundering herd of refreshes for
-- competitors that already have recent snapshots.
UPDATE "competitors" c
SET "last_pricing_check" = sub.last_captured
FROM (
    SELECT "competitor_id", MAX("captured_at") AS last_captured
    FROM "competitor_pricing_snapshots"
    GROUP BY "competitor_id"
) sub
WHERE c.id = sub."competitor_id"
  AND c."last_pricing_check" IS NULL;
