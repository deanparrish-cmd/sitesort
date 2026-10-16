-- Read-only (SELECT only). Run on PROD before deleting Acme Construction
-- (2026-10-16). Deleting a company deletes every account whose HOME company is
-- Acme, and that account's memberships in EVERY company go with it.

-- 1. Accounts homed at Acme. Any row with something in the last two columns
--    is a person who would ALSO lose access to another company's projects.
--    Expected: none. If any, stop and tell me.
SELECT u.email, u.portal_only,
  (SELECT string_agg(DISTINCT c2.name, ', ') FROM project_members pm
     JOIN projects p ON p.id = pm.project_id JOIN companies c2 ON c2.id = p.company_id
     WHERE pm.user_id = u.id AND p.company_id <> u.company_id) AS on_other_companies_projects,
  (SELECT string_agg(DISTINCT c3.name, ', ') FROM company_members cm
     JOIN companies c3 ON c3.id = cm.company_id
     WHERE cm.user_id = u.id AND cm.company_id <> u.company_id) AS other_company_memberships
FROM users u JOIN companies c ON c.id = u.company_id
WHERE c.name = 'Acme Construction'
ORDER BY u.portal_only, u.email;

-- 2. People homed ELSEWHERE who are on Acme projects (they lose only Acme).
SELECT u.email, hc.name AS home_company, p.name AS acme_project
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
JOIN companies ac ON ac.id = p.company_id AND ac.name = 'Acme Construction'
JOIN users u ON u.id = pm.user_id
JOIN companies hc ON hc.id = u.company_id
WHERE u.company_id <> ac.id;

-- 3. Exactly one company of that name (the delete is by id; check it).
SELECT id, name, created_at, subscription_tier, stripe_customer_id FROM companies WHERE name ILIKE 'acme%';
