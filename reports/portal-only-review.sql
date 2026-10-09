-- #123 review. READ ONLY. Run against PROD before (or right after) Publishing #123.

-- 1) Dead admin rows: memberships held by deleted (scrubbed) accounts.
--    After #123 these can't log in and don't count as admins. To remove them,
--    send me the membership ids from this list and I'll delete by id only.
SELECT m.id AS membership_id, m.role, c.name AS company, u.id AS user_id, u.email, u.name
FROM company_members m
JOIN users u ON u.id = m.user_id
JOIN companies c ON c.id = m.company_id
WHERE u.email LIKE 'deleted-%@removed.invalid'
ORDER BY c.name, m.role;

-- 2) Accounts the #123 boot step will make portal-only (still dashboard today,
--    every membership is site worker or subcontractor). You expect 6 test accounts.
SELECT u.id, u.email, u.name, string_agg(c.name || ':' || m.role, ', ') AS memberships, u.last_active_at
FROM users u
JOIN company_members m ON m.user_id = u.id
JOIN companies c ON c.id = m.company_id
WHERE u.portal_only = false
  AND NOT EXISTS (SELECT 1 FROM company_members x WHERE x.user_id = u.id AND x.role IN ('admin', 'project_manager'))
GROUP BY u.id, u.email, u.name, u.last_active_at
ORDER BY u.email;

-- 3) PM cover in use: per-project cover given to someone who is NOT a company
--    admin/PM. After #123 this grant does nothing (cover is dashboard-only).
SELECT p.name AS project, c.name AS company, u.email, u.name, u.portal_only
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
JOIN companies c ON c.id = p.company_id
JOIN users u ON u.id = pm.user_id
WHERE pm.is_project_manager = true
  AND NOT EXISTS (SELECT 1 FROM company_members x WHERE x.user_id = u.id AND x.company_id = p.company_id AND x.role IN ('admin', 'project_manager'))
ORDER BY c.name, p.name;

-- 4) Designated site managers who are not company admin/PM. After #123 they
--    lose the dashboard check-in register for that project.
SELECT p.name AS project, c.name AS company, u.email, u.name, u.portal_only
FROM projects p
JOIN companies c ON c.id = p.company_id
JOIN users u ON u.id = p.site_manager_id
WHERE NOT EXISTS (SELECT 1 FROM company_members x WHERE x.user_id = u.id AND x.company_id = p.company_id AND x.role IN ('admin', 'project_manager'))
ORDER BY c.name, p.name;
