-- READ-ONLY. Why did the QR gate clear Amy and Annabelle (2026-10-22) while
-- their cards say "Gate: will hold"? The gate runs the insurance rule ONLY when
-- the identity it matched carries a contact card (insuranceSubId). This shows
-- which identity each check-in matched (person_key) and whether that identity
-- has a firm. Run each query on its own in the Replit SQL console.

-- 1. Today's check-ins for them: person_key says which record the gate matched.
SELECT c.id, c.project_id, c.worker_name, c.company_name, c.person_key,
       c.hold_reason, c.hold_status, c.checked_in_at
FROM site_checkins c
WHERE c.checked_in_at > now() - interval '2 days'
  AND (c.worker_name ILIKE 'amy%' OR c.worker_name ILIKE 'annabelle%')
ORDER BY c.checked_in_at DESC;

-- 2. What that matched identity is. kind = user / person / sub.
--    person_firm or user_card_firm NULL = treated as in-house staff = NO insurance check.
SELECT DISTINCT c.person_key,
       split_part(c.person_key, ':', 1) AS kind,
       p.name AS person_name, p.subcontractor_id AS person_firm, p.user_id AS person_login,
       u.email AS user_email,
       (SELECT string_agg(coalesce(pm.subcontractor_id, pp.subcontractor_id)::text, ',')
          FROM project_members pm LEFT JOIN people pp ON pp.id = pm.person_id
         WHERE pm.project_id = c.project_id AND pm.user_id = u.id) AS user_card_firm
FROM site_checkins c
LEFT JOIN people p ON split_part(c.person_key, ':', 1) = 'person' AND p.id::text = split_part(c.person_key, ':', 2)
LEFT JOIN users  u ON split_part(c.person_key, ':', 1) = 'user'   AND u.id::text = split_part(c.person_key, ':', 2)
WHERE c.checked_in_at > now() - interval '2 days'
  AND (c.worker_name ILIKE 'amy%' OR c.worker_name ILIKE 'annabelle%');

-- 3. Every card row on those projects for their logins / people: the Team tab
--    card judges people.subcontractor_id; the gate's login record judges
--    coalesce(project_members.subcontractor_id, people.subcontractor_id).
--    Different firms here, or a row with no firm at all, is the disagreement.
SELECT pm.id AS member_row, pm.project_id, pm.user_id, u.email, u.phone AS login_phone,
       pm.person_id, p.name, p.phone AS person_phone,
       pm.subcontractor_id AS row_firm, p.subcontractor_id AS person_firm,
       s.company_name AS person_firm_name, s.contact_phone AS card_phone
FROM project_members pm
LEFT JOIN users u ON u.id = pm.user_id
LEFT JOIN people p ON p.id = pm.person_id
LEFT JOIN subcontractors s ON s.id = p.subcontractor_id
WHERE pm.project_id IN (SELECT project_id FROM site_checkins
                         WHERE checked_in_at > now() - interval '2 days'
                           AND (worker_name ILIKE 'amy%' OR worker_name ILIKE 'annabelle%'))
  AND (p.name ILIKE 'amy%' OR p.name ILIKE 'annabelle%' OR u.name ILIKE 'amy%' OR u.name ILIKE 'annabelle%')
ORDER BY pm.project_id, p.name;
