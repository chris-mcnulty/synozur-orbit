-- Tenant-scope index sweep: all pgTable definitions that filter by
-- tenant_domain / tenant_id but had no covering index.
--
-- Pattern from 0083_homepage_speed_indexes.sql: hand-written SQL because
-- db:generate is broken (snapshot collision). Indexes are IF NOT EXISTS so
-- re-running is safe. Columns chosen to match the WHERE clauses actually
-- used in server/storage.ts hot paths.

-- ─── Intelligence / Research ──────────────────────────────────────────────

-- consultant_access: tenant + status lookup for access checks
CREATE INDEX IF NOT EXISTS "consultant_access_tenant_status_idx"
    ON "consultant_access" ("tenant_id", "status");

-- client_projects: getProjectsByTenant → WHERE tenant_domain = ?  [+ optional market_id]
CREATE INDEX IF NOT EXISTS "client_projects_tenant_market_idx"
    ON "client_projects" ("tenant_domain", "market_id");

-- products: getProductsByTenant → WHERE tenant_domain = ? AND market_id = ?
CREATE INDEX IF NOT EXISTS "products_tenant_market_idx"
    ON "products" ("tenant_domain", "market_id");

-- product_features: fetched under a product by tenant
CREATE INDEX IF NOT EXISTS "product_features_tenant_product_idx"
    ON "product_features" ("tenant_domain", "product_id");

-- roadmap_items: fetched under a product by tenant
CREATE INDEX IF NOT EXISTS "roadmap_items_tenant_product_idx"
    ON "roadmap_items" ("tenant_domain", "product_id");

-- product_feedback: list + status filter
CREATE INDEX IF NOT EXISTS "product_feedback_tenant_product_status_idx"
    ON "product_feedback" ("tenant_domain", "product_id", "status");

-- product_feedback_votes: dedup check by feedback + tenant
CREATE INDEX IF NOT EXISTS "product_feedback_votes_tenant_feedback_idx"
    ON "product_feedback_votes" ("tenant_domain", "feedback_id");

-- feature_recommendations: pending/accepted list per product
CREATE INDEX IF NOT EXISTS "feature_recommendations_tenant_product_status_idx"
    ON "feature_recommendations" ("tenant_domain", "product_id", "status");

-- recommendations: pending list by tenant + market + status
CREATE INDEX IF NOT EXISTS "recommendations_tenant_market_status_idx"
    ON "recommendations" ("tenant_domain", "market_id", "status");

-- reports: list by tenant + market
CREATE INDEX IF NOT EXISTS "reports_tenant_market_idx"
    ON "reports" ("tenant_domain", "market_id");

-- analysis: latest by tenant + market
CREATE INDEX IF NOT EXISTS "analysis_tenant_market_created_idx"
    ON "analysis" ("tenant_domain", "market_id", "created_at" DESC);

-- battlecards: per-tenant + market + competitor
CREATE INDEX IF NOT EXISTS "battlecards_tenant_market_competitor_idx"
    ON "battlecards" ("tenant_domain", "market_id", "competitor_id");

-- product_battlecards: per-tenant + market
CREATE INDEX IF NOT EXISTS "product_battlecards_tenant_market_idx"
    ON "product_battlecards" ("tenant_domain", "market_id");

-- long_form_recommendations: by tenant + market + type
CREATE INDEX IF NOT EXISTS "long_form_recommendations_tenant_market_type_idx"
    ON "long_form_recommendations" ("tenant_domain", "market_id", "type");

-- gap_dismissals: by tenant + market
CREATE INDEX IF NOT EXISTS "gap_dismissals_tenant_market_idx"
    ON "gap_dismissals" ("tenant_domain", "market_id");

-- grounding_documents: by tenant + market + scope + use_case
CREATE INDEX IF NOT EXISTS "grounding_documents_tenant_market_scope_usecase_idx"
    ON "grounding_documents" ("tenant_domain", "market_id", "scope", "use_case");

-- assessments: list + recency by tenant + market
CREATE INDEX IF NOT EXISTS "assessments_tenant_market_created_idx"
    ON "assessments" ("tenant_domain", "market_id", "created_at" DESC);

-- competitor_scores: ranking list by tenant + market
CREATE INDEX IF NOT EXISTS "competitor_scores_tenant_market_idx"
    ON "competitor_scores" ("tenant_domain", "market_id");

-- social_metrics: time-series by tenant + market + competitor
CREATE INDEX IF NOT EXISTS "social_metrics_tenant_market_competitor_captured_idx"
    ON "social_metrics" ("tenant_domain", "market_id", "competitor_id", "captured_at" DESC);

-- score_history: per-entity timeline by tenant + market
CREATE INDEX IF NOT EXISTS "score_history_tenant_market_entity_idx"
    ON "score_history" ("tenant_domain", "market_id", "entity_type", "entity_id");

-- executive_summaries: lookup by tenant + market + scope
CREATE INDEX IF NOT EXISTS "executive_summaries_tenant_market_scope_idx"
    ON "executive_summaries" ("tenant_domain", "market_id", "scope");

-- competitor_positions: quadrant lookup by tenant + market
CREATE INDEX IF NOT EXISTS "competitor_positions_tenant_market_idx"
    ON "competitor_positions" ("tenant_domain", "market_id");

-- ─── AI Usage ─────────────────────────────────────────────────────────────

-- ai_usage: cost/usage reporting by tenant + recency
CREATE INDEX IF NOT EXISTS "ai_usage_tenant_created_idx"
    ON "ai_usage" ("tenant_domain", "created_at" DESC);

-- ─── Intelligence Briefings ───────────────────────────────────────────────

-- intelligence_briefings: list by tenant + market + recency
CREATE INDEX IF NOT EXISTS "intelligence_briefings_tenant_market_created_idx"
    ON "intelligence_briefings" ("tenant_domain", "market_id", "created_at" DESC);

-- briefing_subscriptions: per-user lookup by tenant
CREATE INDEX IF NOT EXISTS "briefing_subscriptions_tenant_user_idx"
    ON "briefing_subscriptions" ("tenant_domain", "user_id");

-- scheduled_briefing_configs: lookup by tenant + market
CREATE INDEX IF NOT EXISTS "scheduled_briefing_configs_tenant_market_idx"
    ON "scheduled_briefing_configs" ("tenant_domain", "market_id");

-- scheduled_job_runs: log query by tenant + type + recency
CREATE INDEX IF NOT EXISTS "scheduled_job_runs_tenant_type_created_idx"
    ON "scheduled_job_runs" ("tenant_domain", "job_type", "created_at" DESC);

-- ─── Marketing Plans ──────────────────────────────────────────────────────

-- marketing_plans: list by tenant + market + status
CREATE INDEX IF NOT EXISTS "marketing_plans_tenant_market_status_idx"
    ON "marketing_plans" ("tenant_domain", "market_id", "status");

-- ─── Content / Editorial ──────────────────────────────────────────────────

-- editorial_calendars: list by tenant + market + status
CREATE INDEX IF NOT EXISTS "editorial_calendars_tenant_market_status_idx"
    ON "editorial_calendars" ("tenant_domain", "market_id", "status");

-- content_briefs: primary lookup by calendar (most queries) + status filter
CREATE INDEX IF NOT EXISTS "content_briefs_tenant_calendar_status_idx"
    ON "content_briefs" ("tenant_domain", "calendar_id", "status");

-- content_briefs: secondary cross-calendar scan by tenant + market + status
CREATE INDEX IF NOT EXISTS "content_briefs_tenant_market_status_idx"
    ON "content_briefs" ("tenant_domain", "market_id", "status");

-- content_optimizations: lookup by tenant + market
CREATE INDEX IF NOT EXISTS "content_optimizations_tenant_market_idx"
    ON "content_optimizations" ("tenant_domain", "market_id");

-- marketing_performance_reports: list by tenant + market
CREATE INDEX IF NOT EXISTS "marketing_performance_reports_tenant_market_idx"
    ON "marketing_performance_reports" ("tenant_domain", "market_id");

-- content_asset_categories: list by tenant + market
CREATE INDEX IF NOT EXISTS "content_asset_categories_tenant_market_idx"
    ON "content_asset_categories" ("tenant_domain", "market_id");

-- marketing_product_tags: list by tenant + market
CREATE INDEX IF NOT EXISTS "marketing_product_tags_tenant_market_idx"
    ON "marketing_product_tags" ("tenant_domain", "market_id");

-- content_assets: library list — the most frequently scanned tenant table
CREATE INDEX IF NOT EXISTS "content_assets_tenant_market_status_idx"
    ON "content_assets" ("tenant_domain", "market_id", "status");

-- suggested_content_assets: import suggestions by tenant + market
CREATE INDEX IF NOT EXISTS "suggested_content_assets_tenant_market_idx"
    ON "suggested_content_assets" ("tenant_domain", "market_id");

-- ─── Brand Assets ─────────────────────────────────────────────────────────

-- brand_asset_categories: list by tenant + market
CREATE INDEX IF NOT EXISTS "brand_asset_categories_tenant_market_idx"
    ON "brand_asset_categories" ("tenant_domain", "market_id");

-- brand_assets: library list by tenant + market + status
CREATE INDEX IF NOT EXISTS "brand_assets_tenant_market_status_idx"
    ON "brand_assets" ("tenant_domain", "market_id", "status");

-- tenant_fonts: fetched entirely by tenant (no market scoping)
CREATE INDEX IF NOT EXISTS "tenant_fonts_tenant_domain_idx"
    ON "tenant_fonts" ("tenant_domain");

-- ─── Campaigns & Social ───────────────────────────────────────────────────

-- campaigns: list by tenant + market + status
CREATE INDEX IF NOT EXISTS "campaigns_tenant_market_status_idx"
    ON "campaigns" ("tenant_domain", "market_id", "status");

-- generated_posts: calendar & pipeline views (scoped to campaign + status)
CREATE INDEX IF NOT EXISTS "generated_posts_tenant_campaign_status_idx"
    ON "generated_posts" ("tenant_domain", "campaign_id", "status");

-- generated_posts: calendar grid (scoped to scheduled_date window + status)
CREATE INDEX IF NOT EXISTS "generated_posts_tenant_scheduled_status_idx"
    ON "generated_posts" ("tenant_domain", "scheduled_date", "status");

-- generated_emails: list by tenant + campaign
CREATE INDEX IF NOT EXISTS "generated_emails_tenant_campaign_idx"
    ON "generated_emails" ("tenant_domain", "campaign_id", "market_id");

-- ─── UX / Notifications ───────────────────────────────────────────────────

-- notifications: bell-icon query by user within tenant
CREATE INDEX IF NOT EXISTS "notifications_tenant_user_created_idx"
    ON "notifications" ("tenant_domain", "user_id", "created_at" DESC);

-- personas: ICP list by tenant + market
CREATE INDEX IF NOT EXISTS "personas_tenant_market_idx"
    ON "personas" ("tenant_domain", "market_id");

-- integration_configs: webhook dispatch by tenant
CREATE INDEX IF NOT EXISTS "integration_configs_tenant_idx"
    ON "integration_configs" ("tenant_domain");

-- ─── Round 2: tables missed in initial audit ──────────────────────────────

-- tenant_invites: pending invite list by tenant + status
CREATE INDEX IF NOT EXISTS "tenant_invites_tenant_status_idx"
    ON "tenant_invites" ("tenant_domain", "status", "expires_at");

-- billing_events: Stripe event lookup by tenant (nullable)
CREATE INDEX IF NOT EXISTS "billing_events_tenant_id_idx"
    ON "billing_events" ("tenant_id", "processed_at");

-- social_accounts: account picker by tenant + platform + status
CREATE INDEX IF NOT EXISTS "social_accounts_tenant_market_platform_status_idx"
    ON "social_accounts" ("tenant_domain", "market_id", "platform", "status");

-- email_campaign_variants: B-variant lookup by parent email
CREATE INDEX IF NOT EXISTS "email_campaign_variants_tenant_email_idx"
    ON "email_campaign_variants" ("tenant_domain", "generated_email_id");

-- conferences: event list by tenant + market + status
CREATE INDEX IF NOT EXISTS "conferences_tenant_market_status_idx"
    ON "conferences" ("tenant_domain", "market_id", "status", "start_date");

-- conference_sessions: session list by tenant + conference
CREATE INDEX IF NOT EXISTS "conference_sessions_tenant_conference_idx"
    ON "conference_sessions" ("tenant_domain", "conference_id", "session_start");

-- conference_backgrounds: background list by tenant + conference
CREATE INDEX IF NOT EXISTS "conference_backgrounds_tenant_conference_idx"
    ON "conference_backgrounds" ("tenant_domain", "conference_id");

-- conference_images: image list by tenant + conference + role
CREATE INDEX IF NOT EXISTS "conference_images_tenant_conference_role_idx"
    ON "conference_images" ("tenant_domain", "conference_id", "role");

-- marketing_links: link list by tenant + campaign + status
CREATE INDEX IF NOT EXISTS "marketing_links_tenant_campaign_status_idx"
    ON "marketing_links" ("tenant_domain", "campaign_id", "status");

-- marketing_link_clicks: click log by tenant + link + time
CREATE INDEX IF NOT EXISTS "marketing_link_clicks_tenant_link_clicked_idx"
    ON "marketing_link_clicks" ("tenant_domain", "link_id", "clicked_at" DESC);

-- support_tickets: ticket list by tenant + status + recency
CREATE INDEX IF NOT EXISTS "support_tickets_tenant_status_created_idx"
    ON "support_tickets" ("tenant_domain", "status", "created_at" DESC);

-- social_publish_attempts: audit log by tenant + post + status
CREATE INDEX IF NOT EXISTS "social_publish_attempts_tenant_post_status_idx"
    ON "social_publish_attempts" ("tenant_domain", "post_id", "status", "attempted_at" DESC);

-- email_recipient_lists: list picker by tenant + market
CREATE INDEX IF NOT EXISTS "email_recipient_lists_tenant_market_idx"
    ON "email_recipient_lists" ("tenant_domain", "market_id");

-- email_recipients: recipient lookup by tenant + list + status
CREATE INDEX IF NOT EXISTS "email_recipients_tenant_list_status_idx"
    ON "email_recipients" ("tenant_domain", "list_id", "status");

-- email_sender_identities: sender picker (default-first) by tenant
CREATE INDEX IF NOT EXISTS "email_sender_identities_tenant_default_idx"
    ON "email_sender_identities" ("tenant_domain", "is_default");

-- email_sends: Sends tab list by tenant + email + status + recency
CREATE INDEX IF NOT EXISTS "email_sends_tenant_email_status_created_idx"
    ON "email_sends" ("tenant_domain", "generated_email_id", "status", "created_at" DESC);

-- email_send_recipients: delivery status lookup by tenant + send + status
CREATE INDEX IF NOT EXISTS "email_send_recipients_tenant_send_status_idx"
    ON "email_send_recipients" ("tenant_domain", "send_id", "status");

-- oauth_authorization_codes: grant lookup by tenant + user + expiry
CREATE INDEX IF NOT EXISTS "oauth_authorization_codes_tenant_user_expires_idx"
    ON "oauth_authorization_codes" ("tenant_domain", "user_id", "expires_at");

-- oauth_access_tokens: token list by tenant + user + expiry
CREATE INDEX IF NOT EXISTS "oauth_access_tokens_tenant_user_expires_idx"
    ON "oauth_access_tokens" ("tenant_domain", "user_id", "expires_at");

-- oauth_refresh_tokens: refresh list by tenant + user + expiry
CREATE INDEX IF NOT EXISTS "oauth_refresh_tokens_tenant_user_expires_idx"
    ON "oauth_refresh_tokens" ("tenant_domain", "user_id", "expires_at");

-- analytics_connections: connection list by tenant + market + provider
CREATE INDEX IF NOT EXISTS "analytics_connections_tenant_market_provider_idx"
    ON "analytics_connections" ("tenant_domain", "market_id", "provider", "status");

-- analytics_daily: time-series query by tenant + market + date
CREATE INDEX IF NOT EXISTS "analytics_daily_tenant_market_date_idx"
    ON "analytics_daily" ("tenant_domain", "market_id", "date");

-- orbit_scores: score history by tenant + market + week
CREATE INDEX IF NOT EXISTS "orbit_scores_tenant_market_week_idx"
    ON "orbit_scores" ("tenant_domain", "market_id", "week_start");

-- outreach_touches: touch log by tenant + campaign + status
CREATE INDEX IF NOT EXISTS "outreach_touches_tenant_campaign_status_idx"
    ON "outreach_touches" ("tenant_domain", "campaign_id", "status");

-- outreach_campaign_resources: resource list by tenant + campaign
CREATE INDEX IF NOT EXISTS "outreach_campaign_resources_tenant_campaign_idx"
    ON "outreach_campaign_resources" ("tenant_domain", "campaign_id");
