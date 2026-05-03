-- Task #84: Notify customers when their feedback ships or gets a status update
-- Adds per-product toggle for sending email notifications when feedback
-- transitions to Planned or Shipped.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "feedback_email_notifications_enabled" boolean NOT NULL DEFAULT true;
