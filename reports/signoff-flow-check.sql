-- READ-ONLY (Dean, 2026-10-24). How did the recent portal sign-offs happen?
-- The in-viewer sign-off (#168) only shows for files SiteSort can draw (PDF,
-- image); anything else goes Open the file (new tab) -> back -> Sign off.
-- Changes nothing.

-- 1. Every sign-off in the last 3 days, newest first: the file's type, how
--    long between the open and the signature, PIN or not, and the device.
--    Reading it: file_kind 'other' = Word/CAD etc., the viewer could not show
--    it (the new-tab flow is by design); 'pdf'/'image' = it should have shown
--    in the viewer with Sign off at the bottom.
SELECT a.created_at AS signed_at, u.email, d.name AS document, d.type,
       CASE WHEN lower(d.file_url) ~ '\.pdf(\?|$)' THEN 'pdf'
            WHEN lower(d.file_url) ~ '\.(png|jpe?g|gif|webp)(\?|$)' THEN 'image'
            ELSE 'other' END AS file_kind,
       dd.viewed_at, dd.acknowledged_at,
       round(extract(epoch FROM dd.acknowledged_at - dd.viewed_at)) AS secs_open_to_signed,
       a.signed_off_with_pin, a.user_role, a.user_agent
FROM acknowledgment_audit_log a
JOIN documents d ON d.id = a.document_id
JOIN users u ON u.id = a.user_id
LEFT JOIN document_distributions dd ON dd.document_id = a.document_id AND dd.user_id = a.user_id
WHERE a.created_at > now() - interval '3 days'
ORDER BY a.created_at DESC;
