-- Keep the external SocialPilot destination separate from the OAuth provider
-- identity. Existing account_id values deliberately remain untouched as the
-- backward-compatible CSV fallback until a user saves this field.
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS socialpilot_account_id text;