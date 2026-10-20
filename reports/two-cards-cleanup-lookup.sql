-- Read-only (SELECT only). Run on PROD after #141 is published (2026-10-20).
-- Names the two things Dean sorts by hand: the one needs_decision share, and
-- Amy's two cards on "test 1 site sort".

-- 1. The needs_decision share: a person share on a card whose login now holds
--    a DIFFERENT card on that project, and the card has no membership row
--    (moved or removed, code can't tell). Expected: 1 row.
SELECT ps.id AS share_id, ps.item_type, ps.item_id,
       coalesce(d.name || coalesce(' rev ' || d.revision, ''), pm_t.type || ': ' || pm_t.description, ps.item_type) AS item,
       ps.created_at AS shared_at, sb.email AS shared_by,
       pr.name AS project, x.id AS card_id, x.name AS card_name, x.email AS card_email,
       coalesce(sx.company_name, 'In-house') AS card_firm, x.created_at AS card_created,
       u.email AS login_email,
       (SELECT coalesce(sy.company_name, 'In-house') || ' (' || y.name || ')'
          FROM project_members m JOIN people y ON y.id = m.person_id
          LEFT JOIN subcontractors sy ON sy.id = y.subcontractor_id
          WHERE m.project_id = ps.project_id AND m.user_id = x.user_id LIMIT 1) AS login_now_holds,
       (SELECT max(i.accepted_at) FROM project_invites i
          WHERE i.project_id = ps.project_id AND i.person_id = x.id AND i.status = 'accepted') AS card_invite_accepted
FROM portal_shares ps
JOIN people x ON x.id = ps.person_id
LEFT JOIN subcontractors sx ON sx.id = x.subcontractor_id
JOIN users u ON u.id = x.user_id
JOIN projects pr ON pr.id = ps.project_id
LEFT JOIN documents d ON ps.item_type = 'document' AND d.id = ps.item_id
LEFT JOIN permits pm_t ON ps.item_type = 'permit' AND pm_t.id = ps.item_id
LEFT JOIN users sb ON sb.id = ps.shared_by_user_id
WHERE ps.audience_type = 'person'
  AND x.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ps.project_id AND m.person_id = x.id)
  AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ps.project_id AND m.user_id = x.user_id AND m.person_id <> x.id);

-- 2. Amy's two cards on "test 1 site sort": one row per card, everything
--    needed to pick the one to keep. Expected: 2 rows.
SELECT p.id AS card_id, p.name, p.email, coalesce(s.company_name, 'In-house') AS firm, s.trades,
       m.added_at, (m.user_id IS NOT NULL) AS holds_login,
       m.can_log_issues, m.can_update_plant_materials, m.can_edit_daily_report, m.is_project_manager,
       (SELECT count(*) FROM portal_shares ps WHERE ps.project_id = m.project_id AND ps.person_id = p.id) AS person_shares,
       (SELECT max(ps.created_at) FROM portal_shares ps WHERE ps.project_id = m.project_id AND ps.person_id = p.id) AS last_share,
       (SELECT count(*) FROM project_invites i WHERE i.person_id = p.id) AS invites,
       (SELECT count(*) FROM project_invites i WHERE i.person_id = p.id AND i.status = 'revoked') AS invites_revoked,
       p.created_at AS card_created
FROM project_members m
JOIN people p ON p.id = m.person_id
LEFT JOIN subcontractors s ON s.id = p.subcontractor_id
JOIN projects pr ON pr.id = m.project_id
WHERE pr.name = 'test 1 site sort'
  AND p.archived_at IS NULL
  AND lower(p.name) LIKE 'amy%parrish%'
ORDER BY m.added_at;
