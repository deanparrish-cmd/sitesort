-- Demo company: beta access for Brookfield & Haigh Construction Ltd (Dean, 2026-10-27).
-- Run on PROD, one statement at a time, after signing up as Richard Haigh and
-- closing the Stripe page without a card. The console says OK either way, so
-- step 3 is the proof.

-- 1. PREVIEW: must return exactly ONE row, created today, with Richard's email.
SELECT c.id, c.name, c.beta_access, c.subscription_status, c.created_at, u.email
FROM companies c JOIN users u ON u.company_id = c.id
WHERE c.name = 'Brookfield & Haigh Construction Ltd';

-- 2. CHANGE: touches nothing unless exactly one company has this name.
UPDATE companies SET beta_access = true
WHERE name = 'Brookfield & Haigh Construction Ltd'
  AND (SELECT count(*) FROM companies WHERE name = 'Brookfield & Haigh Construction Ltd') = 1;

-- 3. VERIFY: expect beta_access true and companies_with_this_name 1.
SELECT name, beta_access,
  (SELECT count(*) FROM companies WHERE name = 'Brookfield & Haigh Construction Ltd') AS companies_with_this_name
FROM companies WHERE name = 'Brookfield & Haigh Construction Ltd';
