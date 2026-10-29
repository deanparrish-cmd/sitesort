-- Demo company: switch Brookfield & Haigh Construction Ltd to Solo, active, beta off (Dean, 2026-10-29).
-- Run on PROD, one statement at a time, AFTER the first seed run (which needs beta on and
-- creates Ravensworth Mews only). Result: no checkout gate, a 1-project cap, and the upgrade
-- prompt when Unit 3 Lowfield is added in the demo. No Stripe subscription is created, so
-- nothing is charged. The console says OK either way, so step 3 is the proof.
-- Never use the Admin page beta switch on this company afterwards: switching beta off
-- there sets it back to 'incomplete' (checkout gate).

-- 1. PREVIEW: must return exactly ONE row: beta_access true, projects 1 (Ravensworth Mews).
SELECT c.id, c.name, c.beta_access, c.subscription_status, c.subscription_tier,
       (SELECT string_agg(p.name, ', ') FROM projects p WHERE p.company_id = c.id) AS projects
FROM companies c
WHERE c.name = 'Brookfield & Haigh Construction Ltd';

-- 2. CHANGE: touches nothing unless exactly one company has this name.
UPDATE companies
SET beta_access = false, subscription_status = 'active', subscription_tier = 'solo',
    cancel_at_period_end = false, current_period_end = NULL
WHERE name = 'Brookfield & Haigh Construction Ltd'
  AND (SELECT count(*) FROM companies WHERE name = 'Brookfield & Haigh Construction Ltd') = 1;

-- 3. VERIFY: expect beta_access false, active, solo, companies_with_this_name 1, projects 1.
SELECT name, beta_access, subscription_status, subscription_tier,
  (SELECT count(*) FROM companies WHERE name = 'Brookfield & Haigh Construction Ltd') AS companies_with_this_name,
  (SELECT count(*) FROM projects p WHERE p.company_id = companies.id) AS projects
FROM companies WHERE name = 'Brookfield & Haigh Construction Ltd';
