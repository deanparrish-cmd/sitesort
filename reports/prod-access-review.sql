-- READ-ONLY access review (2026-10-07, #116). Changes nothing.
-- Run against the PRODUCTION database. Times are UK local time.
-- Nothing records WHO created a user, membership, insurance record or board
-- pin, so this can't prove who did what. It lists what exists so you can spot
-- anything you don't recognise.

-- 1) Every dashboard login that is NOT an admin or project manager.
--    These are the only accounts that could have used today's holes.
--    (Team Portal-only logins can't reach any of them, so they're excluded.)
SELECT c.name AS company, u.name, u.email, m.role,
       to_char(m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS joined_company,
       to_char(u.last_active_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS last_active,
       u.email_verified
FROM company_members m
JOIN users u ON u.id = m.user_id
JOIN companies c ON c.id = m.company_id
WHERE m.role NOT IN ('admin', 'project_manager') AND u.portal_only = false
ORDER BY c.name, m.created_at;

-- 2) Every ADMIN and PROJECT MANAGER, newest first. Anyone here you don't
--    recognise, or who became admin unexpectedly, is the thing to look at.
SELECT c.name AS company, u.name, u.email, m.role,
       to_char(m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS joined_company,
       to_char(u.last_active_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS last_active
FROM company_members m
JOIN users u ON u.id = m.user_id
JOIN companies c ON c.id = m.company_id
WHERE m.role IN ('admin', 'project_manager')
ORDER BY m.created_at DESC;

-- 3) Insurance records (current and archived), newest first: any you or your
--    PMs didn't upload?
SELECT c.name AS company, s.company_name AS contact_company, s.contact_name, i.type,
       i.expiry_date,
       to_char(i.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS filed,
       CASE WHEN i.archived_at IS NULL THEN 'current' ELSE 'archived' END AS state,
       i.certificate_url
FROM insurance_records i
JOIN subcontractors s ON s.id = i.subcontractor_id
JOIN companies c ON c.id = s.company_id
ORDER BY i.created_at DESC;

-- 4) What is pinned to each PUBLIC site board, newest first.
SELECT p.name AS project, b.item_type, b.item_id,
       to_char(b.pinned_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS pinned
FROM qr_board_pins b
JOIN projects p ON p.id = b.project_id
ORDER BY b.pinned_at DESC;

-- 5) Count of logins per company and role (for the overall picture).
SELECT c.name AS company, m.role, u.portal_only, count(*) AS logins
FROM company_members m
JOIN users u ON u.id = m.user_id
JOIN companies c ON c.id = m.company_id
GROUP BY c.name, m.role, u.portal_only
ORDER BY c.name, m.role;
