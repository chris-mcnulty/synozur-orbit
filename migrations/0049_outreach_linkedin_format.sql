-- LinkedIn message shape + intent on outreach touches.
-- linkedin_format: connect_request | direct_message (null for email) — drives
-- the char limit and which deep-link / paste flow the seller gets.
-- intent: outreach | engagement (null = unspecified).
ALTER TABLE outreach_touches
  ADD COLUMN IF NOT EXISTS linkedin_format TEXT;
--> statement-breakpoint
ALTER TABLE outreach_touches
  ADD COLUMN IF NOT EXISTS intent TEXT;
