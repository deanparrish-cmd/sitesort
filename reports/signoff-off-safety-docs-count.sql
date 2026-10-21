-- RAMS, permits and safety documents stored with sign-off OFF.
-- READ-ONLY. Every statement is a SELECT. Safe to run on prod. (2026-10-21)
--
-- From #149 every NEW upload of these types requires sign-off. Documents
-- already stored keep requires_acknowledgment = false: nobody can sign them
-- and close-out treats them as needing no signature. This counts them. No
-- change to them until Dean decides.

-- 1. The numbers, by type and status. One row per type/status.
SELECT d.type, d.status, count(*) AS signoff_off,
  count(DISTINCT p.company_id) AS companies, count(DISTINCT d.project_id) AS projects
FROM documents d JOIN projects p ON p.id = d.project_id
WHERE d.type IN ('method_statement', 'permit', 'safety') AND NOT d.requires_acknowledgment
GROUP BY 1, 2 ORDER BY 1, 2;

-- 2. Per company and project, CURRENT documents only: how many, whether
--    they're shared on the portal (or are safety notices, visible to all),
--    how many people have them, and whether the project is already closed out.
SELECT c.name AS company, p.name AS project, p.status AS project_status,
  count(*) AS current_signoff_off,
  count(*) FILTER (WHERE d.type = 'safety' OR EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id)) AS on_portal,
  (SELECT count(*) FROM document_distributions dd JOIN documents d2 ON d2.id = dd.document_id
     WHERE d2.project_id = p.id AND d2.status = 'current' AND d2.type IN ('method_statement', 'permit', 'safety') AND NOT d2.requires_acknowledgment) AS people_with_a_copy
FROM documents d
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
WHERE d.type IN ('method_statement', 'permit', 'safety') AND NOT d.requires_acknowledgment AND d.status = 'current'
GROUP BY c.name, p.id, p.name, p.status
ORDER BY c.name, p.name;

-- 3. Each CURRENT document. Names documents and projects, never people.
SELECT c.name AS company, p.name AS project, d.name AS document, d.type,
  coalesce('Rev ' || d.revision, 'v' || d.version) AS rev, d.created_at::date AS uploaded,
  (d.type = 'safety' OR EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id)) AS on_portal,
  (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = d.id) AS people_with_a_copy,
  d.id AS document_id
FROM documents d
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
WHERE d.type IN ('method_statement', 'permit', 'safety') AND NOT d.requires_acknowledgment AND d.status = 'current'
ORDER BY c.name, p.name, d.created_at;
