-- How many people who can sign in at a QR board have no mobile on file?
-- READ ONLY. Mirrors the phone sources sign-out already uses (phonesForKey):
-- person.phone, their linked user's phone, and the contact card's phone for a
-- primary contact. Only projects that are not complete.

-- 1) Per company: people on live projects, and how many have no usable number.
WITH reg AS (
  SELECT DISTINCT p.company_id, pe.id AS person_id,
         coalesce(nullif(regexp_replace(pe.phone, '\D', '', 'g'), ''),
                  nullif(regexp_replace(u.phone, '\D', '', 'g'), ''),
                  CASE WHEN pe.is_primary_contact THEN nullif(regexp_replace(s.contact_phone, '\D', '', 'g'), '') END) AS digits
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id AND p.status <> 'complete'
  JOIN people pe ON pe.id = pm.person_id AND pe.archived_at IS NULL
  LEFT JOIN users u ON u.id = pe.user_id
  LEFT JOIN subcontractors s ON s.id = pe.subcontractor_id
)
SELECT c.name AS company,
       count(*) AS people_on_live_projects,
       count(*) FILTER (WHERE digits IS NULL OR length(digits) < 9) AS no_mobile
FROM reg JOIN companies c ON c.id = reg.company_id
GROUP BY c.name ORDER BY no_mobile DESC;

-- 2) Contact cards on live projects with no contact phone.
SELECT c.name AS company, count(DISTINCT s.id) AS cards_on_live_projects,
       count(DISTINCT s.id) FILTER (WHERE coalesce(length(regexp_replace(s.contact_phone, '\D', '', 'g')), 0) < 9) AS no_phone
FROM project_members pm
JOIN projects p ON p.id = pm.project_id AND p.status <> 'complete'
JOIN subcontractors s ON s.id = pm.subcontractor_id
JOIN companies c ON c.id = p.company_id
GROUP BY c.name ORDER BY no_phone DESC;
