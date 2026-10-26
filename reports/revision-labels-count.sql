-- READ-ONLY (Dean, 2026-10-24). Revision labels today, per document type.
-- documents.revision = the free-text label ("Rev ..."); documents.version =
-- the automatic 1, 2, 3 sequence shown as "v1, v2" when there is no label.
-- Changes nothing.

-- 1. Per type: how many documents, how many carry a typed/auto label, how
--    many are revisions of something (have replaced an earlier one).
SELECT type,
       count(*)                                              AS documents,
       count(*) FILTER (WHERE revision IS NOT NULL)          AS with_label,
       count(*) FILTER (WHERE previous_version_id IS NOT NULL) AS are_revisions,
       count(*) FILTER (WHERE status = 'current')            AS current,
       count(*) FILTER (WHERE status = 'superseded')         AS superseded,
       max(version)                                          AS highest_version
FROM documents
GROUP BY type
ORDER BY documents DESC;

-- 2. Labels already set on anything that isn't a drawing (only possible by
--    API or an old path today), to see what people have typed.
SELECT type, revision, count(*) FROM documents
WHERE type <> 'drawing' AND revision IS NOT NULL
GROUP BY type, revision ORDER BY type, count(*) DESC;

-- 3. (added 2026-10-26) Labels already repeated within one document's
--    revision chain, which the new warning would flag. Chains follow
--    previous_version_id back to the first revision.
WITH RECURSIVE chain AS (
  SELECT id, id AS root FROM documents WHERE previous_version_id IS NULL
  UNION ALL
  SELECT d.id, c.root FROM documents d JOIN chain c ON d.previous_version_id = c.id
)
SELECT count(*) AS repeated_label_groups,
       coalesce(sum(n), 0) AS documents_involved
FROM (
  SELECT c.root, d.revision, count(*) AS n
  FROM chain c JOIN documents d ON d.id = c.id
  WHERE d.revision IS NOT NULL
  GROUP BY c.root, d.revision HAVING count(*) > 1
) x;
