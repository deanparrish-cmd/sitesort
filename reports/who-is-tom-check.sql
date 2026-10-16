-- Read-only (SELECT only). Who are tom@testsitesort.co.uk and test@sitesort.com,
-- and have they done anything? Run on PROD (2026-10-16).
--
-- What SiteSort records about logins: users.last_active_at (dashboard, updated
-- as they use it), portal_sessions (one row per portal sign-in), and
-- credential_reset_tokens (password/PIN resets). There is NO login log for the
-- dashboard and NO "created by" on a user made from the Team page: if section 5
-- is empty, who added them is not recorded anywhere.

-- 1. Accounts (users table): name, role, home company, created, last active, verified.
SELECT u.email, u.name, u.role, c.name AS home_company, u.created_at, u.last_active_at,
       u.email_verified, u.portal_only, u.platform_admin,
       (SELECT string_agg(c2.name || ' (' || cm.role || ', joined ' || cm.created_at::date || ')', '; ')
          FROM company_members cm JOIN companies c2 ON c2.id = cm.company_id WHERE cm.user_id = u.id) AS memberships
FROM users u LEFT JOIN companies c ON c.id = u.company_id
WHERE lower(u.email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com');

-- 2. Contact cards (people table): a card is a contact record, not a login.
SELECT p.email, p.name, p.role_title, c.name AS company, p.created_at, p.archived_at,
       (p.user_id IS NOT NULL) AS linked_to_a_login,
       (SELECT string_agg(pr.name, '; ') FROM project_members pm JOIN projects pr ON pr.id = pm.project_id WHERE pm.person_id = p.id) AS on_projects
FROM people p LEFT JOIN companies c ON c.id = p.company_id
WHERE lower(p.email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com');

-- 3. What the accounts have done: one row per kind of activity, with counts and
--    first/last dates. All zero (or no rows) = never used.
WITH u AS (SELECT id, email FROM users WHERE lower(email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com'))
SELECT u.email, x.what, x.n, x.first_at, x.last_at FROM u
CROSS JOIN LATERAL (
  SELECT 'portal sign-ins' AS what, count(*) AS n, min(created_at) AS first_at, max(last_active_at) AS last_at FROM portal_sessions WHERE user_id = u.id
  UNION ALL SELECT 'password/PIN resets', count(*), min(created_at), max(created_at) FROM credential_reset_tokens WHERE user_id = u.id
  UNION ALL SELECT 'activity log entries', count(*), min(created_at), max(created_at) FROM activity_log WHERE user_id = u.id
  UNION ALL SELECT 'documents uploaded', count(*), min(created_at), max(created_at) FROM documents WHERE uploaded_by = u.id
  UNION ALL SELECT 'photos / site issues', count(*), min(taken_at), max(taken_at) FROM photos WHERE uploaded_by = u.id OR submitted_by = u.id
  UNION ALL SELECT 'messages sent', count(*), min(created_at), max(created_at) FROM messages WHERE sender_id = u.id
  UNION ALL SELECT 'documents viewed/signed', count(*), min(viewed_at), max(acknowledged_at) FROM document_distributions WHERE user_id = u.id AND (viewed_at IS NOT NULL OR acknowledged_at IS NOT NULL)
  UNION ALL SELECT 'check-in decisions made', count(*), min(hold_decided_at), max(hold_decided_at) FROM site_checkins WHERE hold_decided_by = u.id OR checked_out_by = u.id
  UNION ALL SELECT 'project memberships', count(*), min(added_at), max(added_at) FROM project_members WHERE user_id = u.id
) x
ORDER BY u.email, x.what;

-- 4. QR check-ins under their name (check-ins store a typed name, not an account).
SELECT s.worker_name, s.company_name, s.checked_in_at, p.name AS project
FROM site_checkins s JOIN projects p ON p.id = s.project_id
WHERE s.worker_name ILIKE '%tom fielder%' OR s.worker_name ILIKE 'test'
ORDER BY s.checked_in_at DESC LIMIT 20;

-- 5. Who added them, where it is recorded: portal invites sent to these
--    addresses, and log entries of OTHER people acting on their records.
SELECT 'portal invite' AS source, i.created_at, inv.email AS by_whom, pr.name AS project, i.status, i.accepted_at
FROM project_invites i
JOIN users inv ON inv.id = i.invited_by_user_id
LEFT JOIN projects pr ON pr.id = i.project_id
WHERE lower(i.email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com')
UNION ALL
SELECT 'activity: ' || a.section || ' ' || a.action, a.created_at, actor.email, pr.name, a.item_type, NULL
FROM activity_log a
JOIN users actor ON actor.id = a.user_id
LEFT JOIN projects pr ON pr.id = a.project_id
WHERE a.item_id IN (
  SELECT id FROM users WHERE lower(email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com')
  UNION SELECT id FROM people WHERE lower(email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com'))
ORDER BY 2;

-- 6. The messages they sent (first 100 characters), to whom, when. Messages
--    stamped within a second of the account's creation were written by a seed
--    script, not typed by a person.
SELECT m.created_at, s.email AS sender, r.email AS recipient, c.name AS company, left(m.content, 100) AS message,
       round(extract(epoch FROM (m.created_at - s.created_at))::numeric, 1) AS seconds_after_account_created
FROM messages m
JOIN users s ON s.id = m.sender_id
LEFT JOIN users r ON r.id = m.recipient_id
LEFT JOIN companies c ON c.id = m.company_id
WHERE lower(s.email) IN ('tom@testsitesort.co.uk', 'test@sitesort.com')
ORDER BY m.created_at;
