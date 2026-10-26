-- READ-ONLY (2026-10-26). Changes nothing.
-- Have expiry reminder emails (insurance, person certificates, permits)
-- actually gone out on prod? Sent by lib/permit-reminders.ts, in-app timer,
-- deployed app only. Every send is logged in email_log (since #137,
-- 2026-10-16) with ref_type 'reminder' and ref_id '<kind>:<record id>:<milestone>'.
-- status: sent / refused at send time; the Resend webhook may later set
-- delivered / bounced / complained.

-- 1. Reminder emails by kind and status, first and last.
SELECT split_part(ref_id, ':', 1) AS kind, status, count(*) AS emails,
       min(created_at) AS first_sent, max(created_at) AS last_sent
FROM email_log
WHERE ref_type = 'reminder'
GROUP BY 1, 2
ORDER BY 1, 2;

-- 2. The 30 most recent reminder emails (subject says what and how close).
SELECT created_at, to_address, subject, status, error, ref_id
FROM email_log
WHERE ref_type = 'reminder'
ORDER BY created_at DESC
LIMIT 30;

-- 3. Milestones recorded as sent (older than email_log: goes back to June).
--    Before #137 a milestone was recorded BEFORE sending, so an old row does
--    not prove an email was accepted; since #137 it does.
SELECT entity_type, count(*) AS milestones, min(sent_at) AS first, max(sent_at) AS last
FROM expiry_reminder_logs
GROUP BY 1
ORDER BY 1;

-- 4. Who would get an insurance or certificate reminder today, per company
--    with something expiring in the next 30 days (or expired in the last 6):
--    the job emails users whose HOME company is that company, role 'admin',
--    email notifications on. Project managers are not emailed.
WITH due AS (
  SELECT s.company_id, 'insurance' AS kind, count(*) AS n
  FROM insurance_records i JOIN subcontractors s ON s.id = i.subcontractor_id
  WHERE i.archived_at IS NULL AND i.expiry_date::date BETWEEN current_date - 6 AND current_date + 30
  GROUP BY 1
  UNION ALL
  SELECT p.company_id, 'person_cert', count(*)
  FROM person_certifications pc JOIN people p ON p.id = pc.person_id
  WHERE pc.archived_at IS NULL AND pc.expiry_date::date BETWEEN current_date - 6 AND current_date + 30
  GROUP BY 1
)
SELECT c.name AS company, d.kind, d.n AS due_items,
       (SELECT count(*) FROM users u WHERE u.company_id = d.company_id AND u.role = 'admin' AND u.email_notifications) AS admins_emailed,
       (SELECT count(*) FROM company_members cm WHERE cm.company_id = d.company_id AND cm.role = 'project_manager') AS pms_not_emailed
FROM due d JOIN companies c ON c.id = d.company_id
ORDER BY c.name, d.kind;

-- 5. (added with the PM recipients change, 2026-10-26) Who gets insurance and
--    certificate reminders per company once it is published: every admin and
--    project manager by company_members, email on, not portal-only.
--    new_recipient = true for people the old rule (home company + role admin)
--    never emailed.
SELECT c.name AS company, u.name, u.email, cm.role,
       NOT (u.company_id = cm.company_id AND u.role = 'admin') AS new_recipient
FROM company_members cm
JOIN users u ON u.id = cm.user_id
JOIN companies c ON c.id = cm.company_id
WHERE cm.role IN ('admin', 'project_manager') AND u.email_notifications AND NOT u.portal_only
ORDER BY c.name, new_recipient DESC, u.name;
