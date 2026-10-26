-- READ-ONLY (2026-10-26). Changes nothing.
-- Was the July to October gap in expiry_reminder_logs "nothing was due" or
-- "the job stopped firing"? For every insurance record, permit and person
-- certificate (reminders for those since 19 Jul), works out
-- each reminder step it passed through between FROM_DATE and yesterday, and
-- whether a row exists for it.
--
-- How a step is due (lib/permit-reminders.ts milestoneFor, daysUntilExpiry):
--   '30' while 22 to 30 days are left, '21' 15 to 21, '14' 8 to 14,
--   '7' 2 to 7, '1' on the last day; then 'exp-0' to 'exp-6', one per day
--   from the expiry date. A step is sent at most once, on the first run inside
--   its window; if no run lands inside the window, that step is skipped for good.
-- So "missed" below = the item existed and wasn't archived during the window,
-- the window has closed, and no row was ever written for that step.
--
-- A missed step with NO recipient (has_recipient_now = false) may have been
-- skipped on purpose: insurance went only to users homed at the company with
-- role admin and email on, a permit to its responsible person with email on.
-- That is today's setting; nobody can tell what it was in August.
-- Days are counted on the server's clock (UTC): a window can be off by one day.
-- Records deleted since can't be checked (their rows, if any, stay in
-- expiry_reminder_logs with no record behind them).

-- 1. Summary: steps due in the gap, how many got a row, how many didn't.
WITH params AS (SELECT DATE '2026-07-07' AS from_date, current_date - 1 AS to_date),
steps(milestone, lo, hi) AS (VALUES
  ('30', 22, 30), ('21', 15, 21), ('14', 8, 14), ('7', 2, 7), ('1', 1, 1),
  ('exp-0', 0, 0), ('exp-1', -1, -1), ('exp-2', -2, -2), ('exp-3', -3, -3),
  ('exp-4', -4, -4), ('exp-5', -5, -5), ('exp-6', -6, -6)
),
items AS (
  SELECT 'insurance' AS entity_type, i.id, i.expiry_date, i.created_at, i.archived_at,
         s.company_name || ' ' || coalesce(i.type, 'insurance') AS what,
         EXISTS (SELECT 1 FROM users u WHERE u.company_id = s.company_id AND u.role = 'admin' AND u.email_notifications) AS has_recipient_now
  FROM insurance_records i JOIN subcontractors s ON s.id = i.subcontractor_id
  UNION ALL
  SELECT 'permit', p.id, p.expiry_date, p.created_at, p.archived_at,
         p.type || ': ' || coalesce(p.description, ''),
         EXISTS (SELECT 1 FROM users u WHERE u.id = p.responsible_user_id AND u.email_notifications)
  FROM permits p
  UNION ALL
  SELECT 'person_cert', pc.id, pc.expiry_date, pc.created_at, pc.archived_at,
         pe.name || ' ' || pc.name,
         EXISTS (SELECT 1 FROM users u WHERE u.company_id = pe.company_id AND u.role = 'admin' AND u.email_notifications)
  FROM person_certifications pc JOIN people pe ON pe.id = pc.person_id
),
due AS (
  SELECT it.*, st.milestone,
         (it.expiry_date - st.hi) AS window_start,
         (it.expiry_date - st.lo) AS window_end
  FROM items it CROSS JOIN steps st
),
gap AS (
  SELECT d.*, EXISTS (SELECT 1 FROM expiry_reminder_logs l
                      WHERE l.entity_type = d.entity_type AND l.entity_id = d.id AND l.milestone = d.milestone) AS has_row
  FROM due d, params
  WHERE d.window_end BETWEEN params.from_date AND params.to_date
    AND d.created_at::date <= d.window_end
    AND (d.archived_at IS NULL OR d.archived_at::date > d.window_start)
)
SELECT entity_type,
       count(*) AS steps_due,
       count(*) FILTER (WHERE has_row) AS got_a_row,
       count(*) FILTER (WHERE NOT has_row) AS missed,
       count(*) FILTER (WHERE NOT has_row AND has_recipient_now) AS missed_with_a_recipient_now,
       count(DISTINCT id) FILTER (WHERE NOT has_row) AS items_with_a_miss
FROM gap
GROUP BY 1
ORDER BY 1;

-- 2. Every missed step, with the dates it should have gone out.
WITH params AS (SELECT DATE '2026-07-07' AS from_date, current_date - 1 AS to_date),
steps(milestone, lo, hi) AS (VALUES
  ('30', 22, 30), ('21', 15, 21), ('14', 8, 14), ('7', 2, 7), ('1', 1, 1),
  ('exp-0', 0, 0), ('exp-1', -1, -1), ('exp-2', -2, -2), ('exp-3', -3, -3),
  ('exp-4', -4, -4), ('exp-5', -5, -5), ('exp-6', -6, -6)
),
items AS (
  SELECT 'insurance' AS entity_type, i.id, i.expiry_date, i.created_at, i.archived_at,
         s.company_name || ' ' || coalesce(i.type, 'insurance') AS what,
         EXISTS (SELECT 1 FROM users u WHERE u.company_id = s.company_id AND u.role = 'admin' AND u.email_notifications) AS has_recipient_now
  FROM insurance_records i JOIN subcontractors s ON s.id = i.subcontractor_id
  UNION ALL
  SELECT 'permit', p.id, p.expiry_date, p.created_at, p.archived_at,
         p.type || ': ' || coalesce(p.description, ''),
         EXISTS (SELECT 1 FROM users u WHERE u.id = p.responsible_user_id AND u.email_notifications)
  FROM permits p
  UNION ALL
  SELECT 'person_cert', pc.id, pc.expiry_date, pc.created_at, pc.archived_at,
         pe.name || ' ' || pc.name,
         EXISTS (SELECT 1 FROM users u WHERE u.company_id = pe.company_id AND u.role = 'admin' AND u.email_notifications)
  FROM person_certifications pc JOIN people pe ON pe.id = pc.person_id
),
due AS (
  SELECT it.*, st.milestone,
         (it.expiry_date - st.hi) AS window_start,
         (it.expiry_date - st.lo) AS window_end
  FROM items it CROSS JOIN steps st
)
SELECT d.entity_type, d.what, d.expiry_date, d.milestone,
       greatest(d.window_start, d.created_at::date) AS should_fire_from,
       d.window_end AS should_fire_by,
       d.has_recipient_now, d.archived_at::date AS archived_on
FROM due d, params
WHERE d.window_end BETWEEN params.from_date AND params.to_date
  AND d.created_at::date <= d.window_end
  AND (d.archived_at IS NULL OR d.archived_at::date > d.window_start)
  AND NOT EXISTS (SELECT 1 FROM expiry_reminder_logs l
                  WHERE l.entity_type = d.entity_type AND l.entity_id = d.id AND l.milestone = d.milestone)
ORDER BY d.window_end, d.entity_type, d.what;

-- 3. Cross-check, any step at all: rows written per week across the whole
--    period (all kinds). A run writes rows only when something is due, so an
--    empty week proves nothing on its own; read it next to query 1.
SELECT date_trunc('week', sent_at)::date AS week, entity_type, count(*)
FROM expiry_reminder_logs
WHERE sent_at >= DATE '2026-06-01'
GROUP BY 1, 2
ORDER BY 1, 2;
