-- Email subscription types — tenant-defined categories for granular opt-in/out.
-- Each send can be tagged with one or more types; contacts opt out per type.
-- is_transactional means the type is exempt from suppression (e.g. receipts).

CREATE TABLE IF NOT EXISTS email_subscription_types (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  name text NOT NULL,
  description text,
  is_transactional boolean NOT NULL DEFAULT false,
  hubspot_type_id text,
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_subscription_types_tenant_name_uniq
  ON email_subscription_types(tenant_domain, name);

-- Per-contact subscription preferences (opt-out-only model).
-- A contact NOT listed here is considered opted in.
-- opted_out_at IS NULL means explicitly opted back in after a prior opt-out.
CREATE TABLE IF NOT EXISTS email_subscription_preferences (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  email text NOT NULL,
  subscription_type_id varchar NOT NULL REFERENCES email_subscription_types(id) ON DELETE CASCADE,
  opted_out_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_sub_prefs_tenant_email_type_uniq
  ON email_subscription_preferences(tenant_domain, email, subscription_type_id);

-- Tag each send with zero or more subscription type ids for enforcement.
ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS subscription_type_ids text[] NOT NULL DEFAULT '{}';

-- Migrate existing global unsubscribes into per-type preferences.
-- Creates a "Marketing Email" seed type per tenant that has suppressions.
DO $$
DECLARE
  t text;
  type_id varchar;
  sup RECORD;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_domain
    FROM email_suppressions
    WHERE reason = 'unsubscribe'
  LOOP
    INSERT INTO email_subscription_types
      (tenant_domain, name, description, is_transactional)
    VALUES
      (t, 'Marketing Email', 'General marketing and promotional emails', false)
    ON CONFLICT DO NOTHING;

    SELECT id INTO type_id
    FROM email_subscription_types
    WHERE tenant_domain = t AND name = 'Marketing Email'
    LIMIT 1;

    FOR sup IN
      SELECT DISTINCT email
      FROM email_suppressions
      WHERE tenant_domain = t AND reason = 'unsubscribe'
    LOOP
      INSERT INTO email_subscription_preferences
        (tenant_domain, email, subscription_type_id, opted_out_at)
      VALUES
        (t, sup.email, type_id, now())
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
