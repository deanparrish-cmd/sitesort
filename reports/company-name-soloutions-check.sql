-- READ-ONLY. Concept Project Soloutions Ltd -> Concept Project Solutions Ltd
-- (Dean, 2026-10-24, confirmed by the director). Changes nothing.
-- Run each query on its own in the Replit SQL console (prod).

-- 1. The company row. Expect exactly ONE row with the misspelt name, and
--    no row already spelt correctly (a second row would mean a duplicate
--    company, which needs a different fix).
SELECT c.id, c.name, c.created_at, c.subscription_tier, c.subscription_status,
       (SELECT count(*) FROM company_members m WHERE m.company_id = c.id) AS members,
       (SELECT count(*) FROM projects p WHERE p.company_id = c.id)        AS projects
FROM companies c
WHERE c.name ILIKE '%concept project%';

-- 2. Every column, in every table, that holds the misspelling anywhere in
--    its text (case-insensitive, also inside JSON and arrays). One row per
--    table + column with a count. Uses query_to_xml so a single SELECT can
--    scan every column that exists on prod; nothing is written.
SELECT table_name, column_name, rows_with_misspelling
FROM (
  SELECT c.table_name, c.column_name,
         (xpath('/row/n/text()', query_to_xml(
            format('SELECT count(*) AS n FROM public.%I WHERE %I::text ILIKE %L',
                   c.table_name, c.column_name, '%soloution%'),
            false, true, '')))[1]::text::int AS rows_with_misspelling
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
) s
WHERE rows_with_misspelling > 0
ORDER BY table_name, column_name;

-- 3. Firm records (subcontractors.company_name) with the misspelling, and
--    WHICH SiteSort company owns each record. A record owned by another
--    company is that company's own contact entry, typed by them.
SELECT s.id, s.company_name, s.contact_name, s.company_id AS owned_by_company_id,
       oc.name AS owned_by_company, s.archived_at, s.created_at
FROM subcontractors s
LEFT JOIN companies oc ON oc.id = s.company_id
WHERE s.company_name ILIKE '%soloution%'
ORDER BY s.created_at;

-- 4. Site check-ins carrying the misspelling: per project, how many, the
--    date range, and how many are OPEN right now (on site at this moment).
SELECT ci.project_id, p.name AS project, count(*) AS rows,
       min(ci.checked_in_at) AS first_at, max(ci.checked_in_at) AS last_at,
       count(*) FILTER (WHERE ci.checked_out_at IS NULL AND ci.auto_closed_at IS NULL) AS open_now
FROM site_checkins ci
LEFT JOIN projects p ON p.id = ci.project_id
WHERE ci.company_name ILIKE '%soloution%'
GROUP BY ci.project_id, p.name
ORDER BY last_at DESC;
