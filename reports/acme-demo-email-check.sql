-- Read-only (SELECT only). Does the prod demo company email a real domain?
-- (2026-10-16). Run on PROD. acme.com is real; the test-domain block lets it through.
SELECT u.email, u.email_notifications, c.name AS company, cm.role
FROM users u
LEFT JOIN company_members cm ON cm.user_id = u.id
LEFT JOIN companies c ON c.id = cm.company_id
WHERE u.email ILIKE '%@acme.com'
ORDER BY u.email;
