ALTER TABLE "grounding_documents" ADD COLUMN IF NOT EXISTS "product_id" varchar;--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'grounding_documents_product_id_products_id_fk'
    ) THEN
        ALTER TABLE "grounding_documents"
        ADD CONSTRAINT "grounding_documents_product_id_products_id_fk"
        FOREIGN KEY ("product_id")
        REFERENCES "public"."products"("id")
        ON DELETE set null
        ON UPDATE no action;
    END IF;
END
$$;
