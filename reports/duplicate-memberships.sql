-- Read-only (SELECT only). Run on PROD (2026-10-20).
-- One card (people row) with more than one project_members row on the SAME
-- project. Found via Amy on "test 1 site sort": card 25f8a59f has a row added
-- 2026-07-25 (no login, no permissions) and one added 2026-07-30 (login,
-- all three portal permissions). Nothing stops this: the only unique index is
-- (project_id, user_id) WHERE user_id IS NOT NULL.

-- 1. Summary. Expected after the fix: 0.
SELECT count(*) AS duplicate_pairs, coalesce(sum(n - 1), 0) AS extra_rows
FROM (SELECT project_id, person_id, count(*) AS n
      FROM project_members WHERE person_id IS NOT NULL
      GROUP BY 1, 2 HAVING count(*) > 1) d;

-- 2. Every row of every duplicate pair, with what a cleanup would decide.
--    keep = the row carrying a login, else the oldest. Rows marked "drop"
--    lose nothing only if their permissions/schedule/PM flag are all off or
--    match the kept row: check the differs_from_keep column.
WITH d AS (
  SELECT project_id, person_id FROM project_members WHERE person_id IS NOT NULL
  GROUP BY 1, 2 HAVING count(*) > 1
),
r AS (
  SELECT m.*, row_number() OVER (PARTITION BY m.project_id, m.person_id
           ORDER BY (m.user_id IS NULL), m.added_at) AS rn
  FROM project_members m JOIN d USING (project_id, person_id)
)
SELECT pr.name AS project, p.name AS card, p.email, r.person_id AS card_id, r.id AS row_id,
       CASE WHEN r.rn = 1 THEN 'keep' ELSE 'drop' END AS decision,
       r.added_at, u.email AS row_login, r.role,
       r.can_log_issues, r.can_update_plant_materials, r.can_edit_daily_report, r.is_project_manager,
       r.scheduled_days, r.site_start_time, r.site_end_time, r.register_opened_at,
       CASE WHEN r.rn = 1 THEN NULL ELSE (
         (r.can_log_issues AND NOT k.can_log_issues) OR (r.can_update_plant_materials AND NOT k.can_update_plant_materials)
         OR (r.can_edit_daily_report AND NOT k.can_edit_daily_report) OR (r.is_project_manager AND NOT k.is_project_manager)
         OR (coalesce(array_length(r.scheduled_days, 1), 0) > 0 AND coalesce(array_length(k.scheduled_days, 1), 0) = 0)
         OR (r.user_id IS NOT NULL)
       ) END AS differs_from_keep
FROM r
JOIN r k ON k.project_id = r.project_id AND k.person_id = r.person_id AND k.rn = 1
JOIN projects pr ON pr.id = r.project_id
JOIN people p ON p.id = r.person_id
LEFT JOIN users u ON u.id = r.user_id
ORDER BY pr.name, p.name, r.rn;

-- 3. Indexes on project_members (confirms there is no (project_id, person_id)
--    unique index on prod either).
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'project_members' ORDER BY 1;

-- 4. Where the extra rows probably came from: the boot repair in
--    lib/ensure-schema.ts "Step 3" (8058b3b, 2026-07-30) inserts a row with
--    added_at = now() for an accepted invite whose login has no row, without
--    checking for an existing row of the same card. A dropped row whose kept
--    partner has an accepted invite for the same login matches that shape.
SELECT pr.name AS project, p.name AS card, m.id AS row_id, m.added_at, (m.user_id IS NOT NULL) AS holds_login,
       i.status AS invite_status, i.accepted_at, ui.email AS invite_accepted_by
FROM project_members m
JOIN (SELECT project_id, person_id FROM project_members WHERE person_id IS NOT NULL
      GROUP BY 1, 2 HAVING count(*) > 1) d USING (project_id, person_id)
JOIN projects pr ON pr.id = m.project_id
JOIN people p ON p.id = m.person_id
LEFT JOIN project_invites i ON i.project_id = m.project_id AND i.person_id = m.person_id AND i.status = 'accepted'
LEFT JOIN users ui ON ui.id = i.accepted_user_id
ORDER BY pr.name, p.name, m.added_at;
