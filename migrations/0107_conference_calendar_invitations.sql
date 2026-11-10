CREATE TABLE IF NOT EXISTS conference_calendar_invitations (
  prospect_id varchar PRIMARY KEY,
  tenant_domain text NOT NULL,
  transaction_id uuid NOT NULL UNIQUE,
  state jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
