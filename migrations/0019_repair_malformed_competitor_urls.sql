-- Repair competitor and company-profile URLs that were stored with a malformed
-- scheme separator (e.g. "https///example.com" instead of "https://example.com").
-- The regex matches "https/" or "http/" or "https///" etc. — any run of 1-3
-- slashes immediately after the scheme name that is missing the colon.

UPDATE competitors
SET url = regexp_replace(url, '^(https?)/{1,3}([^/])', '\1://\2')
WHERE url ~ '^https?/{1,3}[^/]';

UPDATE organizations
SET url = regexp_replace(url, '^(https?)/{1,3}([^/])', '\1://\2')
WHERE url IS NOT NULL
  AND url ~ '^https?/{1,3}[^/]';

UPDATE company_profiles
SET website_url = regexp_replace(website_url, '^(https?)/{1,3}([^/])', '\1://\2')
WHERE website_url ~ '^https?/{1,3}[^/]';
