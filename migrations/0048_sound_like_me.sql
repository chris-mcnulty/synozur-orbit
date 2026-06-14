ALTER TABLE social_account_voice_profiles
  ADD COLUMN IF NOT EXISTS sound_like_me_instructions TEXT;
