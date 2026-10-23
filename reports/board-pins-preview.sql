-- READ-ONLY. Everything pinned to a QR site board today, and what the
-- "pinned = readable by whoever looks at the board" change would do with it.
-- Run BEFORE publishing that change: from then on, every pinned item with a
-- file can be opened by anyone who scans the board's QR code.
-- verdict: opens / no file (board says so) / NOT SHOWN (with the reason).
SELECT pr.name AS project, b.item_type,
       coalesce(d.name, pe.type, ph.reference_number, '(missing)') AS item,
       CASE
         WHEN coalesce(d.project_id, pe.project_id, ph.project_id) IS NULL THEN 'NOT SHOWN: item no longer exists'
         WHEN coalesce(d.project_id, pe.project_id, ph.project_id) <> b.project_id THEN 'NOT SHOWN: belongs to another project'
         WHEN pe.archived_at IS NOT NULL OR ph.archived_at IS NOT NULL THEN 'NOT SHOWN: archived'
         WHEN b.item_type = 'document' AND d.status = 'superseded' THEN 'opens (superseded revision)'
         WHEN coalesce(d.file_url, pe.document_url, ph.photo_url) IS NULL THEN 'no file: board says so'
         ELSE 'opens'
       END AS verdict
FROM qr_board_pins b
JOIN projects pr ON pr.id = b.project_id
LEFT JOIN documents d ON b.item_type = 'document' AND d.id = b.item_id
LEFT JOIN permits pe ON b.item_type = 'permit' AND pe.id = b.item_id
LEFT JOIN photos ph ON b.item_type = 'photo' AND ph.id = b.item_id
ORDER BY pr.name, b.item_type, item;
