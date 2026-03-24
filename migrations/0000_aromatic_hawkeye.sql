CREATE TABLE "activity" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"source_type" text DEFAULT 'competitor' NOT NULL,
	"competitor_id" varchar,
	"company_profile_id" varchar,
	"competitor_name" text NOT NULL,
	"description" text NOT NULL,
	"summary" text,
	"details" jsonb,
	"date" text NOT NULL,
	"impact" text NOT NULL,
	"user_id" varchar,
	"tenant_domain" text,
	"market_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_configuration" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"default_provider" text DEFAULT 'replit_anthropic' NOT NULL,
	"default_model" text DEFAULT 'claude-sonnet-4-5' NOT NULL,
	"max_tokens_per_request" integer DEFAULT 8192,
	"monthly_token_budget" integer,
	"alert_thresholds" jsonb DEFAULT '[75,90,100]'::jsonb,
	"alert_enabled" boolean DEFAULT true,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_feature_model_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"max_tokens" integer,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_feature_model_assignments_feature_unique" UNIQUE("feature")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text,
	"market_id" varchar,
	"user_id" varchar,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"operation" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" text,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" varchar(7) NOT NULL,
	"threshold_percent" integer NOT NULL,
	"token_usage_at_alert" integer NOT NULL,
	"monthly_budget" integer NOT NULL,
	"alerted_at" timestamp DEFAULT now() NOT NULL,
	"notified_emails" jsonb
);
--> statement-breakpoint
CREATE TABLE "analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"tenant_domain" text,
	"market_id" varchar,
	"themes" jsonb NOT NULL,
	"messaging" jsonb NOT NULL,
	"gaps" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"company_profile_snapshot" jsonb,
	"competitors_snapshot" jsonb NOT NULL,
	"analysis_snapshot" jsonb NOT NULL,
	"recommendations_snapshot" jsonb,
	"is_proxy" boolean DEFAULT false NOT NULL,
	"proxy_name" text,
	"proxy_company" text,
	"proxy_job_title" text,
	"proxy_industry" text,
	"proxy_company_size" text,
	"proxy_country" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battlecards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"strengths" jsonb,
	"weaknesses" jsonb,
	"our_advantages" jsonb,
	"comparison" jsonb,
	"objections" jsonb,
	"talk_tracks" jsonb,
	"quick_stats" jsonb,
	"custom_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"last_generated_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_asset_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_asset_product_tags" (
	"asset_id" varchar NOT NULL,
	"tag_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"url" text,
	"file_url" text,
	"file_type" text,
	"file_size" integer,
	"category_id" varchar,
	"product_ids" text[],
	"tags" jsonb,
	"source_content_asset_id" varchar,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"asset_id" varchar NOT NULL,
	"override_title" text,
	"override_content" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_social_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"social_account_id" varchar NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"number_of_days" integer,
	"include_saturday" boolean DEFAULT false NOT NULL,
	"include_sunday" boolean DEFAULT false NOT NULL,
	"product_ids" text[],
	"always_hashtags" jsonb DEFAULT '[]'::jsonb,
	"post_generation_job_id" varchar,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"client_name" text NOT NULL,
	"client_domain" text,
	"description" text,
	"analysis_type" text DEFAULT 'company' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notify_on_updates" boolean DEFAULT false,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"owner_user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"organization_id" varchar,
	"market_id" varchar,
	"company_name" text NOT NULL,
	"website_url" text NOT NULL,
	"logo_url" text,
	"linkedin_url" text,
	"instagram_url" text,
	"twitter_url" text,
	"blog_url" text,
	"description" text,
	"headquarters" text,
	"founded" text,
	"employee_count" text,
	"industry" text,
	"revenue" text,
	"funding_raised" text,
	"last_analysis" timestamp,
	"analysis_data" jsonb,
	"last_crawl" text,
	"last_social_crawl" timestamp,
	"linkedin_content" text,
	"instagram_content" text,
	"twitter_content" text,
	"linkedin_engagement" jsonb,
	"instagram_engagement" jsonb,
	"twitter_engagement" jsonb,
	"blog_snapshot" jsonb,
	"crawl_data" jsonb,
	"last_full_crawl" timestamp,
	"previous_website_content" text,
	"last_website_monitor" timestamp,
	"social_check_frequency" text DEFAULT 'daily' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" varchar,
	"product_id" varchar,
	"project_id" varchar,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"entity_name" text,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"market_presence_score" integer DEFAULT 0,
	"innovation_score" integer DEFAULT 0,
	"pricing_score" integer DEFAULT 0,
	"feature_breadth_score" integer DEFAULT 0,
	"content_activity_score" integer DEFAULT 0,
	"social_engagement_score" integer DEFAULT 0,
	"trend_direction" text DEFAULT 'stable',
	"trend_delta" integer DEFAULT 0,
	"previous_overall_score" integer,
	"score_breakdown" jsonb,
	"last_calculated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"linkedin_url" text,
	"instagram_url" text,
	"twitter_url" text,
	"blog_url" text,
	"favicon_url" text,
	"screenshot_url" text,
	"last_crawl" text,
	"last_social_crawl" timestamp,
	"linkedin_content" text,
	"instagram_content" text,
	"twitter_content" text,
	"linkedin_engagement" jsonb,
	"instagram_engagement" jsonb,
	"twitter_engagement" jsonb,
	"blog_snapshot" jsonb,
	"crawl_data" jsonb,
	"last_full_crawl" timestamp,
	"previous_website_content" text,
	"last_website_monitor" timestamp,
	"social_check_frequency" text DEFAULT 'daily' NOT NULL,
	"exclude_from_crawl" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" varchar,
	"tenant_domain" text,
	"market_id" varchar,
	"project_id" varchar,
	"analysis_data" jsonb,
	"headquarters" text,
	"founded" text,
	"employee_count" text,
	"revenue" text,
	"funding_raised" text,
	"industry" text,
	"consecutive_crawl_failures" integer DEFAULT 0 NOT NULL,
	"crawl_flagged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultant_access" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_id" varchar NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"granted_by" varchar NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_asset_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_asset_product_tags" (
	"asset_id" varchar NOT NULL,
	"tag_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"content" text,
	"ai_summary" text,
	"lead_image_url" text,
	"extraction_status" text DEFAULT 'none',
	"file_url" text,
	"file_type" text,
	"file_size" integer,
	"category_id" varchar,
	"product_ids" text[],
	"tags" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"captured_via_extension" boolean DEFAULT false NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_blocklist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"reason" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_blocklist_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"entra_id" text,
	"azure_tenant_id" text,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "executive_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar,
	"company_profile_id" varchar,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"scope" text DEFAULT 'baseline' NOT NULL,
	"company_snapshot" text,
	"market_position" text,
	"competitive_landscape" text,
	"opportunities" text,
	"locked_sections" jsonb DEFAULT '[]'::jsonb,
	"data_hash" text,
	"summary_data" jsonb,
	"top_competitors" jsonb,
	"key_insights" jsonb,
	"alert_items" jsonb,
	"last_generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"related_competitors" jsonb,
	"suggested_priority" text,
	"suggested_quarter" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_emails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"platform" text DEFAULT 'outlook' NOT NULL,
	"tone" text DEFAULT 'professional' NOT NULL,
	"call_to_action" text,
	"recipient_context" text,
	"subject" text NOT NULL,
	"preview_text" text,
	"html_body" text NOT NULL,
	"text_body" text,
	"subject_line_suggestions" text[],
	"coaching_tips" text[],
	"label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"social_account_id" varchar,
	"tenant_domain" text NOT NULL,
	"platform" text NOT NULL,
	"content" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"image_prompt" text,
	"source_url" text,
	"override_image_url" text,
	"override_brand_asset_id" varchar,
	"variant_group" text,
	"scheduled_date" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"edited_content" text,
	"generation_job_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_grounding_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"file_type" text NOT NULL,
	"original_file_name" text NOT NULL,
	"extracted_text" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"spe_file_id" text,
	"spe_container_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grounding_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_type" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"extracted_text" text,
	"scope" text DEFAULT 'tenant' NOT NULL,
	"use_case" text DEFAULT 'intelligence' NOT NULL,
	"contexts" jsonb,
	"competitor_id" varchar,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"spe_file_id" text,
	"spe_container_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_briefings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"briefing_data" jsonb,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"competitor_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "long_form_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"project_id" varchar,
	"company_profile_id" varchar,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"content" text,
	"saved_prompts" jsonb,
	"status" text DEFAULT 'not_generated' NOT NULL,
	"last_generated_at" timestamp,
	"generated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"description" text,
	"config_matrix" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_product_tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"activity_group" text NOT NULL,
	"timeframe" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"ai_generated" boolean DEFAULT true NOT NULL,
	"source_recommendation_id" varchar,
	"assigned_to" varchar,
	"due_date" timestamp,
	"planner_task_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_domain" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"favicon_url" text,
	"screenshot_url" text,
	"linkedin_url" text,
	"instagram_url" text,
	"twitter_url" text,
	"blog_url" text,
	"headquarters" text,
	"founded" text,
	"employee_count" text,
	"revenue" text,
	"funding_raised" text,
	"industry" text,
	"crawl_data" jsonb,
	"previous_website_content" text,
	"linkedin_content" text,
	"instagram_content" text,
	"twitter_content" text,
	"linkedin_engagement" jsonb,
	"instagram_engagement" jsonb,
	"twitter_engagement" jsonb,
	"blog_snapshot" jsonb,
	"last_full_crawl" timestamp,
	"last_website_monitor" timestamp,
	"last_social_crawl" timestamp,
	"last_crawl" text,
	"archived_at" timestamp,
	"deleted_at" timestamp,
	"active_reference_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_canonical_domain_unique" UNIQUE("canonical_domain")
);
--> statement-breakpoint
CREATE TABLE "page_views" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"session_id" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" varchar NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "product_battlecards" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baseline_product_id" varchar NOT NULL,
	"competitor_product_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"strengths" jsonb,
	"weaknesses" jsonb,
	"our_advantages" jsonb,
	"key_differentiators" jsonb,
	"objections" jsonb,
	"talk_tracks" jsonb,
	"feature_comparison" jsonb,
	"custom_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"last_generated_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_features" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"priority" text DEFAULT 'medium',
	"target_quarter" text,
	"target_year" integer,
	"competitor_parity" jsonb,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"product_type" text DEFAULT 'product' NOT NULL,
	"url" text,
	"company_name" text,
	"competitor_id" varchar,
	"company_profile_id" varchar,
	"is_baseline" boolean DEFAULT false,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"created_by" varchar NOT NULL,
	"crawl_data" jsonb,
	"analysis_data" jsonb,
	"linkedin_url" text,
	"instagram_url" text,
	"twitter_url" text,
	"social_check_frequency" text DEFAULT 'daily',
	"last_social_crawl" timestamp,
	"previous_website_content" text,
	"last_website_monitor" timestamp,
	"competitive_position_summary" text,
	"summary_generated_at" timestamp,
	"source_content_asset_id" varchar,
	"exclude_from_crawl" boolean DEFAULT false NOT NULL,
	"consecutive_crawl_failures" integer DEFAULT 0 NOT NULL,
	"crawl_flagged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"role" text DEFAULT 'competitor' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"area" text NOT NULL,
	"impact" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" varchar,
	"dismissed_at" timestamp,
	"accepted_at" timestamp,
	"competitor_id" varchar,
	"product_id" varchar,
	"project_id" varchar,
	"user_id" varchar,
	"tenant_domain" text,
	"market_id" varchar,
	"thumbs_up" integer DEFAULT 0 NOT NULL,
	"thumbs_down" integer DEFAULT 0 NOT NULL,
	"is_priority" boolean DEFAULT false NOT NULL,
	"dedupe_key" text,
	"dismissed_reason" text,
	"dismissed_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"size" text NOT NULL,
	"author" text NOT NULL,
	"status" text NOT NULL,
	"scope" text DEFAULT 'baseline' NOT NULL,
	"project_id" varchar,
	"tenant_domain" text,
	"market_id" varchar,
	"created_by" varchar,
	"file_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"feature_id" varchar,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"quarter" text,
	"year" integer,
	"effort" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"ai_recommended" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_job_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"tenant_domain" text,
	"target_id" varchar,
	"target_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"entity_name" text NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"project_id" varchar,
	"overall_score" integer NOT NULL,
	"innovation_score" integer DEFAULT 0,
	"market_presence_score" integer DEFAULT 0,
	"content_activity_score" integer DEFAULT 0,
	"social_engagement_score" integer DEFAULT 0,
	"score_breakdown" jsonb,
	"period" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"competitor_limit" integer DEFAULT 3 NOT NULL,
	"analysis_limit" integer DEFAULT 5 NOT NULL,
	"admin_user_limit" integer DEFAULT 1 NOT NULL,
	"read_write_user_limit" integer DEFAULT 2 NOT NULL,
	"read_only_user_limit" integer DEFAULT 5 NOT NULL,
	"multi_market_enabled" boolean DEFAULT false NOT NULL,
	"market_limit" integer,
	"monitoring_frequency" text DEFAULT 'weekly',
	"social_monitoring_enabled" boolean DEFAULT false,
	"website_monitor_enabled" boolean DEFAULT false,
	"product_monitor_enabled" boolean DEFAULT false,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_days" integer,
	"monthly_price" integer,
	"annual_price" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"platform" text NOT NULL,
	"account_name" text NOT NULL,
	"account_id" text,
	"profile_url" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"market_id" varchar,
	"platform" text NOT NULL,
	"period" text NOT NULL,
	"followers" integer DEFAULT 0,
	"followers_delta" integer DEFAULT 0,
	"posts" integer DEFAULT 0,
	"posts_delta" integer DEFAULT 0,
	"engagement" integer DEFAULT 0,
	"engagement_delta" integer DEFAULT 0,
	"mentions" integer DEFAULT 0,
	"mentions_delta" integer DEFAULT 0,
	"raw_data" jsonb,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_replies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"message" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" serial NOT NULL,
	"user_id" varchar NOT NULL,
	"tenant_domain" text NOT NULL,
	"category" text DEFAULT 'question' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"assigned_to" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_invites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"tenant_domain" text NOT NULL,
	"invited_role" text DEFAULT 'Standard User' NOT NULL,
	"invited_by" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"trial_start_date" timestamp,
	"trial_ends_at" timestamp,
	"last_trial_reminder_sent" text,
	"user_count" integer DEFAULT 0 NOT NULL,
	"competitor_limit" integer DEFAULT 3 NOT NULL,
	"analysis_limit" integer DEFAULT 5 NOT NULL,
	"admin_user_limit" integer DEFAULT 1 NOT NULL,
	"read_write_user_limit" integer DEFAULT 2 NOT NULL,
	"read_only_user_limit" integer DEFAULT 5 NOT NULL,
	"monitoring_frequency" text DEFAULT 'weekly',
	"social_monitoring_enabled" boolean DEFAULT false,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text DEFAULT '#810FFB',
	"secondary_color" text DEFAULT '#E60CB3',
	"entra_client_id" text,
	"entra_tenant_id" text,
	"entra_client_secret" text,
	"entra_enabled" boolean DEFAULT false,
	"multi_market_enabled" boolean DEFAULT false,
	"market_limit" integer,
	"spe_container_id_dev" text,
	"spe_container_id_prod" text,
	"spe_storage_enabled" boolean DEFAULT false,
	"spe_migration_status" text,
	"spe_migration_started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'Standard User' NOT NULL,
	"company" text NOT NULL,
	"company_size" text,
	"job_title" text,
	"industry" text,
	"country" text,
	"avatar" text NOT NULL,
	"entra_id" text,
	"auth_provider" text DEFAULT 'local',
	"email_verified" boolean DEFAULT false,
	"status" text DEFAULT 'active',
	"weekly_digest_enabled" boolean DEFAULT true,
	"last_dismissed_changelog_version" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_configuration" ADD CONSTRAINT "ai_configuration_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feature_model_assignments" ADD CONSTRAINT "ai_feature_model_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battlecards" ADD CONSTRAINT "battlecards_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battlecards" ADD CONSTRAINT "battlecards_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battlecards" ADD CONSTRAINT "battlecards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_categories" ADD CONSTRAINT "brand_asset_categories_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_categories" ADD CONSTRAINT "brand_asset_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_product_tags" ADD CONSTRAINT "brand_asset_product_tags_asset_id_brand_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."brand_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_product_tags" ADD CONSTRAINT "brand_asset_product_tags_tag_id_marketing_product_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."marketing_product_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_category_id_brand_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."brand_asset_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_source_content_asset_id_content_assets_id_fk" FOREIGN KEY ("source_content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_social_accounts" ADD CONSTRAINT "campaign_social_accounts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_social_accounts" ADD CONSTRAINT "campaign_social_accounts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_post_generation_job_id_scheduled_job_runs_id_fk" FOREIGN KEY ("post_generation_job_id") REFERENCES "public"."scheduled_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_projects" ADD CONSTRAINT "client_projects_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_projects" ADD CONSTRAINT "client_projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_scores" ADD CONSTRAINT "competitor_scores_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_access" ADD CONSTRAINT "consultant_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_access" ADD CONSTRAINT "consultant_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_access" ADD CONSTRAINT "consultant_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_categories" ADD CONSTRAINT "content_asset_categories_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_categories" ADD CONSTRAINT "content_asset_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_product_tags" ADD CONSTRAINT "content_asset_product_tags_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_product_tags" ADD CONSTRAINT "content_asset_product_tags_tag_id_marketing_product_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."marketing_product_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_category_id_content_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."content_asset_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_blocklist" ADD CONSTRAINT "domain_blocklist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_summaries" ADD CONSTRAINT "executive_summaries_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_summaries" ADD CONSTRAINT "executive_summaries_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_summaries" ADD CONSTRAINT "executive_summaries_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_recommendations" ADD CONSTRAINT "feature_recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_recommendations" ADD CONSTRAINT "feature_recommendations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_emails" ADD CONSTRAINT "generated_emails_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_override_brand_asset_id_brand_assets_id_fk" FOREIGN KEY ("override_brand_asset_id") REFERENCES "public"."brand_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_posts" ADD CONSTRAINT "generated_posts_generation_job_id_scheduled_job_runs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."scheduled_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_grounding_documents" ADD CONSTRAINT "global_grounding_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_documents" ADD CONSTRAINT "grounding_documents_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_documents" ADD CONSTRAINT "grounding_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grounding_documents" ADD CONSTRAINT "grounding_documents_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_briefings" ADD CONSTRAINT "intelligence_briefings_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_form_recommendations" ADD CONSTRAINT "long_form_recommendations_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_form_recommendations" ADD CONSTRAINT "long_form_recommendations_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_form_recommendations" ADD CONSTRAINT "long_form_recommendations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "long_form_recommendations" ADD CONSTRAINT "long_form_recommendations_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_product_tags" ADD CONSTRAINT "marketing_product_tags_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_product_tags" ADD CONSTRAINT "marketing_product_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD CONSTRAINT "marketing_tasks_plan_id_marketing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."marketing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD CONSTRAINT "marketing_tasks_source_recommendation_id_recommendations_id_fk" FOREIGN KEY ("source_recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_tasks" ADD CONSTRAINT "marketing_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_battlecards" ADD CONSTRAINT "product_battlecards_baseline_product_id_products_id_fk" FOREIGN KEY ("baseline_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_battlecards" ADD CONSTRAINT "product_battlecards_competitor_product_id_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_battlecards" ADD CONSTRAINT "product_battlecards_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_battlecards" ADD CONSTRAINT "product_battlecards_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_battlecards" ADD CONSTRAINT "product_battlecards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_profile_id_company_profiles_id_fk" FOREIGN KEY ("company_profile_id") REFERENCES "public"."company_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_content_asset_id_content_assets_id_fk" FOREIGN KEY ("source_content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_products" ADD CONSTRAINT "project_products_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_products" ADD CONSTRAINT "project_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_feature_id_product_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."product_features"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."client_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_replies" ADD CONSTRAINT "support_ticket_replies_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_replies" ADD CONSTRAINT "support_ticket_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invites" ADD CONSTRAINT "tenant_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;