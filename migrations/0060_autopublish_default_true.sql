-- autoPublish was incorrectly defaulting to false when social accounts were
-- linked to campaigns, silently blocking the publish worker from ever firing
-- those posts. Flip all existing links to true so overdue posts can be picked
-- up on the next worker tick. Going forward, the server INSERT also defaults
-- to true, so new links are correct without needing this patch.
UPDATE campaign_social_accounts SET auto_publish = true WHERE auto_publish = false;
