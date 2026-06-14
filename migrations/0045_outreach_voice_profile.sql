-- Per-seller "personal" outbound voice profiles for sales outreach.
-- social_account_id becomes nullable (a personal voice has no social account);
-- owner_user_id identifies the seller. Postgres UNIQUE ignores NULLs, so the
-- one-profile-per-social-account guarantee is preserved for real accounts.
ALTER TABLE social_account_voice_profiles ALTER COLUMN social_account_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE social_account_voice_profiles ADD COLUMN IF NOT EXISTS owner_user_id varchar REFERENCES users(id) ON DELETE CASCADE;
