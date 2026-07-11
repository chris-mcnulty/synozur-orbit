-- Backfill crawledAt into crawl_data JSONB for rows where the field is absent.
-- Rows written before the coverage-collapse guard was added have no crawledAt,
-- which makes isCoverageCollapse() treat them as permanently-guarded.  We inject
-- the row-level last_full_crawl (preferred) or last_website_monitor as the
-- timestamp so the 30-day escape hatch can eventually disarm the guard.

-- competitors
UPDATE competitors
SET crawl_data = jsonb_set(
  crawl_data,
  '{crawledAt}',
  to_jsonb(
    to_char(
      COALESCE(last_full_crawl, last_website_monitor),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  )
)
WHERE crawl_data IS NOT NULL
  AND crawl_data->>'crawledAt' IS NULL
  AND COALESCE(last_full_crawl, last_website_monitor) IS NOT NULL;

-- organizations
UPDATE organizations
SET crawl_data = jsonb_set(
  crawl_data,
  '{crawledAt}',
  to_jsonb(
    to_char(
      COALESCE(last_full_crawl, last_website_monitor),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  )
)
WHERE crawl_data IS NOT NULL
  AND crawl_data->>'crawledAt' IS NULL
  AND COALESCE(last_full_crawl, last_website_monitor) IS NOT NULL;

-- company_profiles
UPDATE company_profiles
SET crawl_data = jsonb_set(
  crawl_data,
  '{crawledAt}',
  to_jsonb(
    to_char(
      COALESCE(last_full_crawl, last_website_monitor),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  )
)
WHERE crawl_data IS NOT NULL
  AND crawl_data->>'crawledAt' IS NULL
  AND COALESCE(last_full_crawl, last_website_monitor) IS NOT NULL;

-- products (no last_full_crawl column, only last_website_monitor)
UPDATE products
SET crawl_data = jsonb_set(
  crawl_data,
  '{crawledAt}',
  to_jsonb(
    to_char(
      last_website_monitor,
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  )
)
WHERE crawl_data IS NOT NULL
  AND crawl_data->>'crawledAt' IS NULL
  AND last_website_monitor IS NOT NULL;
