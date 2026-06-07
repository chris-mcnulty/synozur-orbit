CREATE TABLE "analytics_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"provider" text DEFAULT 'ga4' NOT NULL,
	"property_id" text,
	"property_name" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp,
	"scope" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp,
	"connected_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"date" text NOT NULL,
	"source" text DEFAULT '(direct)' NOT NULL,
	"medium" text DEFAULT '(none)' NOT NULL,
	"campaign" text,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" integer DEFAULT 0 NOT NULL,
	"orbit_clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"field_path" text,
	"range_start" integer,
	"range_end" integer,
	"selected_text" text,
	"thread_id" varchar NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"tenant_id" varchar,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"payload" jsonb,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_asset_solution_areas" (
	"asset_id" varchar NOT NULL,
	"solution_area_id" varchar NOT NULL,
	CONSTRAINT "brand_asset_solution_areas_asset_id_solution_area_id_pk" PRIMARY KEY("asset_id","solution_area_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_solution_areas" (
	"campaign_id" varchar NOT NULL,
	"solution_area_id" varchar NOT NULL,
	CONSTRAINT "campaign_solution_areas_campaign_id_solution_area_id_pk" PRIMARY KEY("campaign_id","solution_area_id")
);
--> statement-breakpoint
CREATE TABLE "collaboration_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"author_user_id" varchar NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collaboration_threads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"competitor_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"display_title" text NOT NULL,
	"scope_tag" text,
	"object_storage_path" text,
	"spe_file_id" text,
	"spe_container_id" text,
	"byte_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"file_type" text NOT NULL,
	"extracted_text" text,
	"status" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" varchar NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "competitor_engagement_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"competitor_id" varchar NOT NULL,
	"platform" text NOT NULL,
	"followers" integer,
	"posts" integer,
	"reactions" integer,
	"comments" integer,
	"likes" integer,
	"raw" jsonb,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_pricing_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"competitor_id" varchar,
	"company_profile_id" varchar,
	"pricing_url" text NOT NULL,
	"tiers" jsonb NOT NULL,
	"pricing_model" text,
	"currency" text,
	"has_free_tier" boolean,
	"raw_content" text,
	"change_score" integer DEFAULT 0 NOT NULL,
	"change_summary" text,
	"change_analysis" jsonb,
	"crawl_method" text,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conference_backgrounds" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"name" text,
	"file_url" text NOT NULL,
	"file_type" text,
	"file_size" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conference_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" varchar NOT NULL,
	"session_id" varchar,
	"tenant_domain" text NOT NULL,
	"role" text DEFAULT 'session' NOT NULL,
	"source" text DEFAULT 'ai_generated' NOT NULL,
	"name" text,
	"image_prompt" text,
	"template_asset_id" varchar,
	"background_id" varchar,
	"file_url" text,
	"file_type" text,
	"file_size" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conference_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"title" text NOT NULL,
	"speaker" text,
	"speakers" jsonb DEFAULT '[]'::jsonb,
	"session_type" text,
	"track" text,
	"room" text,
	"session_start" timestamp,
	"session_end" timestamp,
	"abstract" text,
	"url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"location" text,
	"website" text,
	"event_hashtag" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"promo_start_date" timestamp,
	"promo_end_date" timestamp,
	"posts_per_day" integer DEFAULT 2 NOT NULL,
	"include_saturday" boolean DEFAULT false NOT NULL,
	"include_sunday" boolean DEFAULT false NOT NULL,
	"anchor_post_count" integer DEFAULT 2 NOT NULL,
	"variants_per_post" integer DEFAULT 3 NOT NULL,
	"thematic_brief" text,
	"discount_statement" text,
	"always_hashtags" jsonb DEFAULT '[]'::jsonb,
	"product_ids" text[],
	"event_logo_file_url" text,
	"event_logo_file_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp,
	"post_generation_job_id" varchar,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_asset_solution_areas" (
	"asset_id" varchar NOT NULL,
	"solution_area_id" varchar NOT NULL,
	CONSTRAINT "content_asset_solution_areas_asset_id_solution_area_id_pk" PRIMARY KEY("asset_id","solution_area_id")
);
--> statement-breakpoint
CREATE TABLE "email_recipient_lists" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"unsubscribe_token" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sg_message_id" text,
	"error_message" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"bounced_at" timestamp,
	"unsubscribed_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_send_recipients_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"generated_email_id" varchar NOT NULL,
	"list_id" varchar,
	"test_recipient" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"unsubscribe_count" integer DEFAULT 0 NOT NULL,
	"spam_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hubspot_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"hubspot_portal_id" text,
	"hubspot_portal_name" text,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"auto_push_enabled" boolean DEFAULT false NOT NULL,
	"default_owner_id" text,
	"connected_by_user_id" varchar,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"last_sync_stats" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hubspot_connections_tenant_domain_unique" UNIQUE("tenant_domain")
);
--> statement-breakpoint
CREATE TABLE "integration_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_webhook_url" text NOT NULL,
	"webhook_host_hint" text,
	"event_categories" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "manual_action_bonuses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"action" text NOT NULL,
	"delta" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp NOT NULL,
	"reason" text,
	"granted_by" varchar,
	"granted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_action_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"user_id" varchar,
	"action" text NOT NULL,
	"cost_tier" text DEFAULT 'medium' NOT NULL,
	"succeeded" boolean,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"user_id" varchar,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" varchar,
	"status" text DEFAULT 'ok' NOT NULL,
	"message" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_link_clicks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"clicked_at" timestamp DEFAULT now() NOT NULL,
	"referrer" text,
	"user_agent" text,
	"ip_hash" text,
	"is_bot" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"campaign_id" varchar,
	"slug" text NOT NULL,
	"destination_url" text NOT NULL,
	"label" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"click_count" integer DEFAULT 0 NOT NULL,
	"last_clicked_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_links_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "marketing_plan_bucket_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" varchar NOT NULL,
	"activity_category" text NOT NULL,
	"bucket_id" text NOT NULL,
	"bucket_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_api_audit" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" varchar,
	"client_id" varchar,
	"user_id" varchar,
	"tenant_domain" text,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"redirect_uri" text NOT NULL,
	"scopes" text[] NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo_url" text,
	"contact_email" text,
	"redirect_uris" text[] NOT NULL,
	"allowed_scopes" text[] NOT NULL,
	"client_secret_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"access_token_id" varchar,
	"client_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"rotated_to_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "orbit_score_benchmarks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sic_code" text NOT NULL,
	"week_start" text NOT NULL,
	"p50" integer NOT NULL,
	"p75" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"component_p50" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orbit_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"week_start" text NOT NULL,
	"score" integer NOT NULL,
	"components" jsonb NOT NULL,
	"business_type" text DEFAULT 'b2b' NOT NULL,
	"sic_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" varchar NOT NULL,
	"subscription_id" text NOT NULL,
	"resource" text NOT NULL,
	"client_state" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_renewed_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_task_sync_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" varchar NOT NULL,
	"task_id" varchar,
	"planner_task_id" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"direction" text NOT NULL,
	"fields" jsonb,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "product_feedback" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'internal' NOT NULL,
	"submitter_user_id" varchar,
	"submitter_email" text,
	"submitter_name" text,
	"submitter_ip" text,
	"promoted_feature_id" varchar,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"embedding" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_feedback_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"voter_user_id" varchar,
	"voter_email" text,
	"voter_ip" text,
	"voter_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"tenant_domain" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_tenant_domain_scope_key_pk" PRIMARY KEY("tenant_domain","scope","key")
);
--> statement-breakpoint
CREATE TABLE "relationship_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"company_profile_id" varchar,
	"competitor_id" varchar,
	"target_company_profile_id" varchar,
	"target_name" text NOT NULL,
	"target_url" text,
	"name" text NOT NULL,
	"content" text,
	"saved_prompts" jsonb,
	"status" text DEFAULT 'not_generated' NOT NULL,
	"last_generated_at" timestamp,
	"generated_from_data_as_of" timestamp,
	"generated_by" varchar,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"keyword_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar,
	"entity_name" text NOT NULL,
	"entity_domain" text,
	"rank" integer,
	"estimated_traffic" integer DEFAULT 0 NOT NULL,
	"share_of_voice" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_account_voice_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"person" text DEFAULT 'first' NOT NULL,
	"author_perspective" text DEFAULT 'individual' NOT NULL,
	"tone_attributes" jsonb,
	"style_guidance" text,
	"forbidden_phrases" text[],
	"preferred_phrases" text[],
	"emoji_policy" text DEFAULT 'sparing' NOT NULL,
	"hashtag_policy" text DEFAULT 'standard' NOT NULL,
	"max_length" integer,
	"sample_snippets" jsonb DEFAULT '[]'::jsonb,
	"default_persona_id" varchar,
	"default_framework_refs" jsonb DEFAULT '[]'::jsonb,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "social_account_voice_profiles_social_account_id_unique" UNIQUE("social_account_id")
);
--> statement-breakpoint
CREATE TABLE "social_publish_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" varchar NOT NULL,
	"social_account_id" varchar,
	"tenant_domain" text NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"published_url" text,
	"error_code" text,
	"error_message" text,
	"response_payload" jsonb,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"attempted_by" varchar
);
--> statement-breakpoint
CREATE TABLE "solution_areas" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"parent_id" varchar,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"reply_id" varchar,
	"uploaded_by" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"object_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_platform_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"platform" text NOT NULL,
	"encrypted_client_id" text NOT NULL,
	"encrypted_client_secret" text,
	"notes" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_keywords" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"keyword" text NOT NULL,
	"country" text DEFAULT 'us' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_posts" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "sentiment_score" real;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "tone_label" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "tone_note" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "analyzed_at" timestamp;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "analyzer_version" text;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "asset_type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "logo_variant" text;--> statement-breakpoint
ALTER TABLE "campaign_social_accounts" ADD COLUMN "auto_publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "thematic_brief" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "thematic_url" text;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "pricing_page_url" text;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD COLUMN "last_pricing_check" timestamp;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "pricing_page_url" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "last_pricing_check" timestamp;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "hubspot_company_id" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "hubspot_lifecycle_stage" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "hubspot_open_deal_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "hubspot_open_deal_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "hubspot_last_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "asset_type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_recommendations" ADD COLUMN "assigned_to_user_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "source_asset_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "conference_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "conference_session_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "conference_image_id" varchar;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "post_role" text;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "publish_error" text;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "publish_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "publish_next_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "voice_profile_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD COLUMN "rewrite_lineage" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "grounding_documents" ADD COLUMN "product_id" varchar;--> statement-breakpoint
ALTER TABLE "intelligence_briefings" ADD COLUMN "hubspot_pushed_at" timestamp;--> statement-breakpoint
ALTER TABLE "intelligence_briefings" ADD COLUMN "hubspot_push_result" jsonb;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_group_id" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_group_name" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_plan_id" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_plan_name" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_bucket_id" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_bucket_name" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_connected_by" varchar;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_sync_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_last_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "planner_last_sync_error" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "vega_last_push_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "vega_last_push_status" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "vega_last_push_error" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "vega_last_push_bundle_id" text;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "vega_last_pushed_by" varchar;--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD COLUMN "planner_etag" text;--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD COLUMN "planner_last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sic_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "public_feedback_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "public_feedback_token" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "feedback_email_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD COLUMN "from_feedback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "encrypted_access_token" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "encrypted_refresh_token" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "token_scope" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "author_mode" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "author_urn" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "available_authors" jsonb;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "connected_by" varchar;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "last_publish_error" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "neutral_color" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "allowed_auth_providers" text[] DEFAULT ARRAY['entra','google','password']::text[];--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "seo_refresh_interval_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "seat_count" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "payment_grace_until" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_managed_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vega_launchpad_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vega_launchpad_api_key" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vega_launchpad_workspace_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vega_launchpad_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "public_rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mention_email_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "assignment_email_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "graph_access_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "graph_refresh_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "graph_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "graph_scopes" text;--> statement-breakpoint
ALTER TABLE "analytics_connections" ADD CONSTRAINT "analytics_connections_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_connections" ADD CONSTRAINT "analytics_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_thread_id_collaboration_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."collaboration_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_solution_areas" ADD CONSTRAINT "brand_asset_solution_areas_asset_id_brand_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."brand_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_solution_areas" ADD CONSTRAINT "brand_asset_solution_areas_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_solution_areas" ADD CONSTRAINT "campaign_solution_areas_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_solution_areas" ADD CONSTRAINT "campaign_solution_areas_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_comments" ADD CONSTRAINT "collaboration_comments_thread_id_collaboration_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."collaboration_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_comments" ADD CONSTRAINT "collaboration_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_threads" ADD CONSTRAINT "collaboration_threads_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_threads" ADD CONSTRAINT "collaboration_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_documents" ADD CONSTRAINT "competitor_documents_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_documents" ADD CONSTRAINT "competitor_documents_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_documents" ADD CONSTRAINT "competitor_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_engagement_snapshots" ADD CONSTRAINT "competitor_engagement_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_engagement_snapshots" ADD CONSTRAINT "competitor_engagement_snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_pricing_snapshots" ADD CONSTRAINT "competitor_pricing_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_pricing_snapshots" ADD CONSTRAINT "competitor_pricing_snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_pricing_snapshots" ADD CONSTRAINT "competitor_pricing_snapshots_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_backgrounds" ADD CONSTRAINT "conference_backgrounds_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_session_id_conference_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conference_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_template_asset_id_brand_assets_id_fk" FOREIGN KEY ("template_asset_id") REFERENCES "public"."brand_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_background_id_conference_backgrounds_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."conference_backgrounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_images" ADD CONSTRAINT "conference_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_sessions" ADD CONSTRAINT "conference_sessions_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferences" ADD CONSTRAINT "conferences_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferences" ADD CONSTRAINT "conferences_post_generation_job_id_scheduled_job_runs_id_fk" FOREIGN KEY ("post_generation_job_id") REFERENCES "public"."scheduled_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferences" ADD CONSTRAINT "conferences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_solution_areas" ADD CONSTRAINT "content_asset_solution_areas_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_solution_areas" ADD CONSTRAINT "content_asset_solution_areas_solution_area_id_solution_areas_id_fk" FOREIGN KEY ("solution_area_id") REFERENCES "public"."solution_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_lists" ADD CONSTRAINT "email_recipient_lists_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_lists" ADD CONSTRAINT "email_recipient_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_list_id_email_recipient_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."email_recipient_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_recipients" ADD CONSTRAINT "email_send_recipients_send_id_email_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."email_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_generated_email_id_generated_emails_id_fk" FOREIGN KEY ("generated_email_id") REFERENCES "public"."generated_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_list_id_email_recipient_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."email_recipient_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hubspot_connections" ADD CONSTRAINT "hubspot_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_audit_log" ADD CONSTRAINT "marketing_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_link_clicks" ADD CONSTRAINT "marketing_link_clicks_link_id_marketing_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."marketing_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_links" ADD CONSTRAINT "marketing_links_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_links" ADD CONSTRAINT "marketing_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_links" ADD CONSTRAINT "marketing_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_plan_bucket_mappings" ADD CONSTRAINT "marketing_plan_bucket_mappings_plan_id_marketing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."marketing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_scores" ADD CONSTRAINT "orbit_scores_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_subscriptions" ADD CONSTRAINT "planner_subscriptions_plan_id_marketing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."marketing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_task_sync_log" ADD CONSTRAINT "planner_task_sync_log_plan_id_marketing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."marketing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_task_sync_log" ADD CONSTRAINT "planner_task_sync_log_task_id_marketing_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."marketing_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_submitter_user_id_users_id_fk" FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_promoted_feature_id_product_features_id_fk" FOREIGN KEY ("promoted_feature_id") REFERENCES "public"."product_features"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback_votes" ADD CONSTRAINT "product_feedback_votes_feedback_id_product_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."product_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback_votes" ADD CONSTRAINT "product_feedback_votes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback_votes" ADD CONSTRAINT "product_feedback_votes_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_reports" ADD CONSTRAINT "relationship_reports_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_reports" ADD CONSTRAINT "relationship_reports_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_reports" ADD CONSTRAINT "relationship_reports_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_reports" ADD CONSTRAINT "relationship_reports_target_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("target_company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_reports" ADD CONSTRAINT "relationship_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_reports" ADD CONSTRAINT "relationship_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_metrics" ADD CONSTRAINT "seo_metrics_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_metrics" ADD CONSTRAINT "seo_metrics_keyword_id_tracked_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."tracked_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account_voice_profiles" ADD CONSTRAINT "social_account_voice_profiles_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account_voice_profiles" ADD CONSTRAINT "social_account_voice_profiles_default_persona_id_personas_id_fk" FOREIGN KEY ("default_persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account_voice_profiles" ADD CONSTRAINT "social_account_voice_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_attempts" ADD CONSTRAINT "social_publish_attempts_post_id_generated_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."generated_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_attempts" ADD CONSTRAINT "social_publish_attempts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_attempts" ADD CONSTRAINT "social_publish_attempts_attempted_by_users_id_fk" FOREIGN KEY ("attempted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_areas" ADD CONSTRAINT "solution_areas_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_areas" ADD CONSTRAINT "solution_areas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_reply_id_support_ticket_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."support_ticket_replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_platform_credentials" ADD CONSTRAINT "tenant_platform_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_target_idx" ON "annotations" USING btree ("tenant_domain","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "collab_comments_thread_idx" ON "collaboration_comments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "collab_comments_tenant_idx" ON "collaboration_comments" USING btree ("tenant_domain","created_at");--> statement-breakpoint
CREATE INDEX "collab_threads_target_idx" ON "collaboration_threads" USING btree ("tenant_domain","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "competitor_documents_tenant_competitor_status_idx" ON "competitor_documents" USING btree ("tenant_domain","competitor_id","status");--> statement-breakpoint
CREATE INDEX "competitor_documents_competitor_idx" ON "competitor_documents" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "competitor_engagement_snapshots_competitor_platform_idx" ON "competitor_engagement_snapshots" USING btree ("competitor_id","platform","captured_at");--> statement-breakpoint
CREATE INDEX "competitor_engagement_snapshots_tenant_captured_idx" ON "competitor_engagement_snapshots" USING btree ("tenant_domain","captured_at");--> statement-breakpoint
CREATE INDEX "competitor_pricing_snapshots_competitor_captured_idx" ON "competitor_pricing_snapshots" USING btree ("competitor_id","captured_at");--> statement-breakpoint
CREATE INDEX "competitor_pricing_snapshots_tenant_captured_idx" ON "competitor_pricing_snapshots" USING btree ("tenant_domain","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conference_images_session_unique" ON "conference_images" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "email_recipients_list_email_uniq" ON "email_recipients" USING btree ("list_id","email");--> statement-breakpoint
CREATE INDEX "email_send_recipients_send_email_idx" ON "email_send_recipients" USING btree ("send_id","email");--> statement-breakpoint
CREATE INDEX "email_suppressions_tenant_email_uniq" ON "email_suppressions" USING btree ("tenant_domain","email");--> statement-breakpoint
CREATE INDEX "manual_action_bonuses_tenant_action_period_idx" ON "manual_action_bonuses" USING btree ("tenant_domain","action","period_start");--> statement-breakpoint
CREATE INDEX "manual_action_usage_tenant_action_idx" ON "manual_action_usage" USING btree ("tenant_domain","action","occurred_at");--> statement-breakpoint
CREATE INDEX "marketing_audit_log_tenant_created_idx" ON "marketing_audit_log" USING btree ("tenant_domain","created_at");--> statement-breakpoint
CREATE INDEX "oauth_api_audit_tenant_idx" ON "oauth_api_audit" USING btree ("tenant_domain","created_at");--> statement-breakpoint
CREATE INDEX "oauth_api_audit_client_idx" ON "oauth_api_audit" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "relationship_reports_tenant_market_idx" ON "relationship_reports" USING btree ("tenant_domain","market_id");--> statement-breakpoint
CREATE INDEX "relationship_reports_competitor_idx" ON "relationship_reports" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "relationship_reports_target_profile_idx" ON "relationship_reports" USING btree ("target_company_profile_id");--> statement-breakpoint
CREATE INDEX "seo_metrics_tenant_market_idx" ON "seo_metrics" USING btree ("tenant_domain","market_id","captured_at");--> statement-breakpoint
CREATE INDEX "seo_metrics_keyword_idx" ON "seo_metrics" USING btree ("keyword_id","captured_at");--> statement-breakpoint
CREATE INDEX "seo_metrics_entity_idx" ON "seo_metrics" USING btree ("entity_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "solution_areas_tenant_market_slug_idx" ON "solution_areas" USING btree ("tenant_domain","market_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_platform_credentials_tenant_platform_idx" ON "tenant_platform_credentials" USING btree ("tenant_domain","platform");--> statement-breakpoint
CREATE INDEX "tracked_keywords_tenant_market_idx" ON "tracked_keywords" USING btree ("tenant_domain","market_id");--> statement-breakpoint
ALTER TABLE "feature_recommendations" ADD CONSTRAINT "feature_recommendations_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_source_asset_id_content_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_conference_session_id_conference_sessions_id_fk" FOREIGN KEY ("conference_session_id") REFERENCES "public"."conference_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_conference_image_id_conference_images_id_fk" FOREIGN KEY ("conference_image_id") REFERENCES "public"."conference_images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_documents" ADD CONSTRAINT "grounding_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_planner_connected_by_users_id_fk" FOREIGN KEY ("planner_connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_vega_last_pushed_by_users_id_fk" FOREIGN KEY ("vega_last_pushed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_competitor_analyzed_idx" ON "activity" USING btree ("competitor_id","analyzed_at");--> statement-breakpoint
CREATE INDEX "activity_competitor_created_idx" ON "activity" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_rec_assigned_to_idx" ON "feature_recommendations" USING btree ("assigned_to_user_id");--> statement-breakpoint
ALTER TABLE "competitor_positions" ADD CONSTRAINT "competitor_positions_entity_xor" CHECK (("competitor_positions"."competitor_id" IS NOT NULL AND "competitor_positions"."company_profile_id" IS NULL) OR ("competitor_positions"."competitor_id" IS NULL AND "competitor_positions"."company_profile_id" IS NOT NULL));