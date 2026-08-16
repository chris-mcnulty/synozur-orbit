-- Add explicit rebuild timestamp to markets so the opportunity matrix staleness
-- check has a reliable anchor that is unaffected by user cell edits.
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS matrix_last_rebuilt_at timestamp;
