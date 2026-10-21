-- Held at the gate, site manager not told (Dean, prod, 2026-10-21). READ-ONLY.
-- Every statement is a SELECT. Put the project's exact name in each
-- statement's first line, run them one at a time.
--
-- How the alert works (routes/qr.ts notifyHeldCheckin):
--   * Phone alert, sent at once during the check-in (NOT via pending_pushes,
--     so the scheduler delay doesn't apply), only to registerHolderIds: the
--     project's site manager IF she has a project_members row with her
--     user_id on the project, plus everyone with PM cover on the project.
--     It reaches only phones with a push_subscriptions row for that user AND
--     that project.
--   * In-app bell row for company admins/PMs (dashboard accounts) and the
--     site manager. The portal has no notification list, so a portal-only
--     site manager never sees hers.

-- 1. The site manager: is she an account, portal-only, and on the project
--    team with her login (needed for the phone alert)?
WITH target AS (SELECT 'PUT THE PROJECT NAME HERE'::text AS name)
SELECT p.name AS project, u.name AS site_manager, u.portal_only,
  EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id) AS on_team_with_login,
  EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id AND pm.is_project_manager) AS has_pm_cover
FROM projects p, target t
LEFT JOIN users u ON true
WHERE p.name = t.name AND u.id = p.site_manager_id;

-- 2. Everyone the phone alert goes to, and the phones registered for this
--    project for each of them. phones = 0 means nobody's phone can ring.
WITH target AS (SELECT 'PUT THE PROJECT NAME HERE'::text AS name),
proj AS (SELECT p.id, p.site_manager_id FROM projects p, target t WHERE p.name = t.name),
holders AS (
  SELECT pm.user_id FROM project_members pm, proj WHERE pm.project_id = proj.id AND pm.user_id IS NOT NULL AND pm.is_project_manager
  UNION
  SELECT proj.site_manager_id FROM proj WHERE EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = proj.id AND pm.user_id = proj.site_manager_id)
)
SELECT u.name, (u.id = (SELECT site_manager_id FROM proj)) AS is_site_manager,
  (SELECT count(*) FROM push_subscriptions s, proj WHERE s.user_id = u.id AND s.project_id = proj.id) AS phones,
  (SELECT max(s.last_seen_at) FROM push_subscriptions s, proj WHERE s.user_id = u.id AND s.project_id = proj.id) AS phone_last_seen
FROM holders h JOIN users u ON u.id = h.user_id;

-- 3. Today's held check-ins on this project, and who got the in-app row.
WITH target AS (SELECT 'PUT THE PROJECT NAME HERE'::text AS name)
SELECT c.checked_in_at, c.worker_name, c.company_name, c.hold_reason, c.hold_status, c.id AS checkin_id,
  (SELECT string_agg(u.name || CASE WHEN u.portal_only THEN ' (portal only)' ELSE '' END, ', ')
     FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.related_entity_id = c.id AND n.type = 'check_in_held') AS in_app_rows_for
FROM site_checkins c JOIN projects p ON p.id = c.project_id, target t
WHERE p.name = t.name AND c.hold_reason IS NOT NULL AND c.checked_in_at > now() - interval '1 day'
ORDER BY c.checked_in_at DESC;

-- 4. Anything queued in pending_pushes for this project in the last hour
--    (the hold alert should NOT be here; this proves it either way).
WITH target AS (SELECT 'PUT THE PROJECT NAME HERE'::text AS name)
SELECT pp.created_at, pp.kind, pp.title, u.name AS for_user
FROM pending_pushes pp JOIN projects p ON p.id = pp.project_id JOIN users u ON u.id = pp.user_id, target t
WHERE p.name = t.name AND pp.created_at > now() - interval '1 hour'
ORDER BY pp.created_at DESC;
