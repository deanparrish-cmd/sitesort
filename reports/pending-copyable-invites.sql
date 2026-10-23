-- READ-ONLY (2026-10-23, #169/#170). Pending Team Portal invites whose link was
-- handed to the inviter (every link issued before #169). Once #170 is live
-- these links are REFUSED ("out of date, ask for it to be sent again") and each
-- try is logged in invite_link_refusals; the PM sees "Old invite link no longer
-- works: resend it". This lists who will hit that.
--
-- RUN IT NOW, BEFORE PUBLISHING: until #169 is live, prod has no email_only
-- column and every pending invite is pre-#169, so this version needs no column.

SELECT pi.id, p.name AS project, pi.name AS invitee, pi.email,
       inviter.name AS invited_by, pi.email_status, pi.created_at, pi.expires_at,
       (SELECT count(*) FROM users u WHERE lower(u.email) = lower(pi.email)) AS has_login
FROM project_invites pi
JOIN projects p ON p.id = pi.project_id
LEFT JOIN users inviter ON inviter.id = pi.invited_by_user_id
WHERE pi.status = 'pending' AND pi.expires_at > now()
ORDER BY pi.expires_at;

-- Always returns one row: how many.
SELECT count(*) AS pending_copyable_invites
FROM project_invites WHERE status = 'pending' AND expires_at > now();

-- AFTER publishing (#169/#170 live), the same list is:
--   ... WHERE status = 'pending' AND expires_at > now() AND email_only = false
-- and refusals so far:
--   SELECT r.created_at, r.stage, pi.name, pi.email, r.ip_address
--   FROM invite_link_refusals r JOIN project_invites pi ON pi.id = r.invite_id
--   ORDER BY r.created_at DESC;
