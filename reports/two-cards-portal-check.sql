-- Read-only (SELECT only). Does Dean's double setup explain the missing
-- portal share? Compares Dean with Annabelle Rose (2026-10-15).
-- Edit the name patterns if the cards are named differently.

-- 1. Every login and every contact card for each person, across companies.
SELECT 'login' AS kind, u.id, u.email, u.name, c.name AS company, u.portal_only, NULL AS linked_login
FROM users u LEFT JOIN companies c ON c.id = u.company_id
WHERE u.name ILIKE '%dean%parrish%' OR u.email ILIKE '%parrish%' OR u.name ILIKE '%annabelle%'
UNION ALL
SELECT 'card', pe.id, pe.email, pe.name, c.name, NULL, lu.email
FROM people pe LEFT JOIN companies c ON c.id = pe.company_id LEFT JOIN users lu ON lu.id = pe.user_id
WHERE pe.name ILIKE '%dean%' OR pe.email ILIKE '%parrish%' OR pe.name ILIKE '%annabelle%'
ORDER BY kind, email;

-- 2. Their membership rows on projects like "test 1": which card (person_id)
--    and which login (user_id) each row ties together, and the project id.
SELECT p.id AS project_id, p.name AS project, c.name AS company,
       lu.email AS login, pe.name AS card, pe.id AS card_id, m.role
FROM project_members m
JOIN projects p ON p.id = m.project_id
JOIN companies c ON c.id = p.company_id
LEFT JOIN users lu ON lu.id = m.user_id
LEFT JOIN people pe ON pe.id = m.person_id
WHERE p.name ILIKE '%test 1%'
  AND (lu.email ILIKE '%parrish%' OR pe.name ILIKE '%dean%' OR pe.name ILIKE '%annabelle%')
ORDER BY p.name, login;

-- 3. The share rows for documents on projects like "test 1": project id and
--    who they point at. "all" points at no card at all.
SELECT s.project_id, p.name AS project, d.name AS doc, s.audience_type, pe.name AS card, s.created_at
FROM portal_shares s
JOIN projects p ON p.id = s.project_id
JOIN documents d ON d.id = s.item_id
LEFT JOIN people pe ON pe.id = s.person_id
WHERE s.item_type = 'document' AND p.name ILIKE '%test 1%'
ORDER BY s.created_at DESC LIMIT 10;

-- 4. Which project id each of their portal sessions is actually on.
SELECT u.email AS login, s.project_id, p.name AS project, c.name AS company, s.last_active_at, s.revoked_at
FROM portal_sessions s
JOIN users u ON u.id = s.user_id
JOIN projects p ON p.id = s.project_id
JOIN companies c ON c.id = p.company_id
WHERE u.email ILIKE '%parrish%' OR u.name ILIKE '%annabelle%'
ORDER BY s.last_active_at DESC NULLS LAST LIMIT 10;
