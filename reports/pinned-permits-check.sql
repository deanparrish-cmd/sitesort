-- READ-ONLY. Pinned permits on QR site boards (Dean, 2026-10-22: "Hot works"
-- under Pinned to this board does nothing when tapped, on the board and in the
-- portal). One row per pinned permit: does it have a file, is it archived, and
-- who is it shared with on the Team Portal.
SELECT pr.name AS project, pe.type, pe.description, pe.expiry_date,
       pe.document_url IS NOT NULL AS has_file,
       pe.archived_at,
       (SELECT string_agg(ps.audience_type || coalesce(':' || ps.trade, ''), ', ')
          FROM portal_shares ps WHERE ps.item_type = 'permit' AND ps.item_id = pe.id) AS portal_shared_with
FROM qr_board_pins b
JOIN permits pe ON pe.id = b.item_id
JOIN projects pr ON pr.id = b.project_id
WHERE b.item_type = 'permit'
ORDER BY pr.name, pe.type;
