-- Read-only: key tables intact after the 2026-10-16 database pause.
-- Run in the PRODUCTION database (Replit Database pane, production). SELECTs only.
-- Each row: table, row count, newest timestamp, and the id of the newest row.
-- What "good" looks like: counts at least what you'd expect, and newest_at close
-- to the last thing you know happened before the pause (not days earlier).
SELECT 'users' AS tbl, (SELECT count(*) FROM users) AS row_count,
       max(created_at) AS newest_at,
       (SELECT id FROM users ORDER BY created_at DESC LIMIT 1) AS newest_id,
       max(last_active_at) AS other_newest  -- latest activity by anyone
FROM users
UNION ALL
SELECT 'projects', (SELECT count(*) FROM projects), max(created_at),
       (SELECT id FROM projects ORDER BY created_at DESC LIMIT 1), NULL
FROM projects
UNION ALL
SELECT 'documents', (SELECT count(*) FROM documents), max(created_at),
       (SELECT id FROM documents ORDER BY created_at DESC LIMIT 1), NULL
FROM documents
UNION ALL
SELECT 'site_checkins', (SELECT count(*) FROM site_checkins), max(checked_in_at),
       (SELECT id FROM site_checkins ORDER BY checked_in_at DESC LIMIT 1),
       max(checked_out_at)  -- latest sign-out
FROM site_checkins
UNION ALL
SELECT 'share_links', (SELECT count(*) FROM share_links), max(created_at),
       (SELECT id FROM share_links ORDER BY created_at DESC LIMIT 1),
       max(last_opened_at)  -- latest link opened
FROM share_links
UNION ALL
SELECT 'portal_shares', (SELECT count(*) FROM portal_shares), max(created_at),
       (SELECT id FROM portal_shares ORDER BY created_at DESC LIMIT 1), NULL
FROM portal_shares
ORDER BY tbl;
