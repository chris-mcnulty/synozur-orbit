-- Task #106: per-competitor uploaded documents (PDF/DOCX/TXT) feeding AI
-- analyses, gap analysis, battlecards, executive summary and briefings.
CREATE TABLE IF NOT EXISTS "competitor_documents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_domain" text NOT NULL,
  "market_id" varchar REFERENCES "markets"("id") ON DELETE SET NULL,
  "competitor_id" varchar NOT NULL REFERENCES "competitors"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "display_title" text NOT NULL,
  "scope_tag" text,
  "object_storage_path" text,
  "spe_file_id" text,
  "spe_container_id" text,
  "byte_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  "file_type" text NOT NULL,
  "extracted_text" text,
  "status" text NOT NULL DEFAULT 'active',
  "uploaded_by_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "uploaded_at" timestamp NOT NULL DEFAULT now(),
  "archived_at" timestamp
);

CREATE INDEX IF NOT EXISTS "competitor_documents_tenant_competitor_status_idx"
  ON "competitor_documents" ("tenant_domain", "competitor_id", "status");

CREATE INDEX IF NOT EXISTS "competitor_documents_competitor_idx"
  ON "competitor_documents" ("competitor_id");
