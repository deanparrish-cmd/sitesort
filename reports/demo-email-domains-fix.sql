-- Move the remaining seeded addresses off domains we don't own (2026-10-16).
-- Run on PROD. Acme Construction's addresses (acme.com, sparks.co.uk,
-- plumbright.co.uk) are NOT here: deleting Acme on Monday removes them
-- (see reports/acme-delete-precheck.sql).
--
-- Left after Acme goes, all on domains we don't own:
--   bob@betabuilds.com      (Beta Builds)    betabuilds.com has no mail server: bounces
--   tom@testsitesort.co.uk  (Test SiteSort)  domain does not exist: hard bounce
--   test@sitesort.com       (Test SiteSort)  sitesort.com is NOT ours (ours is .co.uk)
--
-- New addresses use demo.sitesort.test: ".test" is reserved, nobody can own it,
-- and SiteSort never sends to it. Logins keep working with the new address.
--
-- HOW TO RUN: PART A first and read it. Then PART B (ends in ROLLBACK, so the
-- first run changes nothing). If C1 is empty and C2 looks right, change
-- ROLLBACK to COMMIT and run PART B again. Re-running is harmless.

-- ===================== PART A: read only =====================
-- A1. Every non-test email domain on prod. Anything that isn't a real person's
--     own address and isn't Acme's or listed above: tell me before PART B.
WITH e AS (
  SELECT 'users' AS tbl, lower(email) AS addr FROM users
  UNION ALL SELECT 'people', lower(email) FROM people WHERE email IS NOT NULL
  UNION ALL SELECT 'project_invites', lower(email) FROM project_invites WHERE email IS NOT NULL
  UNION ALL SELECT 'subcontractors', lower(contact_email) FROM subcontractors WHERE contact_email IS NOT NULL
  UNION ALL SELECT 'share_access_requests', lower(email) FROM share_access_requests WHERE email IS NOT NULL
)
SELECT split_part(addr, '@', 2) AS domain, tbl, count(*) AS n
FROM e
WHERE split_part(addr, '@', 2) !~ '(\.test|\.invalid|\.example|\.local|\.localhost)$'
  AND split_part(addr, '@', 2) !~ '^(.+\.)?example\.(com|net|org)$'
GROUP BY 1, 2 ORDER BY 1, 2;

-- A2. Must return 0 rows: the new addresses don't exist yet.
SELECT email FROM users WHERE lower(email) IN ('bob@demo.sitesort.test', 'tom@demo.sitesort.test');

-- ===================== PART B: the change =====================
BEGIN;
UPDATE users  SET email = 'bob@demo.sitesort.test'  WHERE lower(email) = 'bob@betabuilds.com';
UPDATE users  SET email = 'tom@demo.sitesort.test'  WHERE lower(email) = 'tom@testsitesort.co.uk';
UPDATE people SET email = 'test@demo.sitesort.test' WHERE lower(email) = 'test@sitesort.com';

-- C1. Must return 0 rows.
SELECT email FROM users  WHERE lower(email) IN ('bob@betabuilds.com', 'tom@testsitesort.co.uk')
UNION ALL SELECT email FROM people WHERE lower(email) = 'test@sitesort.com';
-- C2. The new addresses.
SELECT 'users' AS tbl, email, name FROM users WHERE email LIKE '%@demo.sitesort.test'
UNION ALL SELECT 'people', email, name FROM people WHERE email LIKE '%@demo.sitesort.test';

ROLLBACK;  -- change to COMMIT once C1 is empty and C2 looks right
