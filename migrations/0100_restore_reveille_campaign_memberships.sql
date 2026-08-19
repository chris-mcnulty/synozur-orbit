-- Restore campaign memberships lost after the single-contact consolidation.
--
-- Scope is intentionally exact and idempotent:
-- - Reveille tenant only
-- - the existing TechCon 365 Seattle campaign only
-- - contacts retained from the original prospect migration only
-- - never duplicates an existing membership
--
-- The original membership-specific state (research, scores, ownership, and
-- cadence history) was deleted and cannot be truthfully reconstructed. Restore
-- the surviving people as fresh campaign members while preserving their
-- original contact-created timestamps and distinguishing manual additions.
INSERT INTO prospects (
  campaign_id,
  tenant_domain,
  market_id,
  contact_id,
  source,
  status,
  owner_user_id,
  created_at,
  updated_at
)
SELECT
  campaign.id,
  campaign.tenant_domain,
  campaign.market_id,
  contact.id,
  CASE WHEN contact.source = 'sales_manual' THEN 'manual' ELSE 'import' END,
  'new',
  campaign.created_by,
  contact.created_at,
  now()
FROM outreach_campaigns campaign
JOIN marketing_contacts contact
  ON contact.tenant_domain = campaign.tenant_domain
LEFT JOIN prospects existing
  ON existing.campaign_id = campaign.id
  AND existing.contact_id = contact.id
WHERE campaign.id = '2882e666-269e-44a3-a534-265ea946d063'
  AND campaign.tenant_domain = 'reveillesoftware.com'
  AND campaign.name = 'TechCon 365 Seattle'
  AND campaign.status <> 'deleted'
  AND contact.source_prospect_id IS NOT NULL
  AND existing.id IS NULL
ON CONFLICT (campaign_id, contact_id) DO NOTHING;