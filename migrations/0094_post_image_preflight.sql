-- Task #777: Harden auto-publish image retrieval.
-- Pre-flight image validation columns on generated_posts:
--   image_issue      typed image error code when the post's image is broken
--                    (image_not_found / image_forbidden / image_fetch_failed)
--   image_checked_at last successful pre-flight verification time
ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS image_issue text;
ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS image_checked_at timestamp;
