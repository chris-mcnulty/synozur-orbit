-- HubSpot marketing-email sync — Phase 3 (bidirectional unsubscribe).
-- Per-tenant default HubSpot subscription id that marketing email maps to.
-- Null ⇒ unsubscribe write-back is skipped (local suppression still applies).
ALTER TABLE "hubspot_connections"
  ADD COLUMN IF NOT EXISTS "default_subscription_id" text;
