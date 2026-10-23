-- READ-ONLY. How did logins end up on a project with no card and no firm
-- (held every time at the gate from #163)? Run each query on its own.

-- 1. Every such row, with the invite that put them there (if any).
--    how_added says whether an invite put them there, and whether it had a card.
SELECT pr.name AS project, u.email, u.name, u.portal_only, pm.added_at,
       i.created_at AS invited_at,
       CASE WHEN i.id IS NULL THEN 'added by account, no invite'
            WHEN i.person_id IS NULL THEN 'invite with no card'
            ELSE 'invite with a card' END AS how_added
FROM project_members pm
JOIN projects pr ON pr.id = pm.project_id
JOIN users u ON u.id = pm.user_id
LEFT JOIN project_invites i ON i.project_id = pm.project_id AND i.accepted_user_id = u.id
WHERE pm.person_id IS NULL AND pm.subcontractor_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM company_members cm WHERE cm.user_id = u.id AND cm.company_id = pr.company_id
                    AND cm.role IN ('admin', 'project_manager') AND u.portal_only = false)
ORDER BY pr.name, u.email;

-- 2. Invites still waiting that carry no card: accepting one puts the person
--    on the project with no card, so they'd be held at the gate.
SELECT pr.name AS project, i.email, i.name, i.created_at, i.expires_at
FROM project_invites i
JOIN projects pr ON pr.id = i.project_id
WHERE i.status = 'pending' AND i.person_id IS NULL
ORDER BY i.created_at DESC;
