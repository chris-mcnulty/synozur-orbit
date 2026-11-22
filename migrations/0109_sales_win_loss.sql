CREATE TABLE sales_outcomes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  market_id varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'hubspot')),
  external_id text,
  source_snapshot jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by varchar NOT NULL,
  updated_by varchar NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_outcomes_external_idx ON sales_outcomes(tenant_domain, market_id, external_id);
--> statement-breakpoint
CREATE INDEX sales_outcomes_scope_idx ON sales_outcomes(tenant_domain, market_id);
--> statement-breakpoint
CREATE TABLE sales_outcome_reviews (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  market_id varchar NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_by varchar NOT NULL,
  approved_by varchar,
  approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX sales_outcome_reviews_scope_idx ON sales_outcome_reviews(tenant_domain, market_id, kind);
