-- Add source_brief_id to generated_posts for brief-origin traceability.
-- When posts are generated via the campaign Content Plan "Generate posts"
-- button, this FK records which brief triggered the run.
ALTER TABLE "generated_posts"
  ADD COLUMN IF NOT EXISTS "source_brief_id" varchar
  REFERENCES "content_briefs"("id") ON DELETE SET NULL;
