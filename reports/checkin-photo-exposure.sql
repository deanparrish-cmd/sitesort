-- Read-only. Run against PROD to see where check-in photos (workers' faces)
-- could have left SiteSort before #119 made their URLs signed + expiring.
-- Note: "Copy link" in the share dialog was never logged, so these counts are a
-- lower bound.

-- 1. Check-in photos shared by email / WhatsApp from the Check-Ins page or the
--    project Check-ins tab (share dialog logged them as entity_type 'photo' with
--    the CHECK-IN id).
SELECT sl.created_at, sl.method, sl.recipient_info, sl.entity_name,
       u.name AS shared_by, p.name AS project
FROM share_logs sl
JOIN site_checkins sc ON sc.id = sl.entity_id
LEFT JOIN users u ON u.id = sl.sent_by_user_id
LEFT JOIN projects p ON p.id = sc.project_id
ORDER BY sl.created_at;

-- 2. Same share dialog, other tabs: Team Portal share and QR board pin with a
--    check-in id. These never resolved to the photo (both look the id up in the
--    photos table), but list them so they can be cleaned up.
SELECT 'portal_share' AS kind, ps.created_at, ps.item_id FROM portal_shares ps JOIN site_checkins sc ON sc.id = ps.item_id
UNION ALL
SELECT 'qr_pin', qp.pinned_at, qp.item_id FROM qr_board_pins qp JOIN site_checkins sc ON sc.id = qp.item_id;

-- 3. Check-in photo filenames pasted into any other stored record (messages,
--    daily notes, report photos, documents).
SELECT 'photos' AS t, id FROM photos WHERE photo_url LIKE '%/uploads/checkin-%'
UNION ALL SELECT 'daily_notes', id FROM daily_notes WHERE photo_url LIKE '%/uploads/checkin-%'
UNION ALL SELECT 'documents', id FROM documents WHERE file_url LIKE '%/uploads/checkin-%'
UNION ALL SELECT 'messages', id FROM messages WHERE content LIKE '%/uploads/checkin-%'
UNION ALL SELECT 'channel_messages', id FROM channel_messages WHERE content LIKE '%/uploads/checkin-%';

-- 4. Scale: how many check-in photos exist, per company.
SELECT c.name AS company, count(*) AS checkin_photos, min(sc.checked_in_at) AS first, max(sc.checked_in_at) AS last
FROM site_checkins sc JOIN projects p ON p.id = sc.project_id JOIN companies c ON c.id = p.company_id
GROUP BY c.name ORDER BY 2 DESC;
