-- Freeze the founding "signals" (news + intelligence action items) that
-- informed a campaign at creation time onto the campaign itself. Nullable
-- jsonb so pre-existing campaigns simply have no snapshot (empty state).

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "founding_signals" jsonb;
