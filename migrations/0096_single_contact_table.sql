-- backfill:always-apply
-- Consolidate prospects into the single marketing_contacts spine.
-- prospects becomes a campaign-membership table (contact_id FK + campaign
-- state); person identity (name/email/title/company/linkedin/hubspot ids)
-- lives only on marketing_contacts. Prospect IDs are preserved so the
-- outreach_touches.prospect_id FK and all touch history survive untouched.

-- 1. marketing_contacts: relax email + add person columns carried from prospects.
ALTER TABLE marketing_contacts ALTER COLUMN email DROP NOT NULL;
DROP INDEX IF EXISTS marketing_contacts_tenant_email_uniq;
CREATE UNIQUE INDEX marketing_contacts_tenant_email_uniq
  ON marketing_contacts (tenant_domain, email) WHERE email IS NOT NULL;
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS hubspot_company_id text;

-- 2. prospects: add the contact FK (nullable during backfill).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS contact_id varchar
  REFERENCES marketing_contacts(id) ON DELETE CASCADE;

-- 3–6. Data backfill — guarded so re-running against an ALREADY-consolidated
-- database (person columns dropped from prospects) is a clean no-op. This
-- makes the file safe as backfill:always-apply on established databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prospects' AND column_name = 'email'
  ) THEN

    -- 3. Link prospects to existing contacts by normalized email.
    UPDATE prospects p SET contact_id = mc.id
    FROM marketing_contacts mc
    WHERE p.contact_id IS NULL
      AND p.email IS NOT NULL AND btrim(p.email) <> ''
      AND mc.tenant_domain = p.tenant_domain
      AND mc.email = lower(btrim(p.email));

    -- 4. Create contacts for unmatched prospects WITH an email
    --    (one contact per distinct tenant+email; oldest prospect wins the seed).
    INSERT INTO marketing_contacts
      (tenant_domain, email, first_name, last_name, company, job_title,
       hubspot_contact_id, hubspot_company_id, linkedin_url, source,
       source_prospect_id, created_at, updated_at)
    SELECT DISTINCT ON (p.tenant_domain, lower(btrim(p.email)))
      p.tenant_domain,
      lower(btrim(p.email)),
      NULLIF(split_part(btrim(p.name), ' ', 1), ''),
      NULLIF(btrim(substr(btrim(p.name), length(split_part(btrim(p.name), ' ', 1)) + 1)), ''),
      p.company_name, p.title,
      p.hubspot_contact_id, p.hubspot_company_id, p.linkedin_url,
      'outreach', p.id, p.created_at, now()
    FROM prospects p
    WHERE p.contact_id IS NULL AND p.email IS NOT NULL AND btrim(p.email) <> ''
    ORDER BY p.tenant_domain, lower(btrim(p.email)), p.created_at;

    -- Re-run the email link for the contacts just created.
    UPDATE prospects p SET contact_id = mc.id
    FROM marketing_contacts mc
    WHERE p.contact_id IS NULL
      AND p.email IS NOT NULL AND btrim(p.email) <> ''
      AND mc.tenant_domain = p.tenant_domain
      AND mc.email = lower(btrim(p.email));

    -- 5. Create one contact per remaining (no-email) prospect and link by
    --    source_prospect_id (no dedupe key exists without an email).
    INSERT INTO marketing_contacts
      (tenant_domain, email, first_name, last_name, company, job_title,
       hubspot_contact_id, hubspot_company_id, linkedin_url, source,
       source_prospect_id, created_at, updated_at)
    SELECT
      p.tenant_domain, NULL,
      NULLIF(split_part(btrim(p.name), ' ', 1), ''),
      NULLIF(btrim(substr(btrim(p.name), length(split_part(btrim(p.name), ' ', 1)) + 1)), ''),
      p.company_name, p.title,
      p.hubspot_contact_id, p.hubspot_company_id, p.linkedin_url,
      'outreach', p.id, p.created_at, now()
    FROM prospects p
    WHERE p.contact_id IS NULL;

    UPDATE prospects p SET contact_id = mc.id
    FROM marketing_contacts mc
    WHERE p.contact_id IS NULL
      AND mc.source_prospect_id = p.id
      AND mc.tenant_domain = p.tenant_domain;

    -- 6. Fill blank person fields on pre-existing linked contacts from the
    --    prospect data being folded in (never clobber; respect opt-out rows'
    --    existing values the same way — COALESCE only fills NULLs).
    UPDATE marketing_contacts mc SET
      job_title          = COALESCE(mc.job_title, p.title),
      company            = COALESCE(mc.company, p.company_name),
      linkedin_url       = COALESCE(mc.linkedin_url, p.linkedin_url),
      hubspot_contact_id = COALESCE(mc.hubspot_contact_id, p.hubspot_contact_id),
      hubspot_company_id = COALESCE(mc.hubspot_company_id, p.hubspot_company_id),
      updated_at         = now()
    FROM prospects p
    WHERE p.contact_id = mc.id
      AND (mc.job_title IS NULL OR mc.company IS NULL OR mc.linkedin_url IS NULL
           OR mc.hubspot_contact_id IS NULL OR mc.hubspot_company_id IS NULL);

  END IF;
END $$;

-- 7. Finalize: enforce the FK and drop the migrated person columns.
ALTER TABLE prospects ALTER COLUMN contact_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS prospects_contact_idx ON prospects (contact_id);
ALTER TABLE prospects
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS company_name,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS linkedin_url,
  DROP COLUMN IF EXISTS hubspot_contact_id,
  DROP COLUMN IF EXISTS hubspot_company_id;
