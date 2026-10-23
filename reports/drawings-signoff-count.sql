-- READ-ONLY (2026-10-23). Drawings and sign-off, before deciding to make
-- drawings PIN sign-off documents. Changes nothing. Run each block on its own
-- if the console only shows the last result.

-- 1. Drawings by state: how many require acknowledgement, how many don't,
--    and how many already require a PIN (the per-document switch).
SELECT d.status,
       count(*) FILTER (WHERE d.requires_acknowledgment)       AS requires_ack,
       count(*) FILTER (WHERE NOT d.requires_acknowledgment)   AS no_ack,
       count(*) FILTER (WHERE d.require_pin_signoff)           AS pin_switched_on,
       count(*)                                                AS total
FROM documents d
WHERE d.type = 'drawing'
GROUP BY d.status
ORDER BY d.status;

-- 2. The marks already recorded on drawings (these are never reset):
--    one row per person per drawing revision.
SELECT d.status AS drawing_status, d.requires_acknowledgment,
       dd.status AS mark,
       count(*) FILTER (WHERE dd.signed_off_with_pin) AS signed_with_pin,
       count(*)                                       AS rows
FROM document_distributions dd
JOIN documents d ON d.id = dd.document_id
WHERE d.type = 'drawing'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 3. Size of the change if EXISTING current drawings were switched on too:
--    people with a copy who haven't signed (they would join "waiting for
--    sign-off"), per company. New uploads alone change none of this.
SELECT c.name AS company,
       count(DISTINCT d.id)                                       AS current_drawings,
       count(dd.id) FILTER (WHERE dd.status <> 'acknowledged')    AS would_be_waiting
FROM documents d
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
LEFT JOIN document_distributions dd ON dd.document_id = d.id
WHERE d.type = 'drawing' AND d.status = 'current' AND NOT d.requires_acknowledgment
GROUP BY c.name
ORDER BY c.name;

-- 4. Always returns one row: the two numbers asked for (current revisions).
SELECT count(*) FILTER (WHERE requires_acknowledgment)     AS current_drawings_requiring_ack,
       count(*) FILTER (WHERE NOT requires_acknowledgment) AS current_drawings_not_requiring_ack
FROM documents WHERE type = 'drawing' AND status = 'current';
