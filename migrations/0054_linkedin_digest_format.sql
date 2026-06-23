-- Add linkedin_digest as a recognised content brief format.
-- No structural change needed: content_briefs.format is an unconstrained text
-- column. This file documents the addition and keeps the migration sequence
-- intact for the runtime migration runner.
SELECT 1;
