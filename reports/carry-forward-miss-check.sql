-- #148 carry-forward did not ask on prod (Dean, 2026-10-21). READ-ONLY.
-- One SELECT. Replace the name in the first line with the document's exact
-- name. Shows every revision with that name: when it was uploaded, what it
-- replaced, its portal share rules and who has a copy. Names no people.
--
-- What to read:
--   v1 share_rules = 1 (person)  -> the share is a rule the carry-forward code reads.
--   v2 share_rules = 0, v2 previous_id = v1 id -> the upload took the
--   same-name path and nothing carried (by design without a confirmed list).
--   v2 uploaded vs the #148 build (2026-10-21 15:23:25 UTC).
WITH target AS (SELECT 'PUT THE DOCUMENT NAME HERE'::text AS name)
SELECT d.version, d.status, d.type, d.created_at AS uploaded_utc,
  d.created_at > '2026-10-21 15:23:25.942+00' AS after_148_publish,
  d.id, d.previous_version_id AS previous_id,
  (SELECT count(*) FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id) AS share_rules,
  (SELECT string_agg(s.audience_type || coalesce(':' || s.trade, ''), ', ') FROM portal_shares s WHERE s.item_type = 'document' AND s.item_id = d.id) AS rule_kinds,
  (SELECT count(*) FROM document_distributions dd WHERE dd.document_id = d.id) AS people_with_a_copy,
  (SELECT count(*) FROM notifications n WHERE n.related_entity_id = d.id) AS notifications
FROM documents d, target t
WHERE d.name = t.name
ORDER BY d.created_at;
