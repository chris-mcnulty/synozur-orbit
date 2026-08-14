-- backfill:always-apply
-- (This file is fully idempotent; the marker above tells the migration
-- runner's first-boot backfill to execute it for real instead of stamping
-- it, since its reconciliation work cannot be probed via table/index
-- existence checks.)
--
-- Reconcile support_tickets drift (task: support tickets page failing).
--
-- Some environments carry a support_tickets table that was altered outside
-- the migration runner: tenant_id varchar (FK -> tenants.id) instead of the
-- canonical tenant_domain text, plus extra columns (metadata,
-- application_source, resolved_at, resolved_by) and a ticket_number column
-- that lost its serial default.
--
-- Canonical shape = shared/schema.ts: the entire app keys tenant scope by
-- tenant_domain (text). Both dev and prod tables were verified EMPTY, so the
-- rename is safe. The extra columns are adopted into shared/schema.ts rather
-- than dropped.

-- 1) Normalize the tenant column: drop the tenants(id) FK and rename
--    tenant_id -> tenant_domain (text). No-op on canonical databases.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name = 'tenant_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name = 'tenant_domain'
    ) THEN
        ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_tenant_id_fkey";
        ALTER TABLE "support_tickets" RENAME COLUMN "tenant_id" TO "tenant_domain";
        ALTER TABLE "support_tickets" ALTER COLUMN "tenant_domain" TYPE text;
    END IF;
END $$;
--> statement-breakpoint

-- 2) Adopt the extra columns everywhere (no-ops where they already exist).
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "application_source" text DEFAULT 'Orbit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "resolved_by" varchar;
--> statement-breakpoint

-- 3) Ensure resolved_by has its users FK (guarded; name matches the drifted
--    environments so it is a duplicate-object no-op there).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_resolved_by_fkey'
    ) THEN
        ALTER TABLE "support_tickets"
            ADD CONSTRAINT "support_tickets_resolved_by_fkey"
            FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
END $$;
--> statement-breakpoint

-- 4) Restore the serial default on ticket_number where the drifted table
--    lost it (inserts would otherwise violate NOT NULL). Detect via the
--    column DEFAULT itself — sequence ownership survives DROP DEFAULT, so
--    pg_get_serial_sequence() alone is not a reliable proxy.
DO $$
DECLARE
    seq text;
BEGIN
    IF (SELECT column_default FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name = 'ticket_number') IS NULL THEN
        seq := pg_get_serial_sequence('support_tickets', 'ticket_number');
        IF seq IS NULL THEN
            CREATE SEQUENCE IF NOT EXISTS support_tickets_ticket_number_seq;
            PERFORM setval('support_tickets_ticket_number_seq',
                           COALESCE((SELECT MAX(ticket_number) FROM support_tickets), 0) + 1,
                           false);
            ALTER TABLE "support_tickets"
                ALTER COLUMN "ticket_number" SET DEFAULT nextval('support_tickets_ticket_number_seq');
            ALTER SEQUENCE support_tickets_ticket_number_seq OWNED BY support_tickets.ticket_number;
        ELSE
            -- Column still owns its original sequence; just re-attach the
            -- default and make sure the sequence is ahead of existing rows.
            PERFORM setval(seq,
                           COALESCE((SELECT MAX(ticket_number) FROM support_tickets), 0) + 1,
                           false);
            EXECUTE format('ALTER TABLE support_tickets ALTER COLUMN ticket_number SET DEFAULT nextval(%L)', seq);
        END IF;
    END IF;
END $$;
--> statement-breakpoint

-- 5) Tenant-scope index on the canonical column. 0085's guarded block may
--    have created it on tenant_id in drifted environments; the rename in
--    step 1 automatically retargets that index to tenant_domain, and this
--    covers databases where 0085 skipped it.
CREATE INDEX IF NOT EXISTS "support_tickets_tenant_status_created_idx"
    ON "support_tickets" ("tenant_domain", "status", "created_at");
