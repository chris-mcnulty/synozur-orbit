-- Outcome metrics + Orbit Score (Task #101)
CREATE TABLE IF NOT EXISTS analytics_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  market_id varchar REFERENCES markets(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'ga4',
  property_id text,
  property_name text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamp,
  scope text,
  status text NOT NULL DEFAULT 'connected',
  last_error text,
  last_sync_at timestamp,
  connected_by varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_connections_tenant_idx
  ON analytics_connections (tenant_domain, market_id);

CREATE TABLE IF NOT EXISTS analytics_daily (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  market_id varchar REFERENCES markets(id) ON DELETE SET NULL,
  date text NOT NULL,
  source text NOT NULL DEFAULT '(direct)',
  medium text NOT NULL DEFAULT '(none)',
  campaign text,
  sessions integer NOT NULL DEFAULT 0,
  users integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  revenue integer NOT NULL DEFAULT 0,
  orbit_clicks integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_daily_tenant_idx
  ON analytics_daily (tenant_domain, market_id, date);

CREATE TABLE IF NOT EXISTS orbit_scores (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_domain text NOT NULL,
  market_id varchar REFERENCES markets(id) ON DELETE SET NULL,
  week_start text NOT NULL,
  score integer NOT NULL,
  components jsonb NOT NULL,
  business_type text NOT NULL DEFAULT 'b2b',
  sic_code text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_scores_tenant_idx
  ON orbit_scores (tenant_domain, market_id, week_start);

CREATE TABLE IF NOT EXISTS orbit_score_benchmarks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  sic_code text NOT NULL,
  week_start text NOT NULL,
  p50 integer NOT NULL,
  p75 integer NOT NULL,
  sample_size integer NOT NULL,
  component_p50 jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbit_score_benchmarks_idx
  ON orbit_score_benchmarks (sic_code, week_start);
