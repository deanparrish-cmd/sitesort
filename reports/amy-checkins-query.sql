-- READ-ONLY. Lists every site check-in that could belong to Amy Parrish,
-- open rows (still on site) first. Changes nothing.
-- Times are shown in UK local time.
SELECT
  CASE WHEN c.checked_out_at IS NULL THEN 'OPEN (on site)' ELSE 'closed' END AS state,
  p.name                                                          AS project,
  to_char(c.checked_in_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS checked_in,
  to_char(c.checked_out_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS checked_out,
  c.worker_name                                                   AS name_as_typed,
  c.company_name                                                  AS company_as_typed,
  COALESCE(c.person_key, '(none: old row)')                       AS identity_link,
  c.id                                                            AS row_id
FROM site_checkins c
JOIN projects p ON p.id = c.project_id
WHERE c.worker_name ILIKE 'amy%'
   OR c.person_key IN (
        SELECT 'person:' || id FROM people WHERE name ILIKE 'amy%'
        UNION SELECT 'user:' || id FROM users WHERE name ILIKE 'amy%'
      )
ORDER BY (c.checked_out_at IS NULL) DESC, c.checked_in_at DESC;
