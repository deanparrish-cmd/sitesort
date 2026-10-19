-- Read-only (2026-10-19). One person, several contact cards: which card each share
-- is on, and which card each login is on. Test Drawing 2 = 16be9fca...

-- A. Shares on Test Drawing 2 and their cards.
SELECT s.id AS share_id, s.audience_type, s.trade, s.person_id AS card_id, pe.name,
       coalesce(sc.company_name, '(no firm)') AS company, pe.user_id AS card_login,
       (SELECT string_agg(pi.status, ',') FROM project_invites pi
         WHERE pi.person_id = pe.id AND pi.project_id = s.project_id) AS invite_status,
       (SELECT pm.user_id FROM project_members pm
         WHERE pm.person_id = pe.id AND pm.project_id = s.project_id) AS login_on_this_card,
       s.created_at
FROM portal_shares s
LEFT JOIN people pe ON pe.id = s.person_id
LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
WHERE s.item_id = '16be9fca-9db5-4870-820f-d77f773c1b6e'
ORDER BY s.created_at;

-- B. Dean's, Amy's and Annabelle's cards, logins, invites and membership rows.
SELECT pe.id AS card_id, pe.name, pe.email, coalesce(sc.company_name, '(no firm)') AS company, sc.trades,
       pe.user_id, u.email AS login_email,
       (SELECT string_agg(pi.status || ' ' || pi.email, ', ') FROM project_invites pi WHERE pi.person_id = pe.id) AS invites,
       (SELECT string_agg(pm.project_id || ' login=' || coalesce(pm.user_id, '-'), ', ') FROM project_members pm WHERE pm.person_id = pe.id) AS membership_rows
FROM people pe
LEFT JOIN subcontractors sc ON sc.id = pe.subcontractor_id
LEFT JOIN users u ON u.id = pe.user_id
WHERE pe.name ILIKE 'dean parrish%' OR pe.name ILIKE 'amy parrish%' OR pe.name ILIKE 'annabelle%'
ORDER BY pe.name, pe.created_at;

-- C. "Annabelle Rose0" vs "Annabelle Rose": one record or two?
SELECT pe.id, pe.name, length(pe.name) AS len, pe.email, pe.user_id, pe.created_at,
       (SELECT string_agg(pm.project_id, ' ') FROM project_members pm WHERE pm.person_id = pe.id) AS projects
FROM people pe WHERE pe.name ILIKE 'annabelle%' ORDER BY pe.created_at;

-- D. Phones carrying more than one person's alerts (alerts follow the phone, not the signed-in person).
SELECT left(endpoint, 50) AS phone, count(DISTINCT user_id) AS people, array_agg(DISTINCT user_id) AS users
FROM push_subscriptions GROUP BY endpoint HAVING count(DISTINCT user_id) > 1;
