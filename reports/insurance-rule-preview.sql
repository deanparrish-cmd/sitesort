-- READ-ONLY. Run BEFORE publishing #162 (typed certificates, one gate rule).
-- At publish every existing person certificate has no confirmed type, so it
-- stops counting at the gate until a manager confirms it in Compliance,
-- Certificates to confirm. This shows whose gate result changes.
--   OLD rule: any non-archived insurance record of any type, plus person certs
--             whose NAME contains "insur"; none -> held; ANY expired -> held.
--   NEW rule at publish: the LATEST public liability insurance record only
--             (no certificate counts until typed); none or expired -> held.

-- 1. Firms on QR-board projects whose gate result changes at publish.
WITH old_ev AS (
  SELECT ir.subcontractor_id AS sub_id, ir.expiry_date::date AS expiry FROM insurance_records ir WHERE ir.archived_at IS NULL
  UNION ALL
  SELECT p.subcontractor_id, pc.expiry_date::date FROM person_certifications pc JOIN people p ON p.id = pc.person_id
   WHERE pc.archived_at IS NULL AND p.subcontractor_id IS NOT NULL AND pc.name ~* 'insur'
),
old_rule AS (
  SELECT s.id AS sub_id,
         CASE WHEN count(e.expiry) = 0 THEN 'held: none' WHEN bool_or(e.expiry < current_date) THEN 'held: expired' ELSE 'passes' END AS result
    FROM subcontractors s LEFT JOIN old_ev e ON e.sub_id = s.id GROUP BY s.id
),
new_rule AS (
  SELECT s.id AS sub_id,
         CASE WHEN max(ir.expiry_date::date) IS NULL THEN 'held: none'
              WHEN max(ir.expiry_date::date) < current_date THEN 'held: expired' ELSE 'passes' END AS result
    FROM subcontractors s
    LEFT JOIN insurance_records ir ON ir.subcontractor_id = s.id AND ir.archived_at IS NULL AND ir.type = 'public_liability'
   GROUP BY s.id
)
SELECT c.name AS company, s.company_name AS firm, o.result AS today, n.result AS at_publish,
       (SELECT count(*) FROM person_certifications pc JOIN people p ON p.id = pc.person_id
         WHERE p.subcontractor_id = s.id AND pc.archived_at IS NULL) AS certificates_to_confirm
  FROM subcontractors s
  JOIN companies c ON c.id = s.company_id
  JOIN old_rule o ON o.sub_id = s.id
  JOIN new_rule n ON n.sub_id = s.id
 WHERE o.result <> n.result AND s.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM project_members pm JOIN qr_codes q ON q.project_id = pm.project_id
                WHERE pm.subcontractor_id = s.id OR pm.person_id IN (SELECT id FROM people WHERE subcontractor_id = s.id))
 ORDER BY (n.result <> 'passes') DESC, c.name, s.company_name;

-- 2. What Certificates to confirm will list, with the suggested type.
SELECT c.name AS company, p.name AS person, s.company_name AS firm, pc.name AS certificate, pc.expiry_date,
       CASE WHEN pc.name ~* 'employer' THEN 'Employer''s liability'
            WHEN pc.name ~* '(public|\mpli\M|\mpl\M|liabil)' THEN 'Public liability'
            WHEN pc.name ~* 'insur' THEN 'Other insurance'
            ELSE 'Qualification or card' END AS suggested
  FROM person_certifications pc
  JOIN people p ON p.id = pc.person_id
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN subcontractors s ON s.id = p.subcontractor_id
 WHERE pc.archived_at IS NULL AND p.archived_at IS NULL
 ORDER BY c.name, s.company_name NULLS LAST, p.name;
