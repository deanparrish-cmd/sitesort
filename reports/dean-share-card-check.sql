-- Read-only (SELECT only). Which card did yesterday's portal share attach to,
-- and what rules are on that document now? (2026-10-16)

-- A. Every share rule on any document shared on 2026-10-15 or later, on
--    "test 1" projects. One row per rule, oldest first.
SELECT s.created_at, d.name AS doc, d.id AS doc_id, d.status, d.version,
       s.audience_type, s.trade,
       pe.name AS card, coalesce(sc.company_name, '(no firm)') AS card_company, pe.email AS card_email,
       (pm.user_id IS NOT NULL) AS card_is_portal_member, lu.email AS card_portal_login,
       sb.email AS shared_by, s.project_id
FROM portal_shares s
JOIN projects p ON p.id = s.project_id
JOIN documents d ON d.id = s.item_id
LEFT JOIN people pe ON pe.id = s.person_id
LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
LEFT JOIN project_members pm ON pm.project_id = s.project_id AND pm.person_id = s.person_id
LEFT JOIN users lu ON lu.id = pm.user_id
LEFT JOIN users sb ON sb.id = s.shared_by_user_id
WHERE s.item_type = 'document' AND p.name ILIKE '%test 1%'
  AND s.item_id IN (SELECT item_id FROM portal_shares WHERE item_type = 'document' AND created_at >= '2026-10-15')
ORDER BY d.name, s.created_at;

-- B. Documents uploaded on "test 1" projects since 2026-10-14, with how many
--    share rules each has. A new revision is a NEW document with no rules.
SELECT d.created_at, d.name, d.id AS doc_id, d.status, d.version, d.revision,
       (SELECT count(*) FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id) AS share_rules
FROM documents d JOIN projects p ON p.id = d.project_id
WHERE p.name ILIKE '%test 1%' AND d.created_at >= '2026-10-14'
ORDER BY d.created_at;

-- C. Which project Dean's portal sessions are on (compare with project_id in A).
SELECT u.email AS login, s.project_id, p.name AS project, s.last_active_at, s.revoked_at
FROM portal_sessions s
JOIN users u ON u.id = s.user_id
JOIN projects p ON p.id = s.project_id
WHERE u.email ILIKE 'dean.parrish@%'
ORDER BY s.last_active_at DESC NULLS LAST LIMIT 5;
