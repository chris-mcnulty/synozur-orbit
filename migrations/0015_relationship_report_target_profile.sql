-- Relationship Reports: cross-market baseline company targeting
-- Adds targetCompanyProfileId so a report can target another market's
-- baseline company (not just a tracked competitor in the current market).
-- companyProfileId continues to store the SOURCE perspective; only one of
-- competitorId / targetCompanyProfileId should be set per row.

ALTER TABLE "relationship_reports"
  ADD COLUMN IF NOT EXISTS "target_company_profile_id" varchar;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'relationship_reports_target_company_profile_id_company_profiles_id_fk'
  ) THEN
    ALTER TABLE "relationship_reports"
      ADD CONSTRAINT "relationship_reports_target_company_profile_id_company_profiles_id_fk"
      FOREIGN KEY ("target_company_profile_id")
      REFERENCES "public"."company_profiles"("id") ON DELETE set null;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "relationship_reports_target_profile_idx"
  ON "relationship_reports" ("target_company_profile_id");
