-- Phase 5b: per-tenant OAuth client credentials. Multi-tenant deployments
-- can't share a single SaaS-vendor app via env vars: tenant admins don't
-- have access to set environment variables, and tenants typically want
-- their own consent-screen branding and rate-limit budget anyway.
--
-- One row per (tenant_domain, platform). Secrets are encrypted at rest
-- with the same encryption helpers used for social_accounts tokens.

CREATE TABLE IF NOT EXISTS "tenant_platform_credentials" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_domain" text NOT NULL,
    "platform" text NOT NULL,
    "encrypted_client_id" text NOT NULL,
    "encrypted_client_secret" text,
    "notes" text,
    "created_by" varchar NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tenant_platform_credentials_created_by_users_id_fk'
    ) THEN
        ALTER TABLE "tenant_platform_credentials"
            ADD CONSTRAINT "tenant_platform_credentials_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
    END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_platform_credentials_tenant_platform_idx"
    ON "tenant_platform_credentials" ("tenant_domain", "platform");
