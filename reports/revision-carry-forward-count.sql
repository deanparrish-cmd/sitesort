-- Revision carry-forward: how many CURRENT revisions are stranded today?
-- READ-ONLY. Every statement is a SELECT. Safe to run on prod. (2026-10-21)
--
-- "Stranded" = a current, non-safety document with NO portal share rules,
-- whose previous revision HAD rules. These reach nobody on the portal, while
-- the people who had the old revision keep working from it. #148 stops new
-- ones; this counts the ones already there. No backfill until Dean has seen
-- the numbers.
--
-- Safety documents are left out: they are visible to every portal member
-- without share rules.

-- 1. The number. One row.
WITH cur AS (
  SELECT d.id, d.previous_version_id
  FROM documents d
  WHERE d.status = 'current' AND d.type <> 'safety' AND d.previous_version_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id)
)
SELECT
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = cur.previous_version_id)) AS stranded_revisions,
  count(DISTINCT p.company_id) FILTER (WHERE EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = cur.previous_version_id)) AS companies,
  count(DISTINCT p.id) FILTER (WHERE EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = cur.previous_version_id)) AS projects
FROM cur
JOIN documents d ON d.id = cur.id
JOIN projects p ON p.id = d.project_id;

-- 2. Each stranded revision: what it is, what the old revision was shared
--    with, and how many people had the old one (distribution rows) and
--    signed it off. Nothing here names a person.
SELECT
  c.name AS company,
  p.name AS project,
  d.name AS document,
  d.type,
  coalesce('Rev ' || d.revision, 'v' || d.version) AS current_rev,
  d.created_at::date AS uploaded,
  d.requires_acknowledgment AS needs_signoff,
  coalesce('Rev ' || prev.revision, 'v' || prev.version) AS previous_rev,
  (SELECT string_agg(s.audience_type || coalesce(':' || s.trade, ''), ', ' ORDER BY s.audience_type)
     FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = prev.id) AS previous_rules,
  (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = prev.id) AS had_previous,
  (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = prev.id AND dd.status = 'acknowledged') AS signed_previous,
  (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = d.id) AS rows_on_current,
  d.id AS document_id,
  prev.id AS previous_id
FROM documents d
JOIN documents prev ON prev.id = d.previous_version_id
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
WHERE d.status = 'current' AND d.type <> 'safety'
  AND NOT EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id)
  AND EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = prev.id)
ORDER BY c.name, p.name, d.name;

-- 3. Deeper gaps: current revisions with no rules whose PREVIOUS revision
--    had none either, but an older one did (e.g. Rev A shared, Rev B and
--    Rev C never). Query 1 does not count these. Shows the nearest shared
--    ancestor and how many revisions back it is.
WITH RECURSIVE chain AS (
  SELECT d.id AS current_id, d.previous_version_id AS ancestor_id, 1 AS back
  FROM documents d
  WHERE d.status = 'current' AND d.type <> 'safety' AND d.previous_version_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id)
  UNION ALL
  SELECT ch.current_id, a.previous_version_id, ch.back + 1
  FROM chain ch JOIN documents a ON a.id = ch.ancestor_id
  WHERE a.previous_version_id IS NOT NULL AND ch.back < 50
    AND NOT EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = a.id)
),
nearest AS (
  SELECT DISTINCT ON (ch.current_id) ch.current_id, ch.ancestor_id, ch.back
  FROM chain ch
  WHERE EXISTS (SELECT 1 FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = ch.ancestor_id)
  ORDER BY ch.current_id, ch.back
)
SELECT c.name AS company, p.name AS project, d.name AS document,
  coalesce('Rev ' || d.revision, 'v' || d.version) AS current_rev,
  coalesce('Rev ' || a.revision, 'v' || a.version) AS last_shared_rev,
  n.back AS revisions_back,
  d.id AS document_id
FROM nearest n
JOIN documents d ON d.id = n.current_id
JOIN documents a ON a.id = n.ancestor_id
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
WHERE n.back > 1
ORDER BY c.name, p.name, d.name;
