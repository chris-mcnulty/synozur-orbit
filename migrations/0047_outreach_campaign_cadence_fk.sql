-- outreach_campaigns.cadence_template_id was created as a plain varchar in 0044
-- (it couldn't reference cadence_templates inline, since that table is created
-- later in the same migration). Add the FK now that both tables exist.
-- ON DELETE SET NULL: removing a template detaches campaigns rather than
-- cascade-deleting them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_campaigns_cadence_template_id_fk'
  ) THEN
    ALTER TABLE outreach_campaigns
      ADD CONSTRAINT outreach_campaigns_cadence_template_id_fk
      FOREIGN KEY (cadence_template_id) REFERENCES cadence_templates(id) ON DELETE SET NULL;
  END IF;
END $$;
