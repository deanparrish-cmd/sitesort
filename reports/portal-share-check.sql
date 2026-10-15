-- Read-only. Portal share diagnosis (2026-10-15). Set the email to the login
-- used for the Team Portal (replace dean.parrish@me.com in queries 2 and 3).

-- 1. Latest document shares: was the row written, for which project?
SELECT s.created_at, s.audience_type, p.name AS project, d.name AS doc, d.type, d.status
FROM portal_shares s
JOIN documents d ON d.id = s.item_id
JOIN projects p ON p.id = s.project_id
WHERE s.item_type = 'document'
ORDER BY s.created_at DESC LIMIT 5;

-- 2. Projects this login is a portal member of (person_id set = portal member).
SELECT p.name AS project, m.role, m.person_id IS NOT NULL AS portal_member
FROM project_members m JOIN projects p ON p.id = m.project_id JOIN users u ON u.id = m.user_id
WHERE lower(u.email) = lower('dean.parrish@me.com');

-- 3. Which project the portal is currently open on (latest live session).
SELECT p.name AS project, s.created_at, s.last_active_at, s.revoked_at
FROM portal_sessions s JOIN projects p ON p.id = s.project_id JOIN users u ON u.id = s.user_id
WHERE lower(u.email) = lower('dean.parrish@me.com')
ORDER BY s.created_at DESC LIMIT 3;
