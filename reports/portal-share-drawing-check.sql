-- Read-only (SELECT only). Why a drawing shared to "Everyone" is missing from
-- the portal's Shared with me (2026-10-15). Replace DRAWING NAME and the email
-- in each query.

-- 1. The drawing: every row with that name (revisions included).
SELECT d.id, p.name AS project, d.project_id, d.type, d.status, d.version, d.revision, d.created_at
FROM documents d JOIN projects p ON p.id = d.project_id
WHERE d.name ILIKE '%DRAWING NAME%'
ORDER BY d.created_at DESC;

-- 2. Share rules for those rows. None = the share was never written.
SELECT s.item_id, s.project_id, s.audience_type, s.trade, s.person_id, s.created_at, u.email AS shared_by
FROM portal_shares s
JOIN documents d ON d.id = s.item_id
LEFT JOIN users u ON u.id = s.shared_by_user_id
WHERE s.item_type = 'document' AND d.name ILIKE '%DRAWING NAME%'
ORDER BY s.created_at DESC;

-- 3. Every project_members row for the portal login on that project.
--    The portal needs one with person_id set.
SELECT m.id, m.project_id, p.name AS project, m.role, m.person_id, m.subcontractor_id, m.added_at
FROM project_members m JOIN projects p ON p.id = m.project_id JOIN users u ON u.id = m.user_id
WHERE lower(u.email) = lower('dean.parrish@me.com')
ORDER BY p.name;

-- 4. What reached that login for the drawing: distribution + notifications.
SELECT 'distribution' AS kind, dd.document_id AS item, dd.status AS detail, dd.distributed_at AS at
FROM document_distributions dd JOIN documents d ON d.id = dd.document_id JOIN users u ON u.id = dd.user_id
WHERE lower(u.email) = lower('dean.parrish@me.com') AND d.name ILIKE '%DRAWING NAME%'
UNION ALL
SELECT 'notification', n.related_entity_id, n.type || ': ' || n.title, n.created_at
FROM notifications n JOIN users u ON u.id = n.user_id
WHERE lower(u.email) = lower('dean.parrish@me.com') AND n.created_at > now() - interval '1 day'
ORDER BY at DESC;

-- 5. The portal session in use: which project and member it is tied to.
SELECT s.project_id, p.name AS project, s.created_at, s.last_active_at, s.revoked_at
FROM portal_sessions s JOIN projects p ON p.id = s.project_id JOIN users u ON u.id = s.user_id
WHERE lower(u.email) = lower('dean.parrish@me.com')
ORDER BY s.created_at DESC LIMIT 3;
