-- READ-ONLY. Run BEFORE publishing #163 (gate never clears by default).
-- Lists every team row the gate treated as "staff" (no insurance check) that
-- the new rule treats differently. Run each query on its own.

-- 1. Will now be CHECKED against a firm: no firm on the row, but the same
--    login has a card at a firm in that company. (The Amy / Annabelle case.)
--    They are held at the gate if that firm has no in-date public liability.
SELECT pr.name AS project, pm.id AS member_row, u.email, u.name AS login_name,
       p.name AS card_name, string_agg(DISTINCT s.company_name, ', ') AS firms_found
FROM project_members pm
JOIN projects pr ON pr.id = pm.project_id
JOIN users u ON u.id = pm.user_id
LEFT JOIN people p ON p.id = pm.person_id
JOIN people fc ON fc.user_id = u.id AND fc.company_id = pr.company_id
              AND fc.subcontractor_id IS NOT NULL AND fc.archived_at IS NULL
JOIN subcontractors s ON s.id = fc.subcontractor_id
WHERE coalesce(p.subcontractor_id, pm.subcontractor_id) IS NULL
GROUP BY pr.name, pm.id, u.email, u.name, p.name
ORDER BY pr.name, u.email;

-- 2. Will now be HELD every time (firm_unknown): a login on the project with
--    no firm anywhere in the company, no in-house card of that company, and
--    not a dashboard admin / PM of the project's company. A manager can let
--    them on; to make it permanent, give them a card (in-house or at a firm).
SELECT pr.name AS project, pm.id AS member_row, u.email, u.name AS login_name,
       u.portal_only, p.name AS card_name, p.company_id = pr.company_id AS card_is_this_company
FROM project_members pm
JOIN projects pr ON pr.id = pm.project_id
JOIN users u ON u.id = pm.user_id
LEFT JOIN people p ON p.id = pm.person_id
WHERE coalesce(p.subcontractor_id, pm.subcontractor_id) IS NULL
  AND NOT (p.id IS NOT NULL AND p.company_id = pr.company_id)
  AND NOT EXISTS (SELECT 1 FROM people fc WHERE fc.user_id = u.id AND fc.company_id = pr.company_id
                    AND fc.subcontractor_id IS NOT NULL AND fc.archived_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM company_members cm WHERE cm.user_id = u.id AND cm.company_id = pr.company_id
                    AND cm.role IN ('admin', 'project_manager') AND u.portal_only = false)
ORDER BY pr.name, u.email;

-- 3. Will now be judged on a DIFFERENT firm: the row names one firm, the
--    person belongs to another. The gate now uses the person's firm (the one
--    the card shows); before, a login on that row was judged on the row's.
SELECT pr.name AS project, pm.id AS member_row, p.name AS person,
       rs.company_name AS row_firm_was, ps.company_name AS person_firm_now
FROM project_members pm
JOIN projects pr ON pr.id = pm.project_id
JOIN people p ON p.id = pm.person_id
JOIN subcontractors rs ON rs.id = pm.subcontractor_id
JOIN subcontractors ps ON ps.id = p.subcontractor_id
WHERE pm.subcontractor_id <> p.subcontractor_id
ORDER BY pr.name, p.name;
