-- Opened but never signed: what the proposed change would add to the counts.
-- READ-ONLY. Every statement is a SELECT. Safe to run on prod. (2026-10-21)
--
-- Today close-out, the project alert count and compliance count a sign-off as
-- outstanding only while its row is 'pending' (never opened). A recipient who
-- OPENED a document that requires sign-off and never signed ('viewed') counts
-- as done. Dean (2026-10-21): only a signature closes it. This shows how many
-- rows that would add, per project, on CURRENT revisions only.

-- 1. Per project: outstanding today vs after the change.
SELECT c.name AS company, p.name AS project, p.status AS project_status,
  count(*) FILTER (WHERE dd.status = 'pending') AS counted_today,
  count(*) FILTER (WHERE dd.status = 'viewed' AND d.requires_acknowledgment) AS opened_not_signed,
  count(*) FILTER (WHERE dd.status = 'pending' AND NOT d.requires_acknowledgment) AS unopened_no_signoff_needed
FROM document_distributions dd
JOIN documents d ON d.id = dd.document_id AND d.status = 'current'
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
GROUP BY 1, 2, 3
HAVING count(*) FILTER (WHERE dd.status IN ('pending', 'viewed')) > 0
ORDER BY 1, 2;

-- 2. Projects already CLOSED OUT that have an opened-but-unsigned document
--    (close-out was signed off while a signature was missing).
SELECT c.name AS company, p.name AS project, d.name AS document,
  coalesce('Rev ' || d.revision, 'v' || d.version) AS rev,
  count(*) AS opened_not_signed
FROM document_distributions dd
JOIN documents d ON d.id = dd.document_id AND d.status = 'current' AND d.requires_acknowledgment
JOIN projects p ON p.id = d.project_id AND p.status = 'complete'
JOIN companies c ON c.id = p.company_id
WHERE dd.status = 'viewed'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3;
