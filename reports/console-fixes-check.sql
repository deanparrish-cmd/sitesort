-- Read-only check (2026-10-09): have the two prod console fixes from the
-- 2026-10-09 (2) review been run? Run in the PRODUCTION database console.
-- Changes nothing.
--
-- Expected once both fixes have run:
--   A1 row: remaining = 0
--   Amy rows: 3 rows, each with merged = yes
-- If A1 > 0 or any Amy row says merged = no, that fix hasn't run.

SELECT 'A1 dead admin memberships still present' AS check_name,
       count(*)::text AS remaining,
       NULL AS checkin_id, NULL AS person_key, NULL AS merged
FROM company_members m
JOIN users u ON u.id = m.user_id
WHERE u.email LIKE 'deleted-%@removed.invalid'

UNION ALL

SELECT 'Amy check-in row', NULL,
       c.id::text, COALESCE(c.person_key, '(none)'),
       CASE WHEN c.person_key LIKE 'person:25f8a59f%' THEN 'yes' ELSE 'no' END
FROM site_checkins c
WHERE c.id::text LIKE '6ceddc71%' OR c.id::text LIKE '9fe3e877%' OR c.id::text LIKE 'a2626e2c%';
