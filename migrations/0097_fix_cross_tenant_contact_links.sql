-- backfill:always-apply
-- Safety net for 0096: the no-email backfill linked prospects to contacts by
-- source_prospect_id alone (no tenant predicate). If any stale/corrupt
-- source_prospect_id value pointed at another tenant's prospect, a membership
-- could reference a contact from the wrong tenant. Repair by giving each such
-- membership its own contact in the correct tenant, then relinking.

-- 1. Create a replacement contact (in the prospect's tenant) for every
--    membership whose linked contact lives in a different tenant. There are
--    no person fields left on prospects, so copy them from the wrong-tenant
--    contact — the identity data is correct, only the tenant scope is not.
INSERT INTO marketing_contacts
  (tenant_domain, email, first_name, last_name, company, job_title,
   hubspot_contact_id, hubspot_company_id, linkedin_url, source,
   source_prospect_id, created_at, updated_at)
SELECT
  p.tenant_domain,
  NULL, -- email stays with the original contact (tenant+email uniqueness)
  mc.first_name, mc.last_name, mc.company, mc.job_title,
  NULL, NULL, mc.linkedin_url,
  'outreach', p.id, now(), now()
FROM prospects p
JOIN marketing_contacts mc ON mc.id = p.contact_id
WHERE mc.tenant_domain <> p.tenant_domain;

-- 2. Relink those memberships to the replacement contacts (tenant-scoped).
UPDATE prospects p SET contact_id = repl.id
FROM marketing_contacts repl, marketing_contacts wrong
WHERE wrong.id = p.contact_id
  AND wrong.tenant_domain <> p.tenant_domain
  AND repl.source_prospect_id = p.id
  AND repl.tenant_domain = p.tenant_domain;
