-- Which of a person's registered phones are real (Dean, prod, 2026-10-21).
-- READ-ONLY, one SELECT. Put the person's login email and the project's
-- exact name in the first line.
--
-- One row per registered browser install. How to read it:
--   push_service  apple = an iPhone/iPad home-screen app or Mac Safari;
--                 google = Chrome (Android or desktop); mozilla = Firefox.
--   device        from the browser's own description (iPhone, iPad, Mac...).
--   registered    when alerts were first turned on in that install.
--   last_opened   last time the portal was opened in that install (the
--                 portal quietly re-registers on every open). An install not
--                 opened for weeks is probably an old phone or a removed app.
-- Apple accepting a push ("delivered") only means the endpoint still
-- exists; it does not mean a banner appeared. A 404/410 from the push
-- service deletes the row (lib/web-push.ts), so rows here were all still
-- accepted at the last send.
WITH target AS (SELECT 'PUT THE EMAIL HERE'::text AS email, 'PUT THE PROJECT NAME HERE'::text AS project)
SELECT
  CASE WHEN s.endpoint LIKE 'https://web.push.apple.com/%' THEN 'apple'
       WHEN s.endpoint LIKE 'https://fcm.googleapis.com/%' THEN 'google'
       WHEN s.endpoint LIKE '%mozilla.com/%' THEN 'mozilla'
       ELSE 'other' END AS push_service,
  CASE WHEN s.user_agent ILIKE '%iPhone%' THEN 'iPhone'
       WHEN s.user_agent ILIKE '%iPad%' THEN 'iPad'
       WHEN s.user_agent ILIKE '%Android%' THEN 'Android'
       WHEN s.user_agent ILIKE '%Macintosh%' THEN 'Mac'
       WHEN s.user_agent ILIKE '%Windows%' THEN 'Windows'
       ELSE coalesce(left(s.user_agent, 40), 'unknown') END AS device,
  substring(s.user_agent from 'OS ([0-9_]+)') AS ios_version,
  s.created_at AS registered,
  s.last_seen_at AS last_opened,
  right(s.endpoint, 8) AS endpoint_tail
FROM push_subscriptions s
JOIN users u ON u.id = s.user_id
JOIN projects p ON p.id = s.project_id, target t
WHERE lower(u.email) = lower(t.email) AND p.name = t.project
ORDER BY s.last_seen_at DESC NULLS LAST;
