-- READ-ONLY. Changes nothing. Run against the PRODUCTION database.
-- Times are shown in UK local time (the same clock the Check-Ins tab shows
-- on a UK device). Raw database values are UTC, one hour behind in summer.

-- 1) Possible duplicate identities: every check-in for anyone named Amy... or
--    Dean... (covers "Amy" / "Amy Parrish" and "Dean'o" / "Dean Parrish"),
--    across ALL projects, open rows (still on site) first.
SELECT
  CASE WHEN lower(c.worker_name) LIKE 'amy%' THEN 'AMY' ELSE 'DEAN' END       AS who,
  CASE
    WHEN c.checked_out_at IS NOT NULL THEN 'closed'
    WHEN c.checkout_method = 'legacy' THEN 'old, before sign-out existed'
    ELSE 'OPEN (counted on site)'
  END                                                                          AS state,
  p.name                                                                       AS project,
  to_char(c.checked_in_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS checked_in_uk,
  to_char(c.checked_out_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS checked_out_uk,
  c.checkout_method                                                            AS how_signed_out,
  c.worker_name                                                                AS name_as_typed,
  COALESCE(c.company_name, '(none)')                                           AS company_as_typed,
  COALESCE(c.person_key, '(none: no identity link)')                           AS identity_link,
  c.id                                                                         AS row_id
FROM site_checkins c
JOIN projects p ON p.id = c.project_id
WHERE lower(c.worker_name) LIKE 'amy%'
   OR lower(c.worker_name) LIKE 'dean%'
   OR c.person_key IN (
        SELECT 'person:' || id FROM people WHERE lower(name) LIKE 'amy%' OR lower(name) LIKE 'dean%'
        UNION SELECT 'user:' || id FROM users WHERE lower(name) LIKE 'amy%' OR lower(name) LIKE 'dean%'
      )
ORDER BY who, (c.checked_out_at IS NULL) DESC, c.checked_in_at DESC;

-- 2) The double check-in question: Dean's rows on 18 Sep 2026 between
--    19:45 and 20:05 UK time (18:45 to 19:05 UTC). If the 19:52 row has a
--    checked_out_uk time before 19:54, it was a sign-out then a new check-in.
SELECT
  to_char(c.checked_in_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI:SS') AS checked_in_uk,
  to_char(c.checked_out_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI:SS') AS checked_out_uk,
  c.checkout_method AS how_signed_out,
  c.worker_name, c.company_name, p.name AS project, c.id AS row_id
FROM site_checkins c
JOIN projects p ON p.id = c.project_id
WHERE lower(c.worker_name) LIKE 'dean%'
  AND c.checked_in_at >= '2026-09-18 18:45:00' AND c.checked_in_at < '2026-09-18 19:05:00'
ORDER BY c.checked_in_at;
