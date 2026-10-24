-- READ-ONLY. Changes nothing. Run against the PRODUCTION database, one query
-- at a time (Replit SQL console). 2026-10-24.
-- Query 1 of amy-annabelle-superseded-check.sql found Amy by an exact email
-- match only. These find her by what actually lets her into the portal.

-- A) Who is actually signed in to the portal on "test 1 site sort": every
--    portal session there, newest first, with the login's email exactly as
--    stored (brackets show stray spaces) and the row that lets them in.
SELECT '[' || u.email || ']' AS email_as_stored, u.name, u.id AS user_id, u.portal_only,
       s.created_at AS session_started, s.last_active_at, s.revoked_at,
       pm.id AS member_row, pm.person_id AS card, pe.name AS card_name,
       COALESCE(sc.company_name, '(in-house)') AS firm, COALESCE(sc.trades, '{}') AS firm_trades,
       pm.can_log_issues, pm.can_update_plant_materials, pm.can_edit_daily_report, pm.is_project_manager
FROM portal_sessions s
JOIN projects p ON p.id = s.project_id
JOIN users u ON u.id = s.user_id
LEFT JOIN project_members pm ON pm.project_id = s.project_id AND pm.user_id = s.user_id
LEFT JOIN people pe ON pe.id = pm.person_id
LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
WHERE lower(p.name) = 'test 1 site sort'
ORDER BY s.last_active_at DESC;

-- B) Everything that exists for anyone called Amy: accounts, every project
--    row of those accounts, every card named Amy (with its own login link),
--    whether or not they join up.
SELECT 'account' AS kind, '[' || u.email || ']' AS email_as_stored, u.name, u.id AS user_id, u.portal_only, u.role,
       NULL::text AS project, NULL::text AS member_row, NULL::text AS card, NULL::text AS card_login, NULL::text AS firm, NULL::timestamp AS added_or_created
FROM users u WHERE u.name ILIKE '%amy%' OR u.email ILIKE '%amy%'
UNION ALL
SELECT 'project row', '[' || u.email || ']', u.name, u.id, u.portal_only, pm.role,
       p.name, pm.id, pm.person_id, pe.user_id, COALESCE(sc.company_name, '(in-house)'), pm.added_at
FROM project_members pm JOIN users u ON u.id = pm.user_id JOIN projects p ON p.id = pm.project_id
LEFT JOIN people pe ON pe.id = pm.person_id LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
WHERE u.name ILIKE '%amy%' OR u.email ILIKE '%amy%'
UNION ALL
SELECT 'card', '[' || pe.email || ']', pe.name, pe.user_id, NULL, CASE WHEN pe.archived_at IS NOT NULL THEN 'archived' END,
       (SELECT string_agg(p.name || ' (row ' || pm.id || ', login ' || COALESCE(pm.user_id, 'none') || ')', '; ') FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.person_id = pe.id),
       NULL, pe.id, pe.user_id, COALESCE(sc.company_name, '(in-house)'), pe.created_at
FROM people pe LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
WHERE pe.name ILIKE '%amy%' OR pe.email ILIKE '%amy%'
ORDER BY kind, name;

-- C) Query 2 for "test 1 site sort", for EVERY portal login on the project
--    (no email filter): each drawing, each share rule, who it reaches today
--    and who it doesn't. A drawing with no rule shows one row, audience NULL.
WITH proj AS (SELECT id FROM projects WHERE lower(name) = 'test 1 site sort'),
cards AS (
  SELECT pm.project_id, COALESCE(pm.user_id, pe.user_id) AS login, pm.person_id,
         pm.user_id IS NOT NULL AS holds_login, COALESCE(sc.trades, '{}'::text[]) AS trades
  FROM project_members pm JOIN people pe ON pe.id = pm.person_id
  LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
  WHERE pm.project_id IN (SELECT id FROM proj)
    AND (pm.user_id IS NOT NULL OR (pe.user_id IS NOT NULL AND pe.archived_at IS NULL))
), logins AS (
  SELECT DISTINCT c.project_id, c.login, u.email FROM cards c JOIN users u ON u.id = c.login WHERE c.holds_login
), reach AS (
  SELECT d.id AS doc_id, ps.id AS share_id, l.email,
         COALESCE((SELECT bool_or(
           ps.audience_type = 'all'
           OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
           OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff'))))
           FROM cards c WHERE c.project_id = d.project_id AND c.login = l.login), false) AS reaches
  FROM documents d JOIN logins l ON l.project_id = d.project_id
  JOIN portal_shares ps ON ps.item_type = 'document' AND ps.item_id = d.id
  WHERE d.type = 'drawing'
)
SELECT d.name AS drawing, d.revision, d.version, d.status, d.id AS doc_id,
       ps.audience_type AS audience, ps.trade, sp.name AS shared_to_card, ps.created_at AS rule_created,
       (SELECT string_agg(r.email, ', ' ORDER BY r.email) FROM reach r WHERE r.share_id = ps.id AND r.reaches) AS reaches,
       (SELECT string_agg(r.email, ', ' ORDER BY r.email) FROM reach r WHERE r.share_id = ps.id AND NOT r.reaches) AS does_not_reach
FROM documents d
JOIN proj ON proj.id = d.project_id
LEFT JOIN portal_shares ps ON ps.item_type = 'document' AND ps.item_id = d.id
LEFT JOIN people sp ON sp.id = ps.person_id
WHERE d.type = 'drawing'
ORDER BY d.name, d.version, ps.created_at;

-- A2) Query A for Amy's portal login only (amy.parrish85@icloud.com).
SELECT '[' || u.email || ']' AS email_as_stored, u.name, u.id AS user_id, u.portal_only,
       s.created_at AS session_started, s.last_active_at, s.revoked_at,
       pm.id AS member_row, pm.person_id AS card, pe.name AS card_name, '[' || pe.email || ']' AS card_email,
       pe.user_id AS card_login,
       COALESCE(sc.company_name, '(in-house)') AS firm, COALESCE(sc.trades, '{}') AS firm_trades,
       pm.can_log_issues, pm.can_update_plant_materials, pm.can_edit_daily_report, pm.is_project_manager
FROM portal_sessions s
JOIN projects p ON p.id = s.project_id
JOIN users u ON u.id = s.user_id
LEFT JOIN project_members pm ON pm.project_id = s.project_id AND pm.user_id = s.user_id
LEFT JOIN people pe ON pe.id = pm.person_id
LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
WHERE lower(p.name) = 'test 1 site sort' AND lower(trim(u.email)) = 'amy.parrish85@icloud.com'
ORDER BY s.last_active_at DESC;

-- C2) Query C for Amy's portal login only: every drawing on test 1 site sort,
--     each share rule, and whether it reaches her today. A drawing with no
--     rule shows one row with audience NULL (and reaches_amy NULL).
WITH proj AS (SELECT id FROM projects WHERE lower(name) = 'test 1 site sort'),
amy AS (SELECT id FROM users WHERE lower(trim(email)) = 'amy.parrish85@icloud.com'),
cards AS (
  SELECT pm.project_id, COALESCE(pm.user_id, pe.user_id) AS login, pm.person_id,
         pm.user_id IS NOT NULL AS holds_login, COALESCE(sc.trades, '{}'::text[]) AS trades
  FROM project_members pm JOIN people pe ON pe.id = pm.person_id
  LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
  WHERE pm.project_id IN (SELECT id FROM proj)
    AND (pm.user_id IS NOT NULL OR (pe.user_id IS NOT NULL AND pe.archived_at IS NULL))
    AND COALESCE(pm.user_id, pe.user_id) IN (SELECT id FROM amy)
)
SELECT d.name AS drawing, d.revision, d.version, d.status, d.id AS doc_id,
       ps.audience_type AS audience, ps.trade, sp.name AS shared_to_card, ps.person_id AS shared_to_card_id,
       ps.created_at AS rule_created,
       CASE WHEN ps.id IS NULL THEN NULL
            WHEN NOT EXISTS (SELECT 1 FROM cards c WHERE c.project_id = d.project_id AND c.holds_login) THEN false
            ELSE COALESCE((SELECT bool_or(
              ps.audience_type = 'all'
              OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
              OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff'))))
              FROM cards c WHERE c.project_id = d.project_id), false)
       END AS reaches_amy,
       (SELECT string_agg(c.person_id, ', ') FROM cards c WHERE c.project_id = d.project_id) AS amys_cards_here
FROM documents d
JOIN proj ON proj.id = d.project_id
LEFT JOIN portal_shares ps ON ps.item_type = 'document' AND ps.item_id = d.id
LEFT JOIN people sp ON sp.id = ps.person_id
WHERE d.type = 'drawing'
ORDER BY d.name, d.version, ps.created_at;

-- D) Reach across ALL document types on test 1 site sort, for Amy's portal
--    login and Annabelle: every document (every version), every share rule,
--    whether each rule reaches each of them today, and whether each of them
--    can see the document at all (any rule, or a current safety document).
WITH proj AS (SELECT id FROM projects WHERE lower(name) = 'test 1 site sort'),
who AS (
  SELECT id AS user_id, CASE WHEN lower(trim(email)) = 'annabelleparrish@icloud.com' THEN 'annabelle' ELSE 'amy' END AS tag
  FROM users WHERE lower(trim(email)) IN ('amy.parrish85@icloud.com', 'annabelleparrish@icloud.com')
),
cards AS (
  SELECT pm.project_id, w.tag, pm.person_id, pm.user_id IS NOT NULL AS holds_login, COALESCE(sc.trades, '{}'::text[]) AS trades
  FROM project_members pm JOIN people pe ON pe.id = pm.person_id
  LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
  JOIN who w ON w.user_id = COALESCE(pm.user_id, pe.user_id)
  WHERE pm.project_id IN (SELECT id FROM proj)
    AND (pm.user_id IS NOT NULL OR (pe.user_id IS NOT NULL AND pe.archived_at IS NULL))
),
rows AS (
  SELECT d.id AS doc_id, d.name, d.type, d.version, d.revision, d.status, d.created_at,
         ps.id AS share_id, ps.audience_type AS audience, ps.trade, sp.name AS shared_to_card, ps.person_id AS shared_to_card_id, ps.created_at AS rule_created,
         (SELECT bool_or(ps.audience_type = 'all'
            OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
            OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff'))))
          FROM cards c WHERE c.tag = 'annabelle' AND EXISTS (SELECT 1 FROM cards h WHERE h.tag = 'annabelle' AND h.holds_login)) AS rule_reaches_annabelle,
         (SELECT bool_or(ps.audience_type = 'all'
            OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
            OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff'))))
          FROM cards c WHERE c.tag = 'amy' AND EXISTS (SELECT 1 FROM cards h WHERE h.tag = 'amy' AND h.holds_login)) AS rule_reaches_amy
  FROM documents d
  JOIN proj ON proj.id = d.project_id
  LEFT JOIN portal_shares ps ON ps.item_type = 'document' AND ps.item_id = d.id
  LEFT JOIN people sp ON sp.id = ps.person_id
)
SELECT name, type, version, revision, status, doc_id, audience, trade, shared_to_card, shared_to_card_id, rule_created,
       rule_reaches_annabelle, rule_reaches_amy,
       (status IN ('current', 'superseded') AND (bool_or(COALESCE(rule_reaches_annabelle, false)) OVER w OR (type = 'safety' AND status = 'current'))) AS annabelle_sees_it,
       (status IN ('current', 'superseded') AND (bool_or(COALESCE(rule_reaches_amy, false)) OVER w OR (type = 'safety' AND status = 'current'))) AS amy_sees_it
FROM rows
WINDOW w AS (PARTITION BY doc_id)
ORDER BY name, version, rule_created;

-- E) Was Amy (either account) or Annabelle EVER sent any version of Cosmica?
--    Share rules leave no history when deleted, so this reads every trace a
--    share or an open leaves per person: distribution rows, bell notifications,
--    sign-off audit rows, and their own activity on the item.
WITH proj AS (SELECT id FROM projects WHERE lower(name) = 'test 1 site sort'),
docs AS (SELECT d.id, d.name, d.version, d.status, d.created_at FROM documents d JOIN proj ON proj.id = d.project_id WHERE d.name ILIKE '%cosmica%'),
who AS (SELECT id AS user_id, email FROM users WHERE lower(trim(email)) IN ('amy.parrish85@icloud.com', 'amy-parrish@hotmail.co.uk', 'annabelleparrish@icloud.com'))
SELECT 'distribution' AS trace, d.name, d.version, d.status, w.email, dd.distributed_at AS at, dd.status AS detail
FROM document_distributions dd JOIN docs d ON d.id = dd.document_id JOIN who w ON w.user_id = dd.user_id
UNION ALL
SELECT 'notification', d.name, d.version, d.status, w.email, n.created_at, n.title
FROM notifications n JOIN docs d ON d.id = n.related_entity_id JOIN who w ON w.user_id = n.user_id
UNION ALL
SELECT 'sign-off audit', d.name, d.version, d.status, w.email, a.created_at, a.action
FROM acknowledgment_audit_log a JOIN docs d ON d.id = a.document_id JOIN who w ON w.user_id = a.user_id
UNION ALL
SELECT 'activity', d.name, d.version, d.status, w.email, al.created_at, al.section || ' ' || al.action
FROM activity_log al JOIN docs d ON d.id = al.item_id JOIN who w ON w.user_id = al.user_id
UNION ALL
SELECT 'document (no traces above means nobody listed was ever sent it)', d.name, d.version, d.status, NULL, d.created_at, d.id
FROM docs d
ORDER BY name, version, at;
