ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brief_only_mode boolean NOT NULL DEFAULT false;
