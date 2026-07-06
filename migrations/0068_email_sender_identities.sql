CREATE TABLE IF NOT EXISTS "email_sender_identities" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "reply_to_email" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "email_sends" ADD COLUMN IF NOT EXISTS "sender_identity_id" varchar REFERENCES "email_sender_identities"("id") ON DELETE SET NULL;
