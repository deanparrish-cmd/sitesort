-- SiteSort PRODUCTION review, all in one (2026-10-09). READ ONLY.
-- This is ONE SELECT statement, so it runs in a single go even in a console
-- that only runs one statement at a time. It writes nothing.
--
-- How to read the result: three columns.
--   section = which check (A1, A2, ... F2, named below)
--   line    = 0 is the section's header row: {"rows": N} = how many rows it found
--             1, 2, 3 ... are the rows themselves, in order
--   data    = the row's columns
-- Every section always has a line 0, so an empty section still shows up as
-- {"rows": 0}. Times are UK local time.
--
-- Combines: portal-only-review (A), prod-access-review (B),
-- checkin-photo-exposure (C), file-link-exposure (D), missing-mobiles (E),
-- amy-checkins-query (F).

WITH
-- ===== A. portal-only-review (#123, updated for #124) =====================

-- A1) Dead admin rows: memberships held by deleted (scrubbed) accounts. They
--     can't log in and don't count as admins. To remove them, send me the
--     membership ids and I'll delete by id only.
a1 AS (
  SELECT row_number() OVER (ORDER BY c.name, m.role) AS n,
         m.id AS membership_id, m.role, c.name AS company, u.id AS user_id, u.email, u.name
  FROM company_members m
  JOIN users u ON u.id = m.user_id
  JOIN companies c ON c.id = m.company_id
  WHERE u.email LIKE 'deleted-%@removed.invalid'
),
-- A2) Dashboard accounts whose every membership is site worker or
--     subcontractor. SHOULD RETURN NOTHING: #123 is published and its boot step
--     makes these portal-only. Any row here means that step didn't run on prod.
a2 AS (
  SELECT row_number() OVER (ORDER BY u.email) AS n,
         u.id, u.email, u.name, string_agg(c.name || ':' || m.role, ', ') AS memberships,
         to_char(u.last_active_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS last_active
  FROM users u
  JOIN company_members m ON m.user_id = u.id
  JOIN companies c ON c.id = m.company_id
  WHERE u.portal_only = false
    AND NOT EXISTS (SELECT 1 FROM company_members x WHERE x.user_id = u.id AND x.role IN ('admin', 'project_manager'))
  GROUP BY u.id, u.email, u.name, u.last_active_at
),
-- A3) PM cover: everyone with the per-project PM cover tick. Since #124 each
--     of them HAS the Team Portal site register for that project and can
--     approve held check-ins there. company_role shows if they're also a
--     company admin/PM. Check this is who you expect.
a3 AS (
  SELECT row_number() OVER (ORDER BY c.name, p.name, u.email) AS n,
         p.name AS project, c.name AS company, u.email, u.name,
         coalesce((SELECT x.role FROM company_members x WHERE x.user_id = u.id AND x.company_id = p.company_id LIMIT 1), '(not a member)') AS company_role,
         u.portal_only
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id
  JOIN companies c ON c.id = p.company_id
  JOIN users u ON u.id = pm.user_id
  WHERE pm.is_project_manager = true
),
-- A4) Named site managers. Since #124 a site manager HAS the Team Portal site
--     register for that project while they're still on the project team
--     (has_register = true). has_register = false means they're named but
--     no longer on the team, so they get nothing.
a4 AS (
  SELECT row_number() OVER (ORDER BY c.name, p.name) AS n,
         p.name AS project, c.name AS company, u.email, u.name,
         coalesce((SELECT x.role FROM company_members x WHERE x.user_id = u.id AND x.company_id = p.company_id LIMIT 1), '(not a member)') AS company_role,
         u.portal_only,
         EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id) AS has_register
  FROM projects p
  JOIN companies c ON c.id = p.company_id
  JOIN users u ON u.id = p.site_manager_id
),

-- ===== B. prod-access-review (#116) =======================================

-- B1) Dashboard logins that are NOT admin or project manager. Since #123 the
--     dashboard is admin/PM only, so this SHOULD RETURN NOTHING (same people
--     as A2, by membership). Nothing records who created these rows.
b1 AS (
  SELECT row_number() OVER (ORDER BY c.name, m.created_at) AS n,
         c.name AS company, u.name, u.email, m.role,
         to_char(m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS joined_company,
         to_char(u.last_active_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS last_active,
         u.email_verified
  FROM company_members m
  JOIN users u ON u.id = m.user_id
  JOIN companies c ON c.id = m.company_id
  WHERE m.role NOT IN ('admin', 'project_manager') AND u.portal_only = false
),
-- B2) Every admin and project manager, newest first. Anyone you don't
--     recognise, or who became admin unexpectedly, is the thing to look at.
b2 AS (
  SELECT row_number() OVER (ORDER BY m.created_at DESC) AS n,
         c.name AS company, u.name, u.email, m.role,
         to_char(m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS joined_company,
         to_char(u.last_active_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS last_active
  FROM company_members m
  JOIN users u ON u.id = m.user_id
  JOIN companies c ON c.id = m.company_id
  WHERE m.role IN ('admin', 'project_manager')
),
-- B3) Insurance records (current and archived), newest first: any you or your
--     PMs didn't upload?
b3 AS (
  SELECT row_number() OVER (ORDER BY i.created_at DESC) AS n,
         c.name AS company, s.company_name AS contact_company, s.contact_name, i.type,
         i.expiry_date,
         to_char(i.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS filed,
         CASE WHEN i.archived_at IS NULL THEN 'current' ELSE 'archived' END AS state,
         i.certificate_url
  FROM insurance_records i
  JOIN subcontractors s ON s.id = i.subcontractor_id
  JOIN companies c ON c.id = s.company_id
),
-- B4) What is pinned to each PUBLIC site board, newest first.
b4 AS (
  SELECT row_number() OVER (ORDER BY b.pinned_at DESC) AS n,
         p.name AS project, b.item_type, b.item_id,
         to_char(b.pinned_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS pinned
  FROM qr_board_pins b
  JOIN projects p ON p.id = b.project_id
),
-- B5) Count of logins per company and role (overall picture).
b5 AS (
  SELECT row_number() OVER (ORDER BY c.name, m.role, u.portal_only) AS n,
         c.name AS company, m.role, u.portal_only, count(*) AS logins
  FROM company_members m
  JOIN users u ON u.id = m.user_id
  JOIN companies c ON c.id = m.company_id
  GROUP BY c.name, m.role, u.portal_only
),

-- ===== C. checkin-photo-exposure (#119) ===================================
-- Where check-in photos (workers' faces) could have left SiteSort before #119
-- made their URLs signed and expiring. "Copy link" was never logged, so these
-- counts are a lower bound.

-- C1) Check-in photos shared by email / WhatsApp (share dialog logged them as
--     entity_type 'photo' with the CHECK-IN id).
c1 AS (
  SELECT row_number() OVER (ORDER BY sl.created_at) AS n,
         to_char(sl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS shared_at,
         sl.method, sl.recipient_info, sl.entity_name,
         u.name AS shared_by, p.name AS project
  FROM share_logs sl
  JOIN site_checkins sc ON sc.id = sl.entity_id
  LEFT JOIN users u ON u.id = sl.sent_by_user_id
  LEFT JOIN projects p ON p.id = sc.project_id
),
-- C2) Team Portal shares and QR board pins made with a check-in id. These
--     never resolved to the photo, listed so they can be cleaned up.
c2 AS (
  SELECT row_number() OVER (ORDER BY at) AS n, kind,
         to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS at_uk, item_id
  FROM (
    SELECT 'portal_share' AS kind, ps.created_at AS at, ps.item_id FROM portal_shares ps JOIN site_checkins sc ON sc.id = ps.item_id
    UNION ALL
    SELECT 'qr_pin', qp.pinned_at, qp.item_id FROM qr_board_pins qp JOIN site_checkins sc ON sc.id = qp.item_id
  ) x
),
-- C3) Check-in photo filenames pasted into any other stored record.
c3 AS (
  SELECT row_number() OVER (ORDER BY t, id) AS n, t AS found_in, id
  FROM (
    SELECT 'photos' AS t, id FROM photos WHERE photo_url LIKE '%/uploads/checkin-%'
    UNION ALL SELECT 'daily_notes', id FROM daily_notes WHERE photo_url LIKE '%/uploads/checkin-%'
    UNION ALL SELECT 'documents', id FROM documents WHERE file_url LIKE '%/uploads/checkin-%'
    UNION ALL SELECT 'messages', id FROM messages WHERE content LIKE '%/uploads/checkin-%'
    UNION ALL SELECT 'channel_messages', id FROM channel_messages WHERE content LIKE '%/uploads/checkin-%'
  ) x
),
-- C4) Scale: how many check-ins (with photos) exist, per company.
c4 AS (
  SELECT row_number() OVER (ORDER BY count(*) DESC) AS n,
         c.name AS company, count(*) AS checkin_photos,
         to_char(min(sc.checked_in_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY') AS first,
         to_char(max(sc.checked_in_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY') AS last
  FROM site_checkins sc JOIN projects p ON p.id = sc.project_id JOIN companies c ON c.id = p.company_id
  GROUP BY c.name
),

-- ===== D. file-link-exposure ==============================================
-- What we CAN know about file links leaving SiteSort. "Copy link" was never
-- logged; a logged share only means the button was pressed; request logs don't
-- record who fetched a file.

-- D1) Email / WhatsApp shares from the Share dialog, by kind of item.
d1 AS (
  SELECT row_number() OVER (ORDER BY count(*) DESC) AS n,
         entity_type, method, count(*) AS shares,
         to_char(min(created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY') AS first,
         to_char(max(created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY') AS last
  FROM share_logs GROUP BY entity_type, method
),
-- D2) Every individual email / WhatsApp share (who sent what, when), newest first.
d2 AS (
  SELECT row_number() OVER (ORDER BY sl.created_at DESC) AS n,
         to_char(sl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS shared_at,
         sl.entity_type, sl.entity_name, sl.method, sl.recipient_info, u.name AS sent_by, c.name AS company
  FROM share_logs sl
  LEFT JOIN users u ON u.id = sl.sent_by_user_id
  LEFT JOIN companies c ON c.id = sl.company_id
  WHERE sl.method IN ('email', 'whatsapp')
),
-- D3) Documents emailed through distribution (tracked open link).
d3 AS (
  SELECT 1 AS n, count(*) AS distributions, count(viewed_at) AS opened FROM document_distributions
),
-- D4) Files pinned to a public QR board, by type (public by design while pinned).
d4 AS (
  SELECT row_number() OVER (ORDER BY item_type) AS n, item_type, count(*) AS pinned
  FROM qr_board_pins GROUP BY item_type
),
-- D5) INVOICE COUNT for the deletion job. Invoices feature is removed and the
--     attachment links already answer 410 (#121); this sizes deleting the
--     files, rows and table.
d5 AS (
  SELECT 1 AS n, count(*) AS invoices, count(attachment_url) AS with_attachment FROM invoices
),
-- D6) Size of each file group, to size the login-only links job.
d6 AS (
  SELECT row_number() OVER () AS n, kind, files
  FROM (
    SELECT 'insurance_certs' AS kind, count(certificate_url) AS files FROM insurance_records
    UNION ALL SELECT 'person_certifications', count(document_url) FROM person_certifications
    UNION ALL SELECT 'subcontractor_documents', count(file_url) FROM subcontractor_documents
    UNION ALL SELECT 'portal_member_documents', count(file_url) FROM portal_member_documents
    UNION ALL SELECT 'project_documents', count(file_url) FROM documents
    UNION ALL SELECT 'permit_documents', count(document_url) FROM permits
    UNION ALL SELECT 'plant_attachments', count(file_url) FROM plant_item_attachments
    UNION ALL SELECT 'site_issue_photos', count(photo_url) FROM photos
    UNION ALL SELECT 'daily_note_photos', count(photo_url) FROM daily_notes
  ) x
),

-- ===== E. missing-mobiles (#124) ==========================================
-- People who can sign in at a QR board with no mobile on file (they get held
-- at sign-in). Same phone sources as sign-out: person.phone, their linked
-- user's phone, the contact card's phone for a primary contact. Live
-- (not complete) projects only.

e1_reg AS (
  SELECT DISTINCT p.company_id, pe.id AS person_id,
         coalesce(nullif(regexp_replace(pe.phone, '\D', '', 'g'), ''),
                  nullif(regexp_replace(u.phone, '\D', '', 'g'), ''),
                  CASE WHEN pe.is_primary_contact THEN nullif(regexp_replace(s.contact_phone, '\D', '', 'g'), '') END) AS digits
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id AND p.status <> 'complete'
  JOIN people pe ON pe.id = pm.person_id AND pe.archived_at IS NULL
  LEFT JOIN users u ON u.id = pe.user_id
  LEFT JOIN subcontractors s ON s.id = pe.subcontractor_id
),
-- E1) Per company: people on live projects, and how many have no usable number.
e1 AS (
  SELECT row_number() OVER (ORDER BY count(*) FILTER (WHERE digits IS NULL OR length(digits) < 9) DESC, c.name) AS n,
         c.name AS company,
         count(*) AS people_on_live_projects,
         count(*) FILTER (WHERE digits IS NULL OR length(digits) < 9) AS no_mobile
  FROM e1_reg JOIN companies c ON c.id = e1_reg.company_id
  GROUP BY c.name
),
-- E2) Contact cards on live projects with no contact phone.
e2 AS (
  SELECT row_number() OVER (ORDER BY count(DISTINCT s.id) FILTER (WHERE coalesce(length(regexp_replace(s.contact_phone, '\D', '', 'g')), 0) < 9) DESC, c.name) AS n,
         c.name AS company, count(DISTINCT s.id) AS cards_on_live_projects,
         count(DISTINCT s.id) FILTER (WHERE coalesce(length(regexp_replace(s.contact_phone, '\D', '', 'g')), 0) < 9) AS no_phone
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id AND p.status <> 'complete'
  JOIN subcontractors s ON s.id = pm.subcontractor_id
  JOIN companies c ON c.id = p.company_id
  GROUP BY c.name
),

-- ===== F. amy-checkins-query ==============================================

-- F1) Possible duplicate identities: every check-in for anyone named Amy... or
--     Dean... across ALL projects, open rows (still on site) first.
f1 AS (
  SELECT row_number() OVER (ORDER BY CASE WHEN lower(c.worker_name) LIKE 'amy%' THEN 'AMY' ELSE 'DEAN' END,
                                     (c.checked_out_at IS NULL) DESC, c.checked_in_at DESC) AS n,
    CASE WHEN lower(c.worker_name) LIKE 'amy%' THEN 'AMY' ELSE 'DEAN' END AS who,
    CASE
      WHEN c.checked_out_at IS NOT NULL THEN 'closed'
      WHEN c.checkout_method = 'legacy' THEN 'old, before sign-out existed'
      ELSE 'OPEN (counted on site)'
    END AS state,
    p.name AS project,
    to_char(c.checked_in_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS checked_in_uk,
    to_char(c.checked_out_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'DD Mon YYYY HH24:MI') AS checked_out_uk,
    c.checkout_method AS how_signed_out,
    c.worker_name AS name_as_typed,
    COALESCE(c.company_name, '(none)') AS company_as_typed,
    COALESCE(c.person_key, '(none: no identity link)') AS identity_link,
    c.id AS row_id
  FROM site_checkins c
  JOIN projects p ON p.id = c.project_id
  WHERE lower(c.worker_name) LIKE 'amy%'
     OR lower(c.worker_name) LIKE 'dean%'
     OR c.person_key IN (
          SELECT 'person:' || id FROM people WHERE lower(name) LIKE 'amy%' OR lower(name) LIKE 'dean%'
          UNION SELECT 'user:' || id FROM users WHERE lower(name) LIKE 'amy%' OR lower(name) LIKE 'dean%'
        )
),
-- F2) The double check-in question: Dean's rows on 18 Sep 2026 between 19:45
--     and 20:05 UK time. If the 19:52 row has a checked_out_uk before 19:54,
--     it was a sign-out then a new check-in.
f2 AS (
  SELECT row_number() OVER (ORDER BY c.checked_in_at) AS n,
    to_char(c.checked_in_at  AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI:SS') AS checked_in_uk,
    to_char(c.checked_out_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI:SS') AS checked_out_uk,
    c.checkout_method AS how_signed_out,
    c.worker_name, c.company_name, p.name AS project, c.id AS row_id
  FROM site_checkins c
  JOIN projects p ON p.id = c.project_id
  WHERE lower(c.worker_name) LIKE 'dean%'
    AND c.checked_in_at >= '2026-09-18 18:45:00' AND c.checked_in_at < '2026-09-18 19:05:00'
),

-- ===== Output: one labelled list ==========================================
out AS (
            SELECT 'A1 dead admin rows (send ids to delete)' AS section, 0::bigint AS line, jsonb_build_object('rows', (SELECT count(*) FROM a1)) AS data
  UNION ALL SELECT 'A1 dead admin rows (send ids to delete)', n, to_jsonb(a1) - 'n' FROM a1
  UNION ALL SELECT 'A2 site-worker-only dashboard logins (EXPECT 0)', 0, jsonb_build_object('rows', (SELECT count(*) FROM a2))
  UNION ALL SELECT 'A2 site-worker-only dashboard logins (EXPECT 0)', n, to_jsonb(a2) - 'n' FROM a2
  UNION ALL SELECT 'A3 PM cover = portal register access', 0, jsonb_build_object('rows', (SELECT count(*) FROM a3))
  UNION ALL SELECT 'A3 PM cover = portal register access', n, to_jsonb(a3) - 'n' FROM a3
  UNION ALL SELECT 'A4 site managers (has_register = portal register)', 0, jsonb_build_object('rows', (SELECT count(*) FROM a4))
  UNION ALL SELECT 'A4 site managers (has_register = portal register)', n, to_jsonb(a4) - 'n' FROM a4
  UNION ALL SELECT 'B1 non-admin/PM dashboard memberships (EXPECT 0)', 0, jsonb_build_object('rows', (SELECT count(*) FROM b1))
  UNION ALL SELECT 'B1 non-admin/PM dashboard memberships (EXPECT 0)', n, to_jsonb(b1) - 'n' FROM b1
  UNION ALL SELECT 'B2 admins and PMs, newest first', 0, jsonb_build_object('rows', (SELECT count(*) FROM b2))
  UNION ALL SELECT 'B2 admins and PMs, newest first', n, to_jsonb(b2) - 'n' FROM b2
  UNION ALL SELECT 'B3 insurance records, newest first', 0, jsonb_build_object('rows', (SELECT count(*) FROM b3))
  UNION ALL SELECT 'B3 insurance records, newest first', n, to_jsonb(b3) - 'n' FROM b3
  UNION ALL SELECT 'B4 public site board pins', 0, jsonb_build_object('rows', (SELECT count(*) FROM b4))
  UNION ALL SELECT 'B4 public site board pins', n, to_jsonb(b4) - 'n' FROM b4
  UNION ALL SELECT 'B5 logins per company and role', 0, jsonb_build_object('rows', (SELECT count(*) FROM b5))
  UNION ALL SELECT 'B5 logins per company and role', n, to_jsonb(b5) - 'n' FROM b5
  UNION ALL SELECT 'C1 check-in photos shared by email/WhatsApp', 0, jsonb_build_object('rows', (SELECT count(*) FROM c1))
  UNION ALL SELECT 'C1 check-in photos shared by email/WhatsApp', n, to_jsonb(c1) - 'n' FROM c1
  UNION ALL SELECT 'C2 portal shares / board pins with a check-in id', 0, jsonb_build_object('rows', (SELECT count(*) FROM c2))
  UNION ALL SELECT 'C2 portal shares / board pins with a check-in id', n, to_jsonb(c2) - 'n' FROM c2
  UNION ALL SELECT 'C3 check-in photo links pasted elsewhere', 0, jsonb_build_object('rows', (SELECT count(*) FROM c3))
  UNION ALL SELECT 'C3 check-in photo links pasted elsewhere', n, to_jsonb(c3) - 'n' FROM c3
  UNION ALL SELECT 'C4 check-in photos per company', 0, jsonb_build_object('rows', (SELECT count(*) FROM c4))
  UNION ALL SELECT 'C4 check-in photos per company', n, to_jsonb(c4) - 'n' FROM c4
  UNION ALL SELECT 'D1 shares by item kind and method', 0, jsonb_build_object('rows', (SELECT count(*) FROM d1))
  UNION ALL SELECT 'D1 shares by item kind and method', n, to_jsonb(d1) - 'n' FROM d1
  UNION ALL SELECT 'D2 every email/WhatsApp share, newest first', 0, jsonb_build_object('rows', (SELECT count(*) FROM d2))
  UNION ALL SELECT 'D2 every email/WhatsApp share, newest first', n, to_jsonb(d2) - 'n' FROM d2
  UNION ALL SELECT 'D3 document distributions', 0, jsonb_build_object('rows', (SELECT count(*) FROM d3))
  UNION ALL SELECT 'D3 document distributions', n, to_jsonb(d3) - 'n' FROM d3
  UNION ALL SELECT 'D4 public board pins by type', 0, jsonb_build_object('rows', (SELECT count(*) FROM d4))
  UNION ALL SELECT 'D4 public board pins by type', n, to_jsonb(d4) - 'n' FROM d4
  UNION ALL SELECT 'D5 INVOICE COUNT (for deletion)', 0, jsonb_build_object('rows', (SELECT count(*) FROM d5))
  UNION ALL SELECT 'D5 INVOICE COUNT (for deletion)', n, to_jsonb(d5) - 'n' FROM d5
  UNION ALL SELECT 'D6 files per group', 0, jsonb_build_object('rows', (SELECT count(*) FROM d6))
  UNION ALL SELECT 'D6 files per group', n, to_jsonb(d6) - 'n' FROM d6
  UNION ALL SELECT 'E1 people on live projects with no mobile', 0, jsonb_build_object('rows', (SELECT count(*) FROM e1))
  UNION ALL SELECT 'E1 people on live projects with no mobile', n, to_jsonb(e1) - 'n' FROM e1
  UNION ALL SELECT 'E2 contact cards on live projects with no phone', 0, jsonb_build_object('rows', (SELECT count(*) FROM e2))
  UNION ALL SELECT 'E2 contact cards on live projects with no phone', n, to_jsonb(e2) - 'n' FROM e2
  UNION ALL SELECT 'F1 Amy/Dean check-ins', 0, jsonb_build_object('rows', (SELECT count(*) FROM f1))
  UNION ALL SELECT 'F1 Amy/Dean check-ins', n, to_jsonb(f1) - 'n' FROM f1
  UNION ALL SELECT 'F2 Dean 18 Sep 19:45 to 20:05', 0, jsonb_build_object('rows', (SELECT count(*) FROM f2))
  UNION ALL SELECT 'F2 Dean 18 Sep 19:45 to 20:05', n, to_jsonb(f2) - 'n' FROM f2
)
SELECT section, line, data FROM out ORDER BY section, line;
