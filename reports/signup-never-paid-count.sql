-- Companies that signed up and never paid (Dean, 2026-10-29). READ-ONLY, run on PROD.
-- Since 18 Jun 2026 signup creates the company as subscription_status 'incomplete',
-- tier 'free'; only the Stripe webhook (card taken) or beta access moves it on.
-- Companies created before that took the column default 'active' with tier 'free':
-- no checkout gate at all, one project allowed.

-- 1. Summary: every billing state, with how many of each.
SELECT subscription_status, subscription_tier, beta_access,
       (stripe_customer_id IS NOT NULL) AS has_stripe_customer,
       count(*) AS companies, min(created_at) AS oldest, max(created_at) AS newest
FROM companies
GROUP BY 1, 2, 3, 4
ORDER BY companies DESC;

-- 2. Never paid, listed: not beta, and either 'incomplete' (closed Stripe) or
-- 'active' on tier 'free' (old default, never went through Stripe).
-- The counts show whether anyone actually USED it: a project, documents,
-- portal cards, gate check-ins.
SELECT c.name, c.created_at, c.subscription_status, c.subscription_tier,
       (c.stripe_customer_id IS NOT NULL) AS opened_stripe,
       (SELECT string_agg(u.email || CASE WHEN u.email_verified THEN '' ELSE ' (unverified)' END, ', ')
          FROM users u WHERE u.company_id = c.id AND NOT u.portal_only) AS dashboard_logins,
       (SELECT count(*) FROM projects p WHERE p.company_id = c.id) AS projects,
       (SELECT count(*) FROM documents d JOIN projects p ON p.id = d.project_id WHERE p.company_id = c.id) AS documents,
       (SELECT count(*) FROM project_members m JOIN projects p ON p.id = m.project_id WHERE p.company_id = c.id) AS cards,
       (SELECT count(*) FROM site_checkins s JOIN projects p ON p.id = s.project_id WHERE p.company_id = c.id) AS checkins
FROM companies c
WHERE NOT c.beta_access
  AND (c.subscription_status = 'incomplete'
       OR (c.subscription_status = 'active' AND c.subscription_tier = 'free'))
ORDER BY c.created_at DESC;
