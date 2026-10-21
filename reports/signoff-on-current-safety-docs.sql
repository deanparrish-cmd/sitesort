-- Option 2 (Dean, 2026-10-21): switch sign-off ON for CURRENT RAMS, permits
-- and safety documents stored with it off. DATA CHANGE. HELD: run only after
-- Dean has seen reports/signoff-off-safety-docs-count.sql on prod and said go.
--
-- What it changes: documents.requires_acknowledgment false -> true on current
-- method_statement / permit / safety rows. Nothing else. Superseded rows are
-- left alone (they can't be signed off since #147). No rows are deleted,
-- no distribution rows are created or changed.
--
-- Effect once committed: Sign off appears for everyone who can see these
-- documents; their unopened copies count as pending sign-offs (dashboard,
-- compliance, project alerts); an active project's close-out can turn red.
--
-- How to run: run the whole file as is. It ends in ROLLBACK, so the first run
-- only SHOWS what would change. If the numbers match the count query, change
-- the last line to COMMIT and run it again.

BEGIN;

-- Before: must equal query 1's "current" rows of the count report.
SELECT type, count(*) AS will_switch_on
FROM documents
WHERE status = 'current' AND type IN ('method_statement', 'permit', 'safety') AND NOT requires_acknowledgment
GROUP BY type ORDER BY type;

UPDATE documents
SET requires_acknowledgment = true
WHERE status = 'current' AND type IN ('method_statement', 'permit', 'safety') AND NOT requires_acknowledgment
RETURNING id, project_id, type, name;

-- After: must be 0 rows.
SELECT type, count(*) AS still_off
FROM documents
WHERE status = 'current' AND type IN ('method_statement', 'permit', 'safety') AND NOT requires_acknowledgment
GROUP BY type;

ROLLBACK;
