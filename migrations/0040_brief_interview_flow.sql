-- Interview-based content brief flow: campaigns capture the interview answers,
-- content briefs become format-agnostic concepts (summary + form categories +
-- AI fit assessment) that expand into per-format deliverable briefs.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS interview jsonb;

ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS form_categories text[];
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS fit_assessment jsonb;
ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS derived_from_brief_id varchar REFERENCES content_briefs(id) ON DELETE SET NULL;
