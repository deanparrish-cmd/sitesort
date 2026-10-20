-- Move seeded addresses off domains we don't own. Run on PROD.
-- Revised 2026-10-20 after Dean ran Part A on prod:
--   * bob@betabuilds.com and tom@testsitesort.co.uk are NOT on prod (workspace
--     only): dropped.
--   * sitesort.com is on prod in people (1) AND subcontractors (1); the old
--     Part B only updated people. Part B now covers every email column.
--   * abcelectrical.com and lsls.com (people 1 + subcontractors 1 each): NOT in
--     any seed code and NOT in the workspace copy (newest person there is
--     30 Jul), so unconfirmed. Run PART A2 to see who they are; they are only
--     added to Part B once confirmed as test data.
-- sitesort.com is NOT ours (ours is sitesort.co.uk). New addresses use
-- demo.sitesort.test: ".test" is reserved, nobody can own it, SiteSort never
-- sends to it. email_log.to_address is history and is left alone.
-- Email columns (checked 2026-10-20): users.email, people.email,
-- subcontractors.contact_email, project_invites.email, share_access_requests.email.

-- ===================== PART A2: read only, who are they =====================
SELECT 'people' AS tbl, p.id, p.name AS name, p.email, p.phone, c.name AS owner_company,
       s.company_name AS their_firm, (p.user_id IS NOT NULL) AS has_login,
       p.created_at, p.archived_at
FROM people p
LEFT JOIN companies c ON c.id = p.company_id
LEFT JOIN subcontractors s ON s.id = p.subcontractor_id
WHERE lower(p.email) ~ '@(abcelectrical\.com|lsls\.com|sitesort\.com)$'
UNION ALL
SELECT 'subcontractors', s.id, s.contact_name, s.contact_email, s.contact_phone, c.name,
       s.company_name, NULL, s.created_at, s.archived_at
FROM subcontractors s
LEFT JOIN companies c ON c.id = s.company_id
WHERE lower(s.contact_email) ~ '@(abcelectrical\.com|lsls\.com|sitesort\.com)$'
ORDER BY 4, 1;

-- Has SiteSort ever emailed them, and are they on any project?
SELECT lower(to_address) AS to_address, status, count(*) AS sends, max(created_at) AS last_sent
FROM email_log
WHERE lower(to_address) ~ '@(abcelectrical\.com|lsls\.com|sitesort\.com)$'
GROUP BY 1, 2 ORDER BY 1, 2;

SELECT lower(p.email) AS email, pr.name AS project, pc.name AS project_company
FROM people p
JOIN project_members pm ON pm.person_id = p.id
JOIN projects pr ON pr.id = pm.project_id
JOIN companies pc ON pc.id = pr.company_id
WHERE lower(p.email) ~ '@(abcelectrical\.com|lsls\.com|sitesort\.com)$'
ORDER BY 1, 2;

-- ===================== PART B: sitesort.com, every table =====================
-- First run ends in ROLLBACK (changes nothing). If C1 is empty and C2 shows the
-- 2 expected rows, run it again ending in COMMIT. Re-running is harmless.
BEGIN;
-- C0. Must return 0 rows: no login already uses a target address.
SELECT u.email FROM users u
WHERE lower(u.email) IN (SELECT split_part(lower(email), '@', 1) || '@demo.sitesort.test'
                         FROM users WHERE lower(email) LIKE '%@sitesort.com');

UPDATE users                 SET email         = split_part(email, '@', 1)         || '@demo.sitesort.test' WHERE lower(email)         LIKE '%@sitesort.com';
UPDATE people                SET email         = split_part(email, '@', 1)         || '@demo.sitesort.test' WHERE lower(email)         LIKE '%@sitesort.com';
UPDATE subcontractors        SET contact_email = split_part(contact_email, '@', 1) || '@demo.sitesort.test' WHERE lower(contact_email) LIKE '%@sitesort.com';
UPDATE project_invites       SET email         = split_part(email, '@', 1)         || '@demo.sitesort.test' WHERE lower(email)         LIKE '%@sitesort.com';
UPDATE share_access_requests SET email         = split_part(email, '@', 1)         || '@demo.sitesort.test' WHERE lower(email)         LIKE '%@sitesort.com';

-- C1. Must return 0 rows: nothing left on sitesort.com.
SELECT 'users' AS tbl, email FROM users WHERE lower(email) LIKE '%@sitesort.com'
UNION ALL SELECT 'people', email FROM people WHERE lower(email) LIKE '%@sitesort.com'
UNION ALL SELECT 'subcontractors', contact_email FROM subcontractors WHERE lower(contact_email) LIKE '%@sitesort.com'
UNION ALL SELECT 'project_invites', email FROM project_invites WHERE lower(email) LIKE '%@sitesort.com'
UNION ALL SELECT 'share_access_requests', email FROM share_access_requests WHERE lower(email) LIKE '%@sitesort.com';
-- C2. The moved rows. Expected: 2 (people 1, subcontractors 1).
SELECT 'people' AS tbl, id, name, email FROM people WHERE email LIKE '%@demo.sitesort.test'
UNION ALL SELECT 'subcontractors', id, company_name, contact_email FROM subcontractors WHERE contact_email LIKE '%@demo.sitesort.test'
UNION ALL SELECT 'users', id, name, email FROM users WHERE email LIKE '%@demo.sitesort.test';

ROLLBACK;  -- change to COMMIT once C0 and C1 are empty and C2 shows the 2 rows
