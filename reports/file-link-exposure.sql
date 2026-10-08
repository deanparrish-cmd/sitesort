-- Read-only. Run against PROD. What we CAN know about file links leaving
-- SiteSort. Limits: "Copy link" was never logged; a logged share only means the
-- button was pressed (we can't see what happened in WhatsApp/email after); the
-- server's request logs don't record IP or who fetched a file.

-- 1. Email / WhatsApp shares from the Share dialog, by kind of item.
SELECT entity_type, method, count(*) AS shares, min(created_at) AS first, max(created_at) AS last
FROM share_logs GROUP BY 1, 2 ORDER BY 3 DESC;

-- 2. The individual external shares of the sensitive kinds (who sent what, when).
SELECT sl.created_at, sl.entity_type, sl.entity_name, sl.method, sl.recipient_info, u.name AS sent_by, c.name AS company
FROM share_logs sl
LEFT JOIN users u ON u.id = sl.sent_by_user_id
LEFT JOIN companies c ON c.id = sl.company_id
WHERE sl.method IN ('email', 'whatsapp')
ORDER BY sl.created_at DESC;

-- 3. Documents emailed through distribution (tracked open link goes to the
--    recipient's inbox; recipients are company users).
SELECT count(*) AS distributions, count(viewed_at) AS opened FROM document_distributions;

-- 4. Files pinned to a public QR board (public by design while pinned).
SELECT item_type, count(*) FROM qr_board_pins GROUP BY 1;

-- 5. Invoice attachments still in the database and storage although the
--    invoices feature was removed (commit bebe715); their links still open.
SELECT count(*) AS invoices, count(attachment_url) AS with_attachment FROM invoices;

-- 6. Size of each file group, so the job can be sized.
SELECT 'insurance_certs' AS kind, count(certificate_url) FROM insurance_records
UNION ALL SELECT 'person_certifications', count(document_url) FROM person_certifications
UNION ALL SELECT 'subcontractor_documents', count(file_url) FROM subcontractor_documents
UNION ALL SELECT 'portal_member_documents', count(file_url) FROM portal_member_documents
UNION ALL SELECT 'project_documents', count(file_url) FROM documents
UNION ALL SELECT 'permit_documents', count(document_url) FROM permits
UNION ALL SELECT 'plant_attachments', count(file_url) FROM plant_item_attachments
UNION ALL SELECT 'site_issue_photos', count(photo_url) FROM photos
UNION ALL SELECT 'daily_note_photos', count(photo_url) FROM daily_notes;
