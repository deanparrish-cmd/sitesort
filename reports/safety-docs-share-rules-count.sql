-- READ-ONLY. If safety documents obeyed share rules, who would lose them?
-- (Dean, 2026-10-24.) Today every portal member of a project sees every
-- current safety document on it, with or without a share rule. Changes nothing.

-- 1. Per project: current safety documents, how many have ANY portal share
--    rule, how many have none (these would vanish for everyone not signed),
--    and how many accepted portal members the project has.
SELECT p.id AS project_id, p.name AS project, co.name AS company,
       count(d.id)                                                     AS current_safety_docs,
       count(d.id) FILTER (WHERE EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id))     AS with_a_rule,
       count(d.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id)) AS no_rule,
       (SELECT count(DISTINCT pm.user_id) FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id IS NOT NULL) AS portal_logins
FROM documents d
JOIN projects p ON p.id = d.project_id
JOIN companies co ON co.id = p.company_id
WHERE d.type = 'safety' AND d.status = 'current'
GROUP BY p.id, p.name, co.name
ORDER BY no_rule DESC, project;

-- 2. Superseded safety documents (today: openable by id by any member of
--    the project). With the fix: only signers and anyone a rule reaches.
SELECT p.name AS project, count(*) AS superseded_safety_docs,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM document_distributions dd WHERE dd.document_id = d.id AND dd.acknowledged_at IS NOT NULL)) AS signed_by_someone
FROM documents d JOIN projects p ON p.id = d.project_id
WHERE d.type = 'safety' AND d.status = 'superseded'
GROUP BY p.name ORDER BY 2 DESC;
