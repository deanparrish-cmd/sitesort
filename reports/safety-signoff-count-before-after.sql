-- READ-ONLY (2026-10-26). Changes nothing.
-- "Waiting for sign-off" per project, today vs after the safety rule:
-- every portal member of the project owes a signature on a CURRENT safety
-- document that requires sign-off (Dean, 2026-10-26).
--
-- Today (lib/outstanding-signoffs.ts, compliance.ts): per current document
-- that requires sign-off, the people with a document_distributions row who
-- haven't acknowledged, plus "not sent" (a revision with no rows whose
-- predecessor had rows: the predecessor's recipients).
-- After: for current safety documents only, the people owing are
-- (portal members of the project UNION people with a row) minus those who
-- acknowledged. Portal member = project_members row with person_id AND
-- user_id set (same test as the portal's own access check).
-- Every other document type is counted exactly as today.

WITH cur AS (
  SELECT d.id, d.project_id, d.type, d.previous_version_id
  FROM documents d
  WHERE d.status = 'current' AND d.requires_acknowledgment
),
rows_ AS (
  SELECT dd.document_id, dd.user_id, dd.status FROM document_distributions dd
  JOIN cur ON cur.id = dd.document_id
),
members AS (
  SELECT DISTINCT project_id, user_id FROM project_members
  WHERE person_id IS NOT NULL AND user_id IS NOT NULL
),
not_sent AS (
  SELECT cur.id AS document_id, count(DISTINCT p.user_id) AS n
  FROM cur
  JOIN document_distributions p ON p.document_id = cur.previous_version_id
  WHERE NOT EXISTS (SELECT 1 FROM rows_ r WHERE r.document_id = cur.id)
  GROUP BY cur.id
),
before_doc AS (
  SELECT cur.id, cur.project_id, cur.type,
         (SELECT count(*) FROM rows_ r WHERE r.document_id = cur.id AND r.status <> 'acknowledged')
         + coalesce((SELECT n FROM not_sent ns WHERE ns.document_id = cur.id), 0) AS owed
  FROM cur
),
safety_owed AS (
  SELECT cur.id, count(*) AS owed FROM cur
  JOIN members m ON m.project_id = cur.project_id
  WHERE cur.type = 'safety'
    AND NOT EXISTS (SELECT 1 FROM rows_ r WHERE r.document_id = cur.id AND r.user_id = m.user_id AND r.status = 'acknowledged')
  GROUP BY cur.id
),
safety_rows_not_members AS (
  -- people with an unsigned row who are no longer portal members (dashboard
  -- staff, removed members): counted today, still counted after
  SELECT r.document_id AS id, count(*) AS owed FROM rows_ r
  JOIN cur ON cur.id = r.document_id AND cur.type = 'safety'
  WHERE r.status <> 'acknowledged'
    AND NOT EXISTS (SELECT 1 FROM members m WHERE m.project_id = cur.project_id AND m.user_id = r.user_id)
  GROUP BY r.document_id
),
after_doc AS (
  SELECT b.id, b.project_id, b.type,
         CASE WHEN b.type = 'safety'
                   AND (coalesce(so.owed, 0) + coalesce(snm.owed, 0) > 0
                        OR EXISTS (SELECT 1 FROM members m WHERE m.project_id = b.project_id))
              THEN coalesce(so.owed, 0) + coalesce(snm.owed, 0)
              ELSE b.owed END AS owed
  FROM before_doc b
  LEFT JOIN safety_owed so ON so.id = b.id
  LEFT JOIN safety_rows_not_members snm ON snm.id = b.id
)

-- 1. Per project: total outstanding today vs after, and the safety part.
SELECT p.name AS project, c.name AS company,
       (SELECT count(*) FROM members m WHERE m.project_id = p.id) AS portal_members,
       count(b.id) FILTER (WHERE b.type = 'safety') AS current_safety_docs,
       coalesce(sum(b.owed), 0) AS outstanding_today,
       coalesce(sum(a.owed), 0) AS outstanding_after,
       coalesce(sum(a.owed), 0) - coalesce(sum(b.owed), 0) AS jump,
       coalesce(sum(b.owed) FILTER (WHERE b.type = 'safety'), 0) AS safety_today,
       coalesce(sum(a.owed) FILTER (WHERE a.type = 'safety'), 0) AS safety_after
FROM projects p
JOIN companies c ON c.id = p.company_id
LEFT JOIN before_doc b ON b.project_id = p.id
LEFT JOIN after_doc a ON a.id = b.id
GROUP BY p.id, p.name, c.name
HAVING count(b.id) > 0
ORDER BY jump DESC, c.name, p.name;

-- 2. Per current safety document: who owes today vs after, so each jump
--    can be checked against the project's portal member count.
SELECT p.name AS project, d.name AS document, d.id,
       (SELECT count(DISTINCT user_id) FROM project_members pm WHERE pm.project_id = d.project_id AND pm.person_id IS NOT NULL AND pm.user_id IS NOT NULL) AS portal_members,
       (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = d.id AND dd.status = 'acknowledged') AS signed,
       (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = d.id AND dd.status <> 'acknowledged') AS owed_today,
       (SELECT count(*) FROM (
          SELECT user_id FROM project_members WHERE project_id = d.project_id AND person_id IS NOT NULL AND user_id IS NOT NULL
          UNION
          SELECT user_id FROM document_distributions WHERE document_id = d.id
        ) u WHERE NOT EXISTS (SELECT 1 FROM document_distributions dd WHERE dd.document_id = d.id AND dd.user_id = u.user_id AND dd.status = 'acknowledged')
       ) AS owed_after
FROM documents d JOIN projects p ON p.id = d.project_id
WHERE d.type = 'safety' AND d.status = 'current' AND d.requires_acknowledgment
ORDER BY p.name, d.created_at DESC;

-- 3. Current safety documents NOT requiring sign-off (should be 0 since
--    option 2, 2026-10-21; they stay uncounted either way).
SELECT count(*) AS current_safety_without_signoff
FROM documents WHERE type = 'safety' AND status = 'current' AND NOT requires_acknowledgment;
