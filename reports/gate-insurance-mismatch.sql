-- READ-ONLY. Gate insurance check vs what the contact card shows (2026-10-22).
-- The gate (lib/insurance.ts subcontractorInsuranceStatus) checks the FIRM
-- (subcontractor) the matched person belongs to:
--   evidence = insurance_records of that firm (any type, not archived)
--            + person_certifications of the firm's people whose NAME contains "insur"
--   none -> held "no insurance on file"; any expired -> held "expired"
-- A person certification named "Public liability" or "PLI" is NOT counted.

-- 1. Dean: his cards, the firm the gate checks, what the gate sees, and his certs.
SELECT p.id AS person_id, p.name, p.email, s.company_name AS firm, p.subcontractor_id,
       (SELECT count(*) FROM insurance_records ir WHERE ir.subcontractor_id = p.subcontractor_id AND ir.archived_at IS NULL) AS firm_insurance_records,
       pc.name AS cert_name, pc.expiry_date AS cert_expiry, (pc.name ~* 'insur') AS gate_counts_this_cert
  FROM people p
  LEFT JOIN subcontractors s ON s.id = p.subcontractor_id
  LEFT JOIN person_certifications pc ON pc.person_id = p.id AND pc.archived_at IS NULL
 WHERE p.name ILIKE '%dean%parrish%' OR p.email ILIKE 'dean.parrish%'
 ORDER BY p.name, pc.expiry_date;

-- 2. Everyone with an in-date certification on their card whose firm the gate
--    would hold ("none" or "expired"), on a project that uses the QR board.
WITH firm_evidence AS (
  SELECT ir.subcontractor_id AS sub_id, ir.expiry_date::date AS expiry, 'insurance record (' || ir.type || ')' AS what
    FROM insurance_records ir WHERE ir.archived_at IS NULL
  UNION ALL
  SELECT p.subcontractor_id, pc.expiry_date::date, 'person cert "' || pc.name || '"'
    FROM person_certifications pc JOIN people p ON p.id = pc.person_id
   WHERE pc.archived_at IS NULL AND p.subcontractor_id IS NOT NULL AND pc.name ~* 'insur'
),
gate AS (
  SELECT s.id AS sub_id,
         CASE WHEN count(fe.expiry) = 0 THEN 'held: no insurance on file'
              WHEN bool_or(fe.expiry < current_date) THEN 'held: expired'
              ELSE 'passes' END AS gate_result
    FROM subcontractors s LEFT JOIN firm_evidence fe ON fe.sub_id = s.id
   GROUP BY s.id
)
SELECT c.name AS company, s.company_name AS firm, p.name AS person, g.gate_result,
       string_agg(DISTINCT pc.name || ' to ' || pc.expiry_date, '; ') AS in_date_certs_on_card,
       string_agg(DISTINCT pr.name, '; ') AS qr_projects
  FROM people p
  JOIN subcontractors s ON s.id = p.subcontractor_id
  JOIN companies c ON c.id = s.company_id
  JOIN gate g ON g.sub_id = s.id
  JOIN person_certifications pc ON pc.person_id = p.id AND pc.archived_at IS NULL AND pc.expiry_date::date >= current_date
  JOIN project_members pm ON (pm.person_id = p.id OR pm.subcontractor_id = s.id)
  JOIN projects pr ON pr.id = pm.project_id AND EXISTS (SELECT 1 FROM qr_codes q WHERE q.project_id = pr.id)
 WHERE p.archived_at IS NULL AND g.gate_result <> 'passes'
 GROUP BY c.name, s.company_name, p.name, g.gate_result
 ORDER BY c.name, s.company_name, p.name;

-- 3. Firms held as "expired" although they ALSO have an in-date record
--    (an old certificate never archived blocks a current one).
SELECT s.company_name AS firm,
       count(*) FILTER (WHERE ir.expiry_date::date < current_date) AS expired_records,
       count(*) FILTER (WHERE ir.expiry_date::date >= current_date) AS in_date_records,
       max(ir.expiry_date) AS latest_expiry
  FROM insurance_records ir JOIN subcontractors s ON s.id = ir.subcontractor_id
 WHERE ir.archived_at IS NULL
 GROUP BY s.id, s.company_name
HAVING count(*) FILTER (WHERE ir.expiry_date::date < current_date) > 0
   AND count(*) FILTER (WHERE ir.expiry_date::date >= current_date) > 0
 ORDER BY s.company_name;
