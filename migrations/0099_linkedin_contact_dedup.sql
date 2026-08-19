-- backfill:always-apply
-- Add a partial unique index on (tenant_domain, linkedin_url) so that
-- LinkedIn-only contacts are deduplicated at the database level, matching
-- the email uniqueness contract for email-bearing contacts.
--
-- Before adding the index we must collapse any pre-existing duplicates.
-- Keeper selection: the contact with the most non-null person fields wins;
-- ties break on created_at ASC (oldest first) then id.

-- 1. Identify one keeper per (tenant_domain, linkedin_url).
CREATE TEMP TABLE linkedin_dedup_keepers AS
SELECT DISTINCT ON (tenant_domain, linkedin_url) id AS keeper_id, tenant_domain, linkedin_url
FROM marketing_contacts
WHERE linkedin_url IS NOT NULL
ORDER BY
  tenant_domain,
  linkedin_url,
  -- prefer contacts with more data
  (CASE WHEN email      IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN first_name IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN last_name  IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN company    IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN job_title  IS NOT NULL THEN 1 ELSE 0 END) DESC,
  created_at ASC,
  id;

-- 2. Back-fill missing fields on the keeper from duplicates.
UPDATE marketing_contacts keeper SET
  email        = COALESCE(keeper.email,      agg.email),
  first_name   = COALESCE(keeper.first_name, agg.first_name),
  last_name    = COALESCE(keeper.last_name,  agg.last_name),
  company      = COALESCE(keeper.company,    agg.company),
  job_title    = COALESCE(keeper.job_title,  agg.job_title),
  hubspot_contact_id = COALESCE(keeper.hubspot_contact_id, agg.hubspot_contact_id),
  hubspot_company_id = COALESCE(keeper.hubspot_company_id, agg.hubspot_company_id),
  updated_at   = now()
FROM linkedin_dedup_keepers k
CROSS JOIN LATERAL (
  SELECT
    (array_remove(array_agg(dup.email              ORDER BY dup.updated_at DESC), NULL))[1] AS email,
    (array_remove(array_agg(dup.first_name         ORDER BY dup.updated_at DESC), NULL))[1] AS first_name,
    (array_remove(array_agg(dup.last_name          ORDER BY dup.updated_at DESC), NULL))[1] AS last_name,
    (array_remove(array_agg(dup.company            ORDER BY dup.updated_at DESC), NULL))[1] AS company,
    (array_remove(array_agg(dup.job_title          ORDER BY dup.updated_at DESC), NULL))[1] AS job_title,
    (array_remove(array_agg(dup.hubspot_contact_id ORDER BY dup.updated_at DESC), NULL))[1] AS hubspot_contact_id,
    (array_remove(array_agg(dup.hubspot_company_id ORDER BY dup.updated_at DESC), NULL))[1] AS hubspot_company_id
  FROM marketing_contacts dup
  WHERE dup.tenant_domain = k.tenant_domain
    AND dup.linkedin_url  = k.linkedin_url
    AND dup.id <> k.keeper_id
) agg
WHERE keeper.id = k.keeper_id;

-- 3. Repoint prospect memberships from duplicates onto the keeper.
--    prospects already has a unique (campaign_id, contact_id) index, so we
--    must handle collisions: if the keeper already has a membership on the
--    same campaign, preserve it (and merge useful fields from the duplicate),
--    then delete the duplicate membership rather than updating it.

-- 3a. Back-fill membership fields from colliding duplicate memberships onto
--     the keeper's existing membership (most-recently-updated duplicate first).
--     Rewritten as a derived-table aggregation to avoid the PostgreSQL alias
--     conflict that occurs when the UPDATE target table alias matches a FROM
--     join alias (UPDATE prospects keeper_m ... JOIN prospects keeper_m ...).
UPDATE prospects SET
  research_dossier    = COALESCE(prospects.research_dossier,    vals.research_dossier),
  icp_score           = COALESCE(prospects.icp_score,           vals.icp_score),
  score_breakdown     = COALESCE(prospects.score_breakdown,     vals.score_breakdown),
  disqualified_reason = COALESCE(prospects.disqualified_reason, vals.disqualified_reason),
  signals             = COALESCE(prospects.signals,             vals.signals),
  created_at          = LEAST(prospects.created_at, vals.min_created_at),
  updated_at          = now()
FROM (
  SELECT
    keeper_m.id AS keeper_m_id,
    (array_remove(array_agg(dup_m.research_dossier    ORDER BY dup_m.updated_at DESC), NULL))[1] AS research_dossier,
    (array_remove(array_agg(dup_m.icp_score           ORDER BY dup_m.updated_at DESC), NULL))[1] AS icp_score,
    (array_remove(array_agg(dup_m.score_breakdown     ORDER BY dup_m.updated_at DESC), NULL))[1] AS score_breakdown,
    (array_remove(array_agg(dup_m.disqualified_reason ORDER BY dup_m.updated_at DESC), NULL))[1] AS disqualified_reason,
    (array_remove(array_agg(dup_m.signals             ORDER BY dup_m.updated_at DESC), NULL))[1] AS signals,
    min(dup_m.created_at) AS min_created_at
  FROM linkedin_dedup_keepers k
  JOIN prospects keeper_m ON keeper_m.contact_id = k.keeper_id
  JOIN marketing_contacts dup_c
    ON dup_c.tenant_domain = k.tenant_domain
    AND dup_c.linkedin_url = k.linkedin_url
    AND dup_c.id           <> k.keeper_id
  JOIN prospects dup_m
    ON dup_m.contact_id  = dup_c.id
    AND dup_m.campaign_id = keeper_m.campaign_id
  GROUP BY keeper_m.id
) vals
WHERE prospects.id = vals.keeper_m_id
  AND vals.min_created_at IS NOT NULL;

-- 3b. Repoint touch history from colliding duplicate memberships onto the
--     keeper's membership before the duplicate memberships are deleted.
UPDATE outreach_touches t SET prospect_id = keeper_m.id
FROM linkedin_dedup_keepers k
JOIN prospects keeper_m ON keeper_m.contact_id = k.keeper_id
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
JOIN prospects dup_m
  ON dup_m.contact_id  = dup_c.id
  AND dup_m.campaign_id = keeper_m.campaign_id
WHERE t.prospect_id = dup_m.id;

-- 3c. Delete colliding duplicate memberships (same campaign as keeper's membership).
DELETE FROM prospects dup_m
USING linkedin_dedup_keepers k
JOIN prospects keeper_m ON keeper_m.contact_id = k.keeper_id
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
WHERE dup_m.contact_id  = dup_c.id
  AND dup_m.campaign_id = keeper_m.campaign_id;

-- 3d. Repoint remaining (non-colliding) duplicate memberships to the keeper.
UPDATE prospects SET contact_id = k.keeper_id, updated_at = now()
FROM linkedin_dedup_keepers k
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
WHERE prospects.contact_id = dup_c.id;

-- 4. Repoint marketing_contact_events from duplicates onto the keeper.
UPDATE marketing_contact_events e SET contact_id = k.keeper_id
FROM linkedin_dedup_keepers k
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
WHERE e.contact_id = dup_c.id;

-- 5. Reconcile marketing_segment_members.
--    PK is (segment_id, contact_id), so rows where the keeper is already in
--    the same segment must be deleted; other rows are repointed.

-- 5a. Delete duplicate rows where keeper is already a segment member.
DELETE FROM marketing_segment_members dup_sm
USING linkedin_dedup_keepers k
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
WHERE dup_sm.contact_id = dup_c.id
  AND EXISTS (
    SELECT 1 FROM marketing_segment_members keeper_sm
    WHERE keeper_sm.contact_id = k.keeper_id
      AND keeper_sm.segment_id = dup_sm.segment_id
  );

-- 5b. Repoint remaining segment memberships to the keeper.
UPDATE marketing_segment_members dup_sm SET contact_id = k.keeper_id
FROM linkedin_dedup_keepers k
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
WHERE dup_sm.contact_id = dup_c.id;

-- 6. Repoint marketing_workflow_enrollments from duplicates onto the keeper.
--    No unique constraint on (workflow_id, contact_id), so a plain repoint works.
--    marketing_workflow_step_runs cascade from enrollments and survive intact.
UPDATE marketing_workflow_enrollments e SET contact_id = k.keeper_id, updated_at = now()
FROM linkedin_dedup_keepers k
JOIN marketing_contacts dup_c
  ON dup_c.tenant_domain = k.tenant_domain
  AND dup_c.linkedin_url = k.linkedin_url
  AND dup_c.id           <> k.keeper_id
WHERE e.contact_id = dup_c.id;

-- 7. Delete the duplicate contacts (all FK children repointed above).
DELETE FROM marketing_contacts dup_c
USING linkedin_dedup_keepers k
WHERE dup_c.linkedin_url  = k.linkedin_url
  AND dup_c.tenant_domain = k.tenant_domain
  AND dup_c.id            <> k.keeper_id;

DROP TABLE linkedin_dedup_keepers;

-- 8. Enforce uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_contacts_tenant_linkedin_uniq
  ON marketing_contacts (tenant_domain, linkedin_url)
  WHERE linkedin_url IS NOT NULL;
