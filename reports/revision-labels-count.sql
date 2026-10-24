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
