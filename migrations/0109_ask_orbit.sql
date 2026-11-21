CREATE TABLE ask_orbit_conversations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX ask_orbit_conversations_scope ON ask_orbit_conversations(tenant_id, market_id, owner_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE ask_orbit_turns (
  id varchar PRIMARY KEY,
  conversation_id varchar NOT NULL REFERENCES ask_orbit_conversations(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed','cancelled')),
  answer jsonb,
  error text,
  provider_started boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX ask_orbit_turns_conversation ON ask_orbit_turns(conversation_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX ask_orbit_one_processing ON ask_orbit_turns(conversation_id) WHERE status = 'processing';
--> statement-breakpoint
CREATE TABLE ask_orbit_monthly_usage (
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (tenant_id, month)
);
