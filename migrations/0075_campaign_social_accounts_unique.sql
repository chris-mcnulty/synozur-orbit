-- Deduplicate existing campaign/social-account links (keep the earliest row),
-- then enforce uniqueness so concurrent generation runs can't double-link.
DELETE FROM campaign_social_accounts a
USING campaign_social_accounts b
WHERE a.campaign_id = b.campaign_id
  AND a.social_account_id = b.social_account_id
  AND a.added_at > b.added_at;

DELETE FROM campaign_social_accounts a
USING campaign_social_accounts b
WHERE a.campaign_id = b.campaign_id
  AND a.social_account_id = b.social_account_id
  AND a.added_at = b.added_at
  AND a.id > b.id;

ALTER TABLE campaign_social_accounts
  ADD CONSTRAINT campaign_social_accounts_campaign_account_unique
  UNIQUE (campaign_id, social_account_id);
