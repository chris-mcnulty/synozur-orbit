-- Add pricing page URL and last pricing check to company profiles (baseline)
ALTER TABLE "company_profiles" ADD COLUMN "pricing_page_url" text;
ALTER TABLE "company_profiles" ADD COLUMN "last_pricing_check" timestamp;

-- Allow pricing snapshots to belong to baseline company (not just competitors)
ALTER TABLE "competitor_pricing_snapshots" ALTER COLUMN "competitor_id" DROP NOT NULL;
ALTER TABLE "competitor_pricing_snapshots" ADD COLUMN "company_profile_id" varchar REFERENCES "company_profiles"("id") ON DELETE CASCADE;

-- Index for baseline pricing snapshot lookups
CREATE INDEX "competitor_pricing_snapshots_company_profile_captured_idx"
  ON "competitor_pricing_snapshots" ("company_profile_id", "captured_at")
  WHERE "company_profile_id" IS NOT NULL;

-- Index for baseline activity sentiment lookups
CREATE INDEX "activity_company_profile_analyzed_idx"
  ON "activity" ("company_profile_id", "analyzed_at")
  WHERE "company_profile_id" IS NOT NULL;
