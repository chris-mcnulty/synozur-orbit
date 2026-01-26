-- Orbit Production Database Fix: Null Market IDs
-- Run this script in the production database to assign orphaned recommendations
-- and analysis records to their correct default market.
-- 
-- Date: 2026-01-26
-- Issue: AI suggestions from all markets appearing in baseline market
-- Cause: Recommendations/analysis created without marketId before context fix

-- Step 1: View current default markets (run first to get the UUIDs)
SELECT m.id as market_id, m.name, t.domain as tenant_domain, m.is_default 
FROM markets m 
JOIN tenants t ON m.tenant_id = t.id 
WHERE m.is_default = true;

-- Step 2: Check how many records need fixing per tenant
SELECT 'recommendations' as table_name, tenant_domain, COUNT(*) as null_count 
FROM recommendations WHERE market_id IS NULL 
GROUP BY tenant_domain
UNION ALL
SELECT 'analysis' as table_name, tenant_domain, COUNT(*) as null_count 
FROM analysis WHERE market_id IS NULL 
GROUP BY tenant_domain;

-- Step 3: Update recommendations with correct default market IDs
-- IMPORTANT: Replace the UUIDs below with the actual market_id values from Step 1

-- For synozur.com (replace UUID with actual value from Step 1)
UPDATE recommendations 
SET market_id = '137db123-4906-4e61-af99-f0d23d86a622'  -- Replace with actual synozur.com default market ID
WHERE tenant_domain = 'synozur.com' AND market_id IS NULL;

-- For chrismcnulty.net (replace UUID with actual value from Step 1)
UPDATE recommendations 
SET market_id = '08610095-ef99-4205-b5ae-13264021a471'  -- Replace with actual chrismcnulty.net default market ID
WHERE tenant_domain = 'chrismcnulty.net' AND market_id IS NULL;

-- Add more UPDATE statements for other tenants as needed:
-- UPDATE recommendations 
-- SET market_id = 'default-market-uuid-for-this-tenant'
-- WHERE tenant_domain = 'other-tenant-domain.com' AND market_id IS NULL;

-- Step 4: Update analysis records with correct default market IDs

-- For synozur.com
UPDATE analysis 
SET market_id = '137db123-4906-4e61-af99-f0d23d86a622'  -- Replace with actual synozur.com default market ID
WHERE tenant_domain = 'synozur.com' AND market_id IS NULL;

-- For chrismcnulty.net
UPDATE analysis 
SET market_id = '08610095-ef99-4205-b5ae-13264021a471'  -- Replace with actual chrismcnulty.net default market ID
WHERE tenant_domain = 'chrismcnulty.net' AND market_id IS NULL;

-- Step 5: Verify the fix (should return 0 for both)
SELECT 'recommendations' as table_name, COUNT(*) as remaining_null 
FROM recommendations WHERE market_id IS NULL
UNION ALL
SELECT 'analysis' as table_name, COUNT(*) as remaining_null 
FROM analysis WHERE market_id IS NULL;
