-- READ-ONLY (2026-10-23, #169). Pending Team Portal invites whose link was
-- handed to the inviter before #169 (every token minted before the release:
-- email_only defaults to false). After #169 these links still work for a NEW
-- login until they expire (7 days), so whoever was handed the link could still
-- use it. Run after publishing. If Dean decides, the fix is "Send again" on
-- each (or refuse non-email-only tokens), never an edit here.
SELECT pi.id, p.name AS project, pi.name AS invitee, pi.email,
       inviter.name AS invited_by, pi.created_at, pi.expires_at,
       (SELECT count(*) FROM users u WHERE lower(u.email) = lower(pi.email)) AS has_login
FROM project_invites pi
JOIN projects p ON p.id = pi.project_id
LEFT JOIN users inviter ON inviter.id = pi.invited_by_user_id
WHERE pi.status = 'pending' AND pi.expires_at > now() AND pi.email_only = false
ORDER BY pi.expires_at;

-- Always returns one row: how many.
SELECT count(*) AS pending_copyable_invites
FROM project_invites WHERE status = 'pending' AND expires_at > now() AND email_only = false;
