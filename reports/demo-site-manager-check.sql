-- Demo company: why is Ravensworth Mews' site manager not set? (2026-10-29) READ-ONLY, run on PROD.
-- Shows the project's site_manager_id, Gary's card row(s) on the project (user_id is
-- what the seed needs: it is set when Gary accepts), and his invite.
SELECT pr.id AS project_id, pr.site_manager_id,
       (SELECT u.name FROM users u WHERE u.id = pr.site_manager_id) AS site_manager_name,
       pe.first_name || ' ' || pe.last_name AS card, pe.user_id AS card_login, m.id AS member_row, m.user_id AS member_login,
       (SELECT u.email FROM users u WHERE u.id = m.user_id) AS login_email,
       (SELECT string_agg(i.status || ' ' || coalesce(i.accepted_at::text, '-'), '; ')
          FROM project_invites i WHERE i.project_id = pr.id AND i.person_id = pe.id) AS invites
FROM projects pr
JOIN companies c ON c.id = pr.company_id AND c.name = 'Brookfield & Haigh Construction Ltd'
LEFT JOIN people pe ON pe.first_name = 'Gary' AND pe.last_name = 'Booth' AND pe.company_id = c.id
LEFT JOIN project_members m ON m.project_id = pr.id AND m.person_id = pe.id
WHERE pr.name = 'Ravensworth Mews';
