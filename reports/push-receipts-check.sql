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
