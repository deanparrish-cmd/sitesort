-- Read-only (SELECT only). Replays GET /api/portal/shared step by step for
-- Dean's logins on "test 1 site sort", for Test Drawing 2. (2026-10-16)
-- Mirrors artifacts/api-server/src: middlewares/portal.ts (portalMember),
-- routes/portal.ts resolveViewer (line ~177), visibleShareMap (~215),
-- and the gatedDocs query in /portal/shared (~1221).

-- T1. Which logins exist for Dean, and which membership rows resolveViewer can
--     pick for each (it matches project + user_id + person_id NOT NULL, LIMIT 1,
--     no ORDER BY). More than one row per login = the pick is arbitrary.
SELECT u.email AS login, u.id AS user_id, u.portal_only,
       pm.id AS member_row, pm.person_id AS viewer_card, pe.name AS card,
       sc.company_name AS card_company, sc.trades AS card_trades, pm.role
FROM users u
LEFT JOIN project_members pm ON pm.user_id = u.id
  AND pm.project_id = '09b3eb48-5c9f-4687-b5f6-954b27f708bd' AND pm.person_id IS NOT NULL
LEFT JOIN people pe ON pe.id = pm.person_id
LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
WHERE u.email ILIKE 'dean.parrish@%'
ORDER BY u.email;

-- T2. Every rule on Test Drawing 2, and whether it matches each candidate
--     viewer row from T1 (same test as visibleShareMap). "all" matches anyone.
SELECT v.login, v.viewer_card, s.audience_type, s.trade, s.person_id AS rule_card,
       s.project_id = '09b3eb48-5c9f-4687-b5f6-954b27f708bd' AS rule_on_this_project,
       ( s.audience_type = 'all'
         OR (s.audience_type = 'person' AND s.person_id = v.viewer_card)
         OR (s.audience_type = 'trade' AND (s.trade = ANY(v.trades)
             OR (cardinality(v.trades) = 0 AND s.trade = 'Site Staff'))) ) AS matches
FROM (
  SELECT u.email AS login, pm.person_id AS viewer_card, coalesce(sc.trades, '{}') AS trades
  FROM users u
  JOIN project_members pm ON pm.user_id = u.id
    AND pm.project_id = '09b3eb48-5c9f-4687-b5f6-954b27f708bd' AND pm.person_id IS NOT NULL
  LEFT JOIN people pe ON pe.id = pm.person_id
  LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
  WHERE u.email ILIKE 'dean.parrish@%'
) v
CROSS JOIN portal_shares s
WHERE s.item_type = 'document' AND s.item_id = '16be9fca-9db5-4870-820f-d77f773c1b6e'
ORDER BY v.login, s.created_at;

-- T3. The document row the list query filters on (project + status).
SELECT id, name, type, status, version, project_id,
       project_id = '09b3eb48-5c9f-4687-b5f6-954b27f708bd' AS on_this_project,
       status IN ('current', 'superseded') AS passes_status_filter
FROM documents WHERE id = '16be9fca-9db5-4870-820f-d77f773c1b6e';

-- T4. What Dean's phone actually asked for: every portal view logged since
--     the share (login, project, time, browser). Compare with Annabelle's.
SELECT u.email AS login, a.section, a.project_id, p.name AS project, a.created_at,
       left(a.user_agent, 70) AS browser
FROM activity_log a
JOIN users u ON u.id = a.user_id
LEFT JOIN projects p ON p.id = a.project_id
WHERE (u.email ILIKE 'dean.parrish@%' OR u.name ILIKE '%annabelle%')
  AND a.section IN ('shared', 'drawings')
  AND a.created_at >= '2026-10-15 18:00'
ORDER BY a.created_at DESC LIMIT 30;
