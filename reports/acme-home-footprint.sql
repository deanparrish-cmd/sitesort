-- Read-only (SELECT only). Run on PROD before deleting Acme Construction
-- (2026-10-20). One row per account whose HOME company (users.company_id) is
-- Acme, with what it holds in OTHER companies. The delete removes every
-- membership these accounts hold anywhere; any account with a non-zero
-- message/upload count elsewhere cannot be deleted and is anonymised instead
-- (email tombstoned, password scrambled, re-homed, no memberships).
-- Safe to delete = every count column 0 and every name column empty.
WITH acme AS (SELECT id FROM companies WHERE name = 'Acme Construction'),
u AS (SELECT u.* FROM users u WHERE u.company_id IN (SELECT id FROM acme))
SELECT u.email, u.portal_only,
  (SELECT string_agg(DISTINCT c.name || ' (' || cm.role || ')', ', ') FROM company_members cm
     JOIN companies c ON c.id = cm.company_id
     WHERE cm.user_id = u.id AND cm.company_id <> u.company_id) AS other_company_memberships,
  (SELECT string_agg(DISTINCT c.name || ': ' || p.name, ', ') FROM project_members pm
     JOIN projects p ON p.id = pm.project_id JOIN companies c ON c.id = p.company_id
     WHERE pm.user_id = u.id AND p.company_id <> u.company_id) AS other_company_projects,
  (SELECT string_agg(DISTINCT c.name || ': ' || pe.name, ', ') FROM people pe
     JOIN companies c ON c.id = pe.company_id
     WHERE pe.user_id = u.id AND pe.company_id <> u.company_id) AS contact_cards_elsewhere,
  (SELECT count(*) FROM messages m WHERE (m.sender_id = u.id OR m.recipient_id = u.id)
     AND m.company_id <> u.company_id) AS dms_elsewhere,
  (SELECT count(*) FROM channel_messages cmsg WHERE cmsg.sender_id = u.id
     AND cmsg.company_id <> u.company_id) AS channel_posts_elsewhere,
  (SELECT count(*) FROM documents d JOIN projects p ON p.id = d.project_id
     WHERE d.uploaded_by = u.id AND p.company_id <> u.company_id)
  + (SELECT count(*) FROM photos ph JOIN projects p ON p.id = ph.project_id
     WHERE ph.uploaded_by = u.id AND p.company_id <> u.company_id)
  + (SELECT count(*) FROM subcontractor_documents sd JOIN subcontractors s ON s.id = sd.subcontractor_id
     WHERE sd.uploaded_by = u.id AND s.company_id <> u.company_id)
  + (SELECT count(*) FROM plant_item_attachments pa JOIN plant_items pi ON pi.id = pa.plant_item_id
     JOIN projects p ON p.id = pi.project_id
     WHERE pa.uploaded_by = u.id AND p.company_id <> u.company_id) AS uploads_elsewhere,
  (SELECT count(*) FROM daily_notes dn JOIN projects p ON p.id = dn.project_id
     WHERE dn.author_id = u.id AND p.company_id <> u.company_id)
  + (SELECT count(*) FROM plant_items pi JOIN projects p ON p.id = pi.project_id
     WHERE pi.created_by = u.id AND p.company_id <> u.company_id) AS other_content_elsewhere
FROM u
ORDER BY u.portal_only, u.email;
