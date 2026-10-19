-- Read-only (2026-10-19). Dean (login 174f0396, card ab458bd2) sees portal shares
-- made up to 30 Jul 2026 and none after, on project 09b3eb48 "test 1 site sort".
-- No code change on the share/list path in that window; these find the data cause.

-- 1. Every share on the project with its document. Look for project_mismatch = true,
--    or a document whose only rules are after 30 Jul and whose doc_status isn't
--    current/superseded.
SELECT s.*,
       d.project_id AS doc_project, (d.project_id IS DISTINCT FROM s.project_id) AS project_mismatch,
       d.name AS doc_name, d.type AS doc_type, d.status AS doc_status, d.version, d.revision,
       d.created_at AS doc_created,
       min(s.created_at) OVER (PARTITION BY s.item_id) AS first_rule_on_item,
       max(s.created_at) OVER (PARTITION BY s.item_id) AS last_rule_on_item
FROM portal_shares s
LEFT JOIN documents d ON s.item_type = 'document' AND d.id = s.item_id
WHERE s.project_id = '09b3eb48-5c9f-4687-b5f6-954b27f708bd'
   OR d.project_id = '09b3eb48-5c9f-4687-b5f6-954b27f708bd'
ORDER BY s.created_at;

-- 2. Which project each of Dean's portal views ran against, and its HTTP status (#132).
SELECT a.created_at, a.project_id, a.section, a.metadata->>'status' AS http_status
FROM activity_log a
WHERE a.user_id = (SELECT id FROM users WHERE email = 'dean.parrish@partnersand.com')
  AND a.action = 'view' AND a.created_at > '2026-07-25'
ORDER BY a.created_at DESC LIMIT 40;
