-- Read-only (SELECT only). Run on PROD after deleting Acme Construction
-- (78d4ad64-0588-4ffb-a827-9518429f3727, deleted from Admin 2026-10-20 10:30).
-- Checks the delete did what lib/company-deletion.ts says.

-- A. Company row gone. Expected: 0.
SELECT count(*) AS acme_company_rows FROM companies
WHERE id = '78d4ad64-0588-4ffb-a827-9518429f3727' OR name ILIKE 'acme%';

-- B. Every column named company_id that still holds the Acme id.
--    Expected: notifications non-zero (step F), every other table 0.
--    Any other non-zero row is an orphan.
SELECT c.table_name, c.column_name,
  (xpath('/row/n/text()', query_to_xml(format(
     'SELECT count(*) AS n FROM %I WHERE %I::text = %L',
     c.table_name, c.column_name, '78d4ad64-0588-4ffb-a827-9518429f3727'), false, true, '')))[1]::text::int AS rows_with_acme_id
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
ORDER BY rows_with_acme_id DESC, c.table_name;

-- C. Rows pointing at a project / person / subcontractor / user / company that
--    no longer exists, in every table. Acme's projects can't be named any more,
--    so this is how leftover projects, documents, check-ins, shares, invites and
--    contact cards show up. Run C once; anything non-zero may be from Acme OR
--    older than today (compare with the workspace baseline in the session notes).
WITH cols AS (
  SELECT c.table_name, c.column_name,
    CASE c.column_name WHEN 'project_id' THEN 'projects' WHEN 'person_id' THEN 'people'
      WHEN 'subcontractor_id' THEN 'subcontractors' WHEN 'user_id' THEN 'users'
      WHEN 'company_id' THEN 'companies' END AS parent
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.column_name IN ('project_id','person_id','subcontractor_id','user_id','company_id')
)
SELECT table_name, column_name, parent,
  (xpath('/row/n/text()', query_to_xml(format(
     'SELECT count(*) AS n FROM %I x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id::text = x.%I::text)',
     table_name, column_name, parent, column_name), false, true, '')))[1]::text::int AS orphan_rows
FROM cols
ORDER BY orphan_rows DESC, table_name, column_name;

-- D. Accounts: users whose home company no longer exists (expected 0), and
--    accounts anonymised today (tombstone email). Each anonymised row is an
--    Acme-home account that could not be deleted because it had content elsewhere.
SELECT count(*) AS users_homed_nowhere FROM users u
WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = u.company_id);

SELECT u.id, u.email, c.name AS rehomed_to, u.portal_only, u.sessions_invalid_before
FROM users u LEFT JOIN companies c ON c.id = u.company_id
WHERE u.email LIKE 'deleted-%@removed.invalid'
ORDER BY u.sessions_invalid_before DESC NULLS LAST;

-- E. Any known Acme-home login still present. Expected: 0 rows.
SELECT email, company_id FROM users
WHERE email ILIKE '%@acme.com' OR email IN ('paul@acme.com','sarah@acme.com');

-- F. Bell alerts still tagged to Acme (all belong to accounts outside Acme:
--    Acme-home accounts' alerts were deleted). Expected to remain, never shown.
SELECT count(*) AS acme_tagged_alerts FROM notifications
WHERE company_id = '78d4ad64-0588-4ffb-a827-9518429f3727';

SELECT u.email, hc.name AS home_company, count(*) AS alerts
FROM notifications n JOIN users u ON u.id = n.user_id
LEFT JOIN companies hc ON hc.id = u.company_id
WHERE n.company_id = '78d4ad64-0588-4ffb-a827-9518429f3727'
GROUP BY u.email, hc.name ORDER BY alerts DESC;
