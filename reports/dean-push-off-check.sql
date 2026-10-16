-- Read-only (SELECT only). Why did Dean's portal notifications switch off?
-- (2026-10-16). Run on PROD. Uses his portal login dean.parrish@partnersand.com.

-- A. Push subscriptions on file for him now. ONE row per phone (endpoint is
--    unique), tied to ONE project: the project that phone opened last.
--    No row = the server sends him nothing at all.
SELECT ps.created_at, ps.last_seen_at, p.name AS project, ps.user_agent
FROM push_subscriptions ps
JOIN users u ON u.id = ps.user_id
JOIN projects p ON p.id = ps.project_id
WHERE u.email = 'dean.parrish@partnersand.com'
ORDER BY ps.last_seen_at DESC;

-- B. His portal sessions in the last 3 days. A revoked_at with no logout by
--    him = the session was ended under him (project switch, access revoke).
--    The phone then got a 401, logged itself out, and switched alerts off.
SELECT s.created_at, s.last_active_at, s.revoked_at, s.expires_at, p.name AS project
FROM portal_sessions s
JOIN users u ON u.id = s.user_id
JOIN projects p ON p.id = s.project_id
WHERE u.email = 'dean.parrish@partnersand.com'
  AND (s.created_at >= now() - interval '3 days' OR s.revoked_at >= now() - interval '3 days')
ORDER BY s.created_at;

-- C. Portal requests refused as "access revoked" (403) in the last 3 days.
--    Any row here also logs the phone out and switches alerts off.
SELECT a.created_at, p.name AS project, a.section, a.action
FROM activity_log a
JOIN users u ON u.id = a.user_id
LEFT JOIN projects p ON p.id = a.project_id
WHERE u.email = 'dean.parrish@partnersand.com'
  AND a.action = 'blocked'
  AND a.created_at >= now() - interval '3 days'
ORDER BY a.created_at;
