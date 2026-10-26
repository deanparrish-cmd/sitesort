-- READ-ONLY (2026-10-26). Changes nothing.
-- When was Amy Parrish's PI (public liability) insurance record created, and
-- were any reminder steps due before it existed? Looks in both places a PI
-- record can live: a certificate on her person card (person_certifications),
-- and an insurance record on a firm whose name or contact matches her
-- (insurance_records). Archived ones included, so a replaced record shows too.
--
-- Steps (lib/permit-reminders.ts): '30' due while 22 to 30 days are left,
-- '21' 15 to 21, '14' 8 to 14, '7' 2 to 7, '1' on the last day.
-- A step whose window closed before the record was created was never due.
-- A step whose window was still open on the creation day WAS due (it goes
-- out on the first run after creation), so "created after X" alone doesn't
-- settle it: query 2 works it out per step.

-- 1. The records.
SELECT 'person_cert' AS kind, pc.id, pe.name AS person, pc.name AS record, pc.cert_type,
       pc.expiry_date, pc.created_at, pc.archived_at
FROM person_certifications pc JOIN people pe ON pe.id = pc.person_id
WHERE pe.name ILIKE '%amy%parrish%' OR (pe.first_name ILIKE 'amy%' AND pe.last_name ILIKE 'parrish%')
UNION ALL
SELECT 'insurance', i.id, s.company_name, i.type, NULL,
       i.expiry_date, i.created_at, i.archived_at
FROM insurance_records i JOIN subcontractors s ON s.id = i.subcontractor_id
WHERE s.company_name ILIKE '%parrish%'
   OR (coalesce(s.contact_first_name, '') ILIKE 'amy%' AND coalesce(s.contact_last_name, '') ILIKE 'parrish%')
ORDER BY created_at;

-- 2. Per record and step: the window, whether it was still open when the
--    record was created, and whether a reminder row exists.
WITH recs AS (
  SELECT 'person_cert' AS kind, pc.id, pc.name AS record, pc.expiry_date, pc.created_at
  FROM person_certifications pc JOIN people pe ON pe.id = pc.person_id
  WHERE pe.name ILIKE '%amy%parrish%' OR (pe.first_name ILIKE 'amy%' AND pe.last_name ILIKE 'parrish%')
  UNION ALL
  SELECT 'insurance', i.id, s.company_name || ' ' || i.type, i.expiry_date, i.created_at
  FROM insurance_records i JOIN subcontractors s ON s.id = i.subcontractor_id
  WHERE s.company_name ILIKE '%parrish%'
     OR (coalesce(s.contact_first_name, '') ILIKE 'amy%' AND coalesce(s.contact_last_name, '') ILIKE 'parrish%')
),
steps(milestone, lo, hi) AS (VALUES ('30', 22, 30), ('21', 15, 21), ('14', 8, 14), ('7', 2, 7), ('1', 1, 1))
SELECT r.kind, r.record, r.expiry_date, r.created_at::date AS created_on, s.milestone,
       r.expiry_date - s.hi AS window_start, r.expiry_date - s.lo AS window_end,
       CASE WHEN r.expiry_date - s.lo < r.created_at::date THEN 'closed before the record existed: never due'
            WHEN r.expiry_date - s.hi > current_date THEN 'not yet'
            ELSE 'due' END AS verdict,
       (SELECT min(l.sent_at) FROM expiry_reminder_logs l
        WHERE l.entity_type = r.kind AND l.entity_id = r.id AND l.milestone = s.milestone) AS row_written_at
FROM recs r CROSS JOIN steps s
ORDER BY r.created_at, r.id, s.hi DESC;
