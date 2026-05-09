-- Account Voice Profiles (Phase 1 of social posting personalization)
--
-- One-to-one with social_accounts. Backfills a sensible default profile for
-- every existing active row: 1st-person/individual when authorMode='person'
-- (or unset), 3rd-person/brand when authorMode='organization'. The
-- generated_posts table also gains a snapshot column so historical posts
-- aren't retroactively rewritten when a profile changes.

CREATE TABLE IF NOT EXISTS "social_account_voice_profiles" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "social_account_id" varchar NOT NULL,
    "tenant_domain" text NOT NULL,
    "person" text NOT NULL DEFAULT 'first',
    "author_perspective" text NOT NULL DEFAULT 'individual',
    "tone_attributes" jsonb,
    "style_guidance" text,
    "forbidden_phrases" text[],
    "preferred_phrases" text[],
    "emoji_policy" text NOT NULL DEFAULT 'sparing',
    "hashtag_policy" text NOT NULL DEFAULT 'standard',
    "max_length" integer,
    "sample_snippets" jsonb DEFAULT '[]'::jsonb,
    "default_persona_id" varchar,
    "default_framework_refs" jsonb DEFAULT '[]'::jsonb,
    "created_by" varchar NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'social_account_voice_profiles_social_account_id_unique'
    ) THEN
        ALTER TABLE "social_account_voice_profiles"
            ADD CONSTRAINT "social_account_voice_profiles_social_account_id_unique"
            UNIQUE ("social_account_id");
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'social_account_voice_profiles_social_account_id_social_accounts_id_fk'
    ) THEN
        ALTER TABLE "social_account_voice_profiles"
            ADD CONSTRAINT "social_account_voice_profiles_social_account_id_social_accounts_id_fk"
            FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'social_account_voice_profiles_default_persona_id_personas_id_fk'
    ) THEN
        ALTER TABLE "social_account_voice_profiles"
            ADD CONSTRAINT "social_account_voice_profiles_default_persona_id_personas_id_fk"
            FOREIGN KEY ("default_persona_id") REFERENCES "public"."personas"("id") ON DELETE set null;
    END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'social_account_voice_profiles_created_by_users_id_fk'
    ) THEN
        ALTER TABLE "social_account_voice_profiles"
            ADD CONSTRAINT "social_account_voice_profiles_created_by_users_id_fk"
            FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
    END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "social_account_voice_profiles_tenant_idx"
    ON "social_account_voice_profiles" ("tenant_domain");
--> statement-breakpoint

-- Voice snapshot + rewrite lineage on generated_posts. Snapshot is what was
-- in effect at schedule/publish time; lineage captures every AI rewrite.
ALTER TABLE "generated_posts"
    ADD COLUMN IF NOT EXISTS "voice_profile_snapshot" jsonb;
--> statement-breakpoint

ALTER TABLE "generated_posts"
    ADD COLUMN IF NOT EXISTS "rewrite_lineage" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- Backfill: one default profile per existing active social account. Choose
-- 1st-person for personal LinkedIn identities, 3rd-person/brand for orgs.
-- Skip rows that already have a profile (idempotent re-run).
INSERT INTO "social_account_voice_profiles" (
    "social_account_id", "tenant_domain", "person", "author_perspective", "created_by"
)
SELECT
    sa."id",
    sa."tenant_domain",
    CASE WHEN sa."author_mode" = 'organization' THEN 'third' ELSE 'first' END,
    CASE WHEN sa."author_mode" = 'organization' THEN 'brand' ELSE 'individual' END,
    sa."created_by"
FROM "social_accounts" sa
WHERE sa."status" = 'active'
  AND NOT EXISTS (
      SELECT 1 FROM "social_account_voice_profiles" v
      WHERE v."social_account_id" = sa."id"
  );
