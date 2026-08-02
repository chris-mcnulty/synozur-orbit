-- Add body column to obs_evidence for storing raw scan report payloads
ALTER TABLE "obs_evidence" ADD COLUMN IF NOT EXISTS "body" text;
