-- Read-only. Run against PROD after publishing #121. Staff notes ("Notes &
-- reminders" on the Team page). Before #121 every member of staff could read
-- every note, including the person it was about; nothing recorded who read them.

-- 1. How many notes exist, per company (company_id is backfilled at boot).
SELECT c.name AS company, count(*) AS notes, count(DISTINCT n.user_id) AS people_with_notes
FROM user_notes n LEFT JOIN companies c ON c.id = n.company_id GROUP BY c.name ORDER BY 2 DESC;

-- 2. Notes about someone who belongs to more than one company: before #121 a
--    manager in the OTHER company could read these too.
SELECT n.created_at, subj.name AS about, auth.name AS written_by, c.name AS written_in,
       (SELECT string_agg(c2.name, ', ') FROM company_members m2 JOIN companies c2 ON c2.id = m2.company_id
         WHERE m2.user_id = n.user_id AND m2.company_id <> n.company_id) AS also_member_of
FROM user_notes n
JOIN users subj ON subj.id = n.user_id
JOIN users auth ON auth.id = n.author_id
LEFT JOIN companies c ON c.id = n.company_id
WHERE (SELECT count(*) FROM company_members m WHERE m.user_id = n.user_id) > 1;

-- 3. Notes the backfill couldn't place (never shown now).
SELECT count(*) AS unplaced FROM user_notes WHERE company_id IS NULL;
