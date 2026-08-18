-- backfill:always-apply
-- A prospect is a contact's membership on a campaign — one row per
-- (campaign, contact). Reconcile any existing duplicates, then enforce
-- uniqueness so retried/concurrent imports and repeated manual adds can
-- never create duplicate memberships (and duplicate touches/cadence work).
--
-- Keeper precedence: the MOST RECENTLY UPDATED membership wins, so the
-- current cadence state (status, next_action_at, owner_user_id) is the one
-- that survives — an older stale "new" row must never overwrite a newer
-- replied/working membership. Ties break on created_at DESC, then id.

-- 1. Pick a keeper per (campaign_id, contact_id).
CREATE TEMP TABLE prospect_membership_keepers AS
SELECT DISTINCT ON (campaign_id, contact_id) id AS keeper_id, campaign_id, contact_id
FROM prospects
ORDER BY campaign_id, contact_id, updated_at DESC, created_at DESC, id;

-- 2. Repoint touch history from duplicate memberships onto the keeper.
UPDATE outreach_touches t SET prospect_id = k.keeper_id
FROM prospects p
JOIN prospect_membership_keepers k
  ON k.campaign_id = p.campaign_id AND k.contact_id = p.contact_id
WHERE t.prospect_id = p.id
  AND p.id <> k.keeper_id;

-- 3. Backfill research/scoring the keeper is missing from its duplicates
--    (most recently updated duplicate first), and keep the earliest
--    created_at so membership age is preserved.
UPDATE prospects keeper SET
  research_dossier    = COALESCE(keeper.research_dossier, agg.research_dossier),
  icp_score           = COALESCE(keeper.icp_score, agg.icp_score),
  score_breakdown     = COALESCE(keeper.score_breakdown, agg.score_breakdown),
  disqualified_reason = COALESCE(keeper.disqualified_reason, agg.disqualified_reason),
  signals             = COALESCE(keeper.signals, agg.signals),
  created_at          = LEAST(keeper.created_at, agg.min_created_at),
  updated_at          = now()
FROM prospect_membership_keepers k
CROSS JOIN LATERAL (
  SELECT
    (array_remove(array_agg(dup.research_dossier ORDER BY dup.updated_at DESC), NULL))[1] AS research_dossier,
    (array_remove(array_agg(dup.icp_score ORDER BY dup.updated_at DESC), NULL))[1] AS icp_score,
    (array_remove(array_agg(dup.score_breakdown ORDER BY dup.updated_at DESC), NULL))[1] AS score_breakdown,
    (array_remove(array_agg(dup.disqualified_reason ORDER BY dup.updated_at DESC), NULL))[1] AS disqualified_reason,
    (array_remove(array_agg(dup.signals ORDER BY dup.updated_at DESC), NULL))[1] AS signals,
    min(dup.created_at) AS min_created_at
  FROM prospects dup
  WHERE dup.campaign_id = k.campaign_id
    AND dup.contact_id = k.contact_id
    AND dup.id <> k.keeper_id
) agg
WHERE keeper.id = k.keeper_id
  AND agg.min_created_at IS NOT NULL;

-- 4. Delete the duplicates (their touches were repointed in step 2).
DELETE FROM prospects p
USING prospect_membership_keepers k
WHERE k.campaign_id = p.campaign_id
  AND k.contact_id = p.contact_id
  AND p.id <> k.keeper_id;

DROP TABLE prospect_membership_keepers;

-- 5. Enforce one membership per contact per campaign.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_campaign_contact_uniq
  ON prospects (campaign_id, contact_id);
