-- Enforce one personal (no social account) outbound voice profile per seller.
-- The existing UNIQUE(social_account_id) ignores NULLs, so a partial unique
-- index on owner_user_id (where social_account_id IS NULL) closes the gap.
CREATE UNIQUE INDEX IF NOT EXISTS "voice_profiles_personal_owner_idx"
  ON social_account_voice_profiles (owner_user_id)
  WHERE social_account_id IS NULL AND owner_user_id IS NOT NULL;
