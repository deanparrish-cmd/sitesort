-- READ-ONLY. Changes nothing. Run against the PRODUCTION database, one query
-- at a time (Replit SQL console). 2026-10-24.
-- Question: Amy sees no superseded drawings, Annabelle does, same project.
-- Amy = amy.parrish85@icloud.com, Annabelle = annabelleparrish@icloud.com.
--
-- Portal visibility of a drawing (routes/portal.ts visibleIds/visibleShareMap)
-- is ONLY the share rules on that exact document row (portal_shares), matched
-- against the login's cards: 'all', 'person' = one of their cards, 'trade' =
-- one of their firm's trades (or 'Site Staff' for an in-house card). Status
-- current or superseded both count. Signatures and distribution rows play no
-- part. These queries reproduce that rule in SQL.

-- 1) Who they are, every project row they hold, card, firm, trades, permissions.
SELECT u.email, u.name, u.role AS account_role, u.portal_only, u.platform_admin,
       p.name AS project, pm.project_id, pm.id AS member_row, pm.role AS member_role,
       pm.can_log_issues, pm.can_update_plant_materials, pm.can_edit_daily_report,
       pm.is_project_manager, (p.site_manager_id = u.id) AS is_site_manager,
       pm.person_id AS card, pe.name AS card_name,
       COALESCE(s.company_name, '(in-house)') AS firm, COALESCE(s.trades, '{}') AS firm_trades,
       pe.archived_at AS card_archived, pm.added_at,
       (SELECT string_agg(c.name || ': ' || cm.role, ', ') FROM company_members cm JOIN companies c ON c.id = cm.company_id WHERE cm.user_id = u.id) AS company_roles
FROM users u
JOIN project_members pm ON pm.user_id = u.id
JOIN projects p ON p.id = pm.project_id
LEFT JOIN people pe ON pe.id = pm.person_id
LEFT JOIN subcontractors s ON s.id = pe.subcontractor_id
WHERE lower(u.email) IN ('amy.parrish85@icloud.com', 'annabelleparrish@icloud.com')
ORDER BY p.name, u.email;

-- 2) Every drawing (current and superseded) on the projects they BOTH hold a
--    row on, each share rule on it, and whether that rule reaches each of them
--    today. A drawing with no rule at all shows one row with audience NULL.
WITH who AS (
  SELECT id AS user_id, CASE WHEN lower(email) = 'annabelleparrish@icloud.com' THEN 'annabelle' ELSE 'amy' END AS tag
  FROM users WHERE lower(email) IN ('amy.parrish85@icloud.com', 'annabelleparrish@icloud.com')
), cards AS (
  SELECT pm.project_id, COALESCE(pm.user_id, pe.user_id) AS login, pm.person_id,
         pm.user_id IS NOT NULL AS holds_login, COALESCE(s.trades, '{}'::text[]) AS trades
  FROM project_members pm JOIN people pe ON pe.id = pm.person_id
  LEFT JOIN subcontractors s ON s.id = pe.subcontractor_id
  WHERE pm.user_id IS NOT NULL OR (pe.user_id IS NOT NULL AND pe.archived_at IS NULL)
), both_projects AS (
  SELECT project_id FROM cards c JOIN who w ON w.user_id = c.login WHERE c.holds_login
  GROUP BY project_id HAVING count(DISTINCT w.tag) = 2
)
SELECT p.name AS project, d.name AS drawing, d.revision, d.version, d.status, d.id AS doc_id,
       d.created_at AS uploaded, ps.audience_type AS audience, ps.trade,
       sp.name AS shared_to_card, ps.created_at AS rule_created, su.name AS rule_by,
       (SELECT bool_or(
          ps.audience_type = 'all'
          OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
          OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff'))))
        FROM cards c JOIN who w ON w.user_id = c.login AND w.tag = 'annabelle' WHERE c.project_id = d.project_id) AS reaches_annabelle,
       (SELECT bool_or(
          ps.audience_type = 'all'
          OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
          OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff'))))
        FROM cards c JOIN who w ON w.user_id = c.login AND w.tag = 'amy' WHERE c.project_id = d.project_id) AS reaches_amy
FROM documents d
JOIN both_projects bp ON bp.project_id = d.project_id
JOIN projects p ON p.id = d.project_id
LEFT JOIN portal_shares ps ON ps.item_type = 'document' AND ps.item_id = d.id
LEFT JOIN people sp ON sp.id = ps.person_id
LEFT JOIN users su ON su.id = ps.shared_by_user_id
WHERE d.type = 'drawing'
ORDER BY p.name, d.name, d.version, ps.created_at;

-- 3) "Was she ever a recipient?" Share rules leave no history when deleted,
--    so the trace is the per-person record: a distribution row is written
--    when a share reached an accepted member, or when they first opened it;
--    the audit row when they signed. Every such row for either of them on
--    the drawings of query 2.
WITH who AS (
  SELECT id AS user_id, email FROM users WHERE lower(email) IN ('amy.parrish85@icloud.com', 'annabelleparrish@icloud.com')
)
SELECT p.name AS project, d.name AS drawing, d.revision, d.status, w.email,
       dd.status AS dist_status, dd.distributed_at, dd.viewed_at, dd.acknowledged_at, dd.signed_off_with_pin,
       (SELECT count(*) FROM acknowledgment_audit_log a WHERE a.document_id = d.id AND a.user_id = w.user_id) AS audit_rows
FROM document_distributions dd
JOIN who w ON w.user_id = dd.user_id
JOIN documents d ON d.id = dd.document_id AND d.type = 'drawing'
JOIN projects p ON p.id = d.project_id
ORDER BY p.name, d.name, d.version, w.email;

-- 4) The evidence gap, whole of prod: every signature (acknowledged_at set)
--    by a portal member who cannot open that document in the portal TODAY.
--    Dashboard admins/PMs of the project's company are left out (they open
--    everything on the dashboard). Superseded safety documents are counted:
--    the portal lists safety documents only while current.
WITH cards AS (
  SELECT pm.project_id, COALESCE(pm.user_id, pe.user_id) AS login, pm.person_id,
         pm.user_id IS NOT NULL AS holds_login, COALESCE(s.trades, '{}'::text[]) AS trades
  FROM project_members pm JOIN people pe ON pe.id = pm.person_id
  LEFT JOIN subcontractors s ON s.id = pe.subcontractor_id
  WHERE pm.user_id IS NOT NULL OR (pe.user_id IS NOT NULL AND pe.archived_at IS NULL)
), signed AS (
  SELECT dd.user_id, dd.acknowledged_at, dd.signed_off_with_pin, d.*
  FROM document_distributions dd JOIN documents d ON d.id = dd.document_id
  JOIN projects p ON p.id = d.project_id
  WHERE dd.acknowledged_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM company_members cm WHERE cm.user_id = dd.user_id AND cm.company_id = p.company_id AND cm.role IN ('admin', 'project_manager'))
)
SELECT pr.name AS project, s.name AS document, s.type, s.revision, s.status, u.email AS signer,
       s.acknowledged_at, s.signed_off_with_pin,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM cards c WHERE c.project_id = s.project_id AND c.login = s.user_id AND c.holds_login) THEN 'signer no longer on the project'
         WHEN s.status NOT IN ('current', 'superseded') THEN 'document ' || s.status
         WHEN s.type = 'safety' AND s.status <> 'current' THEN 'superseded safety document (portal lists current only)'
         ELSE 'no share rule reaches the signer any more'
       END AS why_cant_open
FROM signed s
JOIN projects pr ON pr.id = s.project_id
JOIN users u ON u.id = s.user_id
WHERE NOT (
  EXISTS (SELECT 1 FROM cards c WHERE c.project_id = s.project_id AND c.login = s.user_id AND c.holds_login)
  AND s.status IN ('current', 'superseded')
  AND (
    (s.type = 'safety' AND s.status = 'current')
    OR EXISTS (
      SELECT 1 FROM portal_shares ps JOIN cards c ON c.project_id = ps.project_id AND c.login = s.user_id
      WHERE ps.item_type = 'document' AND ps.item_id = s.id AND (
        ps.audience_type = 'all'
        OR (ps.audience_type = 'person' AND c.person_id = ps.person_id)
        OR (ps.audience_type = 'trade' AND (ps.trade = ANY(c.trades) OR (cardinality(c.trades) = 0 AND ps.trade = 'Site Staff')))))
  )
)
ORDER BY pr.name, s.name, s.version, u.email;
