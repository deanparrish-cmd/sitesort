-- CHANGES PROD DATA. Run ONLY after reports/company-name-soloutions-check.sql
-- query 1 has returned exactly one misspelt row and no correctly spelt row.
-- Concept Project Soloutions Ltd -> Concept Project Solutions Ltd
-- (Dean, 2026-10-24, confirmed by the director).
--
-- Replit SQL console: no BEGIN/COMMIT. Run the three steps one at a time.
-- The console says OK whether a statement changed 1 row or 0, so step 3 is
-- the only proof.
--
-- Scope: companies.name only. Every screen, email, report, share-link page
-- and QR board that names the company reads this column live, so this one
-- row fixes all of them. Copies stored elsewhere (check query 2) are NOT
-- touched here; each gets its own preview/change/verify once decided.
--
-- Replace <ID> below with the id returned by check query 1.

-- 1. PREVIEW: must return exactly ONE row, spelt "Soloutions".
SELECT id, name FROM companies
WHERE id = '<ID>' AND name = 'Concept Project Soloutions Ltd';

-- 2. CHANGE (bare statement, run alone).
UPDATE companies SET name = 'Concept Project Solutions Ltd'
WHERE id = '<ID>' AND name = 'Concept Project Soloutions Ltd';

-- 3. VERIFY: always returns one row. Expect now_correct = 1, still_misspelt = 0.
SELECT
  count(*) FILTER (WHERE id = '<ID>' AND name = 'Concept Project Solutions Ltd') AS now_correct,
  count(*) FILTER (WHERE name ILIKE '%soloution%')                           AS still_misspelt
FROM companies;

-- UNDO (only if needed, run alone, then re-run step 3 expecting 0 / 1):
-- UPDATE companies SET name = 'Concept Project Soloutions Ltd'
-- WHERE id = '<ID>' AND name = 'Concept Project Solutions Ltd';
