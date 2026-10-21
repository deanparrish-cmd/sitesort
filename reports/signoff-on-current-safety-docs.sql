-- Option 2 (Dean, 2026-10-21): switch sign-off ON for CURRENT RAMS, permits
-- and safety documents stored with it off. DATA CHANGE. HELD: run only after
-- Dean has seen reports/signoff-off-safety-docs-count.sql on prod and said go.
--
-- Three plain statements, run ONE AT A TIME in the Replit SQL console. No
-- BEGIN/COMMIT/ROLLBACK: the console rejects them and wraps each run in its
-- own transaction. The console says "OK" whether the UPDATE changed three
-- rows or none, so step 3 is NOT optional.
--
-- Changes only documents.requires_acknowledgment (false -> true) on current
-- method_statement / permit / safety rows. Superseded rows are left alone
-- (they can't be signed off since #147). Nothing deleted; no distribution
-- rows created or changed.

-- 1. PREVIEW: exactly the rows step 2 will change. Note the row count.
SELECT d.id, c.name AS company, p.name AS project, d.name AS document, d.type,
  coalesce('Rev ' || d.revision, 'v' || d.version) AS rev, d.created_at::date AS uploaded
FROM documents d
JOIN projects p ON p.id = d.project_id
JOIN companies c ON c.id = p.company_id
WHERE d.status = 'current' AND d.type IN ('method_statement', 'permit', 'safety') AND NOT d.requires_acknowledgment
ORDER BY c.name, p.name, d.name;

-- 2. CHANGE: the bare UPDATE. Same WHERE as step 1.
UPDATE documents
SET requires_acknowledgment = true
WHERE status = 'current' AND type IN ('method_statement', 'permit', 'safety') AND NOT requires_acknowledgment;

-- 3. VERIFY: always returns one row. still_off must be 0. If it isn't, the
--    UPDATE did not take: stop and report it.
SELECT count(*) AS still_off
FROM documents
WHERE status = 'current' AND type IN ('method_statement', 'permit', 'safety') AND NOT requires_acknowledgment;
