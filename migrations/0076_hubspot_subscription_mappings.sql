-- HubSpot per-category subscription mappings (Task #467)
--
-- Maps each Orbit email subscription type name to a HubSpot
-- communication-preference subscription type ID so consent checks and
-- unsubscribe/resubscribe pushes can use the category-appropriate subscription
-- rather than the single global defaultSubscriptionId on hubspot_connections.
--
-- emailCategory = the name value from email_subscription_types (free text,
-- e.g. "Newsletter"). Unique per (tenant_domain, email_category) so each
-- Orbit category maps to exactly one HubSpot subscription at a time.

CREATE TABLE IF NOT EXISTS hubspot_subscription_mappings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  email_category text NOT NULL,
  hubspot_subscription_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hubspot_subscription_mappings_tenant_category_uniq
  ON hubspot_subscription_mappings(tenant_domain, email_category);
