-- Read-only dry run of the #140 notifications backfill. Same rules, same order
-- as ensure-schema.ts; the first rule that places a row wins. Changes nothing.
WITH placed AS (
  SELECT n.id, n.user_id, n.type, n.related_entity_type AS rt, n.related_entity_id AS rid, n.title, n.created_at,
    CASE
      WHEN pm.company_id IS NOT NULL THEN '1 metadata.projectId'
      WHEN pr.company_id IS NOT NULL THEN '2 project'
      WHEN doc.company_id IS NOT NULL THEN '3 document'
      WHEN ph.company_id  IS NOT NULL THEN '3 photo / site issue'
      WHEN pe.company_id  IS NOT NULL THEN '3 permit'
      WHEN ci.company_id  IS NOT NULL THEN '3 check-in'
      WHEN dr.company_id  IS NOT NULL THEN '3 daily report'
      WHEN pl.company_id  IS NOT NULL THEN '3 plant item'
      WHEN co.id          IS NOT NULL THEN '4 company'
      WHEN dm.company_id  IS NOT NULL THEN '5 direct message'
      WHEN tm.id          IS NOT NULL THEN '6 "Added to" by company name'
      WHEN one.company_id IS NOT NULL THEN '7 user in only one company'
      ELSE 'NOT PLACED (hidden)'
    END AS source
  FROM notifications n
  LEFT JOIN projects pm ON pm.id = n.metadata->>'projectId'
  LEFT JOIN projects pr ON n.related_entity_type = 'project' AND pr.id = n.related_entity_id
  LEFT JOIN LATERAL (SELECT p.company_id FROM documents x JOIN projects p ON p.id = x.project_id WHERE n.related_entity_type = 'document' AND x.id = n.related_entity_id) doc ON true
  LEFT JOIN LATERAL (SELECT p.company_id FROM photos x JOIN projects p ON p.id = x.project_id WHERE n.related_entity_type = 'photo' AND x.id = n.related_entity_id) ph ON true
  LEFT JOIN LATERAL (SELECT p.company_id FROM permits x JOIN projects p ON p.id = x.project_id WHERE n.related_entity_type = 'permit' AND x.id = n.related_entity_id) pe ON true
  LEFT JOIN LATERAL (SELECT p.company_id FROM site_checkins x JOIN projects p ON p.id = x.project_id WHERE n.related_entity_type = 'site_checkin' AND x.id = n.related_entity_id) ci ON true
  LEFT JOIN LATERAL (SELECT p.company_id FROM daily_reports x JOIN projects p ON p.id = x.project_id WHERE n.related_entity_type = 'daily_report' AND x.id = n.related_entity_id) dr ON true
  LEFT JOIN LATERAL (SELECT p.company_id FROM plant_items x JOIN projects p ON p.id = x.project_id WHERE n.related_entity_type = 'plant_item' AND x.id = n.related_entity_id) pl ON true
  LEFT JOIN companies co ON n.related_entity_type = 'company' AND co.id = n.related_entity_id
  LEFT JOIN LATERAL (SELECT m.company_id FROM messages m WHERE n.type = 'new_message' AND n.related_entity_type = 'user' AND m.sender_id = n.related_entity_id AND m.recipient_id = n.user_id AND abs(extract(epoch FROM (m.created_at - n.created_at))) < 10 LIMIT 1) dm ON true
  LEFT JOIN LATERAL (SELECT c.id FROM companies c JOIN company_members cm ON cm.company_id = c.id WHERE n.type = 'team' AND n.title = 'Added to ' || c.name AND cm.user_id = n.user_id LIMIT 1) tm ON true
  LEFT JOIN LATERAL (SELECT min(company_id) AS company_id FROM company_members WHERE user_id = n.user_id HAVING count(*) = 1) one ON true
)
-- Part 1: totals by source. Part 2 (below the UNION) lists every row that would be hidden.
SELECT 'SUMMARY' AS part, source, count(*)::text AS rows, NULL AS type, NULL AS related, NULL AS user_email, NULL AS user_companies, NULL AS title, NULL AS created_at
FROM placed GROUP BY source
UNION ALL
SELECT 'HIDDEN', source, '1', p.type, coalesce(p.rt, '-') || ':' || coalesce(p.rid, '-'), u.email,
       (SELECT count(*)::text FROM company_members cm WHERE cm.user_id = p.user_id), p.title, p.created_at::text
FROM placed p LEFT JOIN users u ON u.id = p.user_id
WHERE p.source = 'NOT PLACED (hidden)'
ORDER BY part DESC, source, created_at;
