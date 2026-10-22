-- Phone alert receipts (#153), READ-ONLY. Run on prod after the publish.
-- push_alerts starts empty at the publish: older alerts left no row.

-- 1. Does every send leave a row, and do phones report back?
--    accepted = Apple/Google took it; received = the phone said it arrived.
SELECT kind, send_result, count(*) AS sent,
       count(received_at) AS received, count(tapped_at) AS tapped,
       count(*) FILTER (WHERE shown = false) AS posting_failed,
       count(*) FILTER (WHERE permission = 'denied') AS permission_denied
  FROM push_alerts GROUP BY 1, 2 ORDER BY 1, 2;

-- 2. Per person: phones, last confirmed arrival, latest test answer.
--    (Replace the email to look at one person, e.g. the site manager.)
SELECT u.email,
       count(DISTINCT s.endpoint) AS phones_now,
       max(a.received_at) AS last_confirmed,
       (SELECT banner_answer || ' at ' || answered_at || CASE WHEN t.received_at IS NULL THEN ' (never arrived)' ELSE ' (arrived)' END
          FROM push_alerts t WHERE t.user_id = u.id AND t.kind = 'test' AND t.banner_answer IS NOT NULL
         ORDER BY t.answered_at DESC LIMIT 1) AS latest_test_answer
  FROM users u
  JOIN push_alerts a ON a.user_id = u.id
  LEFT JOIN push_subscriptions s ON s.user_id = u.id
 -- WHERE u.email = 'someone@example.com'
 GROUP BY u.id, u.email ORDER BY last_confirmed DESC NULLS LAST;

-- 3. Phones removed after 7 unanswered alerts.
SELECT u.email, a.sent_at AS removed_at, left(a.endpoint, 40) AS phone
  FROM push_alerts a JOIN users u ON u.id = a.user_id
 WHERE a.send_result = 'pruned' ORDER BY a.sent_at DESC;

-- 4. GATE HOLD RE-RUN: one row per phone per hold alert, newest first.
--    Hold alerts carry tag 'hold-<id>'. Replace the email with the site manager's.
--    outcome (same rules as alertOutcome in lib/push-receipts.ts):
--      old_app_no_receipt  phone still on the old service worker: silence proves nothing
--      waiting             under a minute old
--      never_arrived       service worker never ran (push didn't reach it, or no signal to report back)
--      arrived_no_result   it ran, then never finished showing (killed or hung)
--      show_failed         it ran and showNotification threw: see show_error
--      not_posted          showNotification resolved, but the notification isn't in the phone's list
--      displayed_app_open  shown while SiteSort was open on screen: iOS shows no banner then
--      displayed           shown and posted: no banner now means the phone's settings (Focus, banners off)
SELECT a.sent_at, a.tag, u.email, left(a.endpoint, 40) AS phone, s.user_agent,
       a.send_result, a.send_status, a.device_sw, a.sw_version,
       CASE
         WHEN a.send_result <> 'accepted' THEN a.send_result
         WHEN a.arrived_at IS NULL AND a.received_at IS NULL AND a.tapped_at IS NULL THEN
           CASE WHEN a.device_sw IS NULL THEN 'old_app_no_receipt'
                WHEN a.sent_at > now() - interval '1 minute' THEN 'waiting'
                ELSE 'never_arrived' END
         WHEN a.received_at IS NULL THEN CASE WHEN a.tapped_at IS NOT NULL THEN 'displayed' ELSE 'arrived_no_result' END
         WHEN a.shown = false THEN 'show_failed'
         WHEN a.posted = false THEN 'not_posted'
         WHEN a.foreground THEN 'displayed_app_open'
         ELSE 'displayed'
       END AS outcome,
       a.show_error, a.permission, a.posted, a.foreground,
       a.badge_result,  -- set:N = setAppBadge accepted N (visible only if notifications allowed and Badges on); unsupported; or the error
       a.arrived_at - a.sent_at AS to_arrive, a.received_at - a.sent_at AS to_show, a.tapped_at
  FROM push_alerts a
  JOIN users u ON u.id = a.user_id
  LEFT JOIN LATERAL (SELECT user_agent FROM push_subscriptions WHERE endpoint = a.endpoint LIMIT 1) s ON true
 WHERE a.tag LIKE 'hold-%'
   -- AND u.email = 'annabelleparrish@icloud.com'
 ORDER BY a.sent_at DESC
 LIMIT 40;

-- 5. Which of the person's phones can report back right now (sw_version NULL =
--    old service worker: open the portal on that phone once before the re-run).
SELECT u.email, left(s.endpoint, 40) AS phone, s.user_agent, s.sw_version, max(s.last_seen_at) AS last_registered,
       count(*) AS projects
  FROM push_subscriptions s JOIN users u ON u.id = s.user_id
 -- WHERE u.email = 'annabelleparrish@icloud.com'
 GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC;
