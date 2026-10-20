-- Read-only (SELECT only). Run on PROD before building option B (2026-10-20).
-- Counts PERSON shares sitting on a card (X) whose login (L) now holds a
-- DIFFERENT card (Y) on that same project, so the share reaches nobody.
--
-- Dean's rule for B: a card that was archived, or whose membership a PM removed,
-- must stay excluded. A PM removal hard-deletes the membership row and leaves no
-- record (routes/team.ts:658; revokePersonFromProject only revokes PENDING
-- invites). An invite-accept "move" (routes/portal.ts:798 / :916) leaves exactly
-- the same state. So a card with no membership row can't be classed as moved
-- or removed by code.
--   heals_under_B       X not archived AND X still has a membership row on the
--                       project (B counts it). Not a removal.
--   needs_decision      X not archived, NO membership row: moved OR removed,
--                       can't tell. B leaves it excluded; Dean decides per card.
--   stays_excluded      X archived. Excluded under B whatever happened.
-- Plus, for context: person shares on cards with no login at all (never joined).

-- 1. Summary.
WITH s AS (
  SELECT ps.id AS share_id, ps.project_id, ps.person_id AS card_x, ps.created_at AS shared_at,
         px.user_id AS login, px.archived_at
  FROM portal_shares ps
  JOIN people px ON px.id = ps.person_id
  WHERE ps.audience_type = 'person'
),
k AS (
  SELECT s.*,
    EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = s.project_id AND m.person_id = s.card_x) AS x_has_row,
    (SELECT m.person_id FROM project_members m
       WHERE m.project_id = s.project_id AND m.user_id = s.login LIMIT 1) AS login_card_on_project
  FROM s
)
SELECT
  CASE
    WHEN login IS NULL THEN 'context: card never on the portal'
    WHEN login_card_on_project IS NULL THEN 'context: login not on this project at all'
    WHEN login_card_on_project = card_x THEN 'fine: login holds this card'
    WHEN archived_at IS NOT NULL THEN 'stays_excluded (card archived)'
    WHEN x_has_row THEN 'heals_under_B'
    ELSE 'needs_decision (moved or removed)'
  END AS bucket,
  count(*) AS shares,
  count(DISTINCT card_x) AS cards,
  count(DISTINCT login) AS logins
FROM k
GROUP BY 1
ORDER BY 1;

-- 2. Detail for every card that is not "fine": one row per card per project,
--    with the evidence for deciding moved vs removed. Hint: shares sent to X
--    AFTER Y's invite was accepted mean the sender still thought X was live.
WITH s AS (
  SELECT ps.project_id, ps.person_id AS card_x, ps.created_at AS shared_at,
         px.user_id AS login, px.archived_at, px.name AS x_name, px.email AS x_email
  FROM portal_shares ps
  JOIN people px ON px.id = ps.person_id
  WHERE ps.audience_type = 'person' AND px.user_id IS NOT NULL
),
k AS (
  SELECT s.*,
    EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = s.project_id AND m.person_id = s.card_x) AS x_has_row,
    (SELECT m.person_id FROM project_members m
       WHERE m.project_id = s.project_id AND m.user_id = s.login LIMIT 1) AS card_y
  FROM s
)
SELECT u.email AS login_email, pr.name AS project, k.x_name, k.x_email, k.card_x,
       py.name AS y_name, py.email AS y_email, k.card_y,
       (k.archived_at IS NOT NULL) AS x_archived, k.x_has_row,
       count(*) AS shares_on_x, min(k.shared_at) AS first_share, max(k.shared_at) AS last_share,
       (SELECT max(i.accepted_at) FROM project_invites i
          WHERE i.project_id = k.project_id AND i.person_id = k.card_x AND i.status = 'accepted') AS x_invite_accepted,
       (SELECT max(i.accepted_at) FROM project_invites i
          WHERE i.project_id = k.project_id AND i.person_id = k.card_y AND i.status = 'accepted') AS y_invite_accepted,
       count(*) FILTER (WHERE k.shared_at > (SELECT max(i.accepted_at) FROM project_invites i
          WHERE i.project_id = k.project_id AND i.person_id = k.card_y AND i.status = 'accepted')) AS shares_on_x_after_y_accepted
FROM k
JOIN users u ON u.id = k.login
JOIN projects pr ON pr.id = k.project_id
LEFT JOIN people py ON py.id = k.card_y
WHERE k.card_y IS NOT NULL AND k.card_y <> k.card_x
GROUP BY u.email, pr.name, k.x_name, k.x_email, k.card_x, py.name, py.email, k.card_y,
         k.archived_at, k.x_has_row, k.project_id
ORDER BY u.email, pr.name;

-- 3. (Added 2026-10-20 after Dean's removal decision. FIXED same day: it
--    counted project_members ROWS, so one card with two rows looked like two
--    cards (Amy). Now counts DISTINCT cards; rows shows the raw row count.) People who hold, or may
--    hold, more than one card on the same project. This sizes the Team-tab
--    "also on this project as ..." marker and the removal warning.
--    linked = cards tied to the same login (B can detect these).
--    same_email_only = cards with the same email but no shared login
--    (candidates only; B can't safely treat these as one person).
--    Cards with different emails and no shared login (e.g. a never-invited
--    card) are invisible to code and never show here.
WITH c AS (
  SELECT m.project_id, p.id AS card, p.name, lower(p.email) AS email, p.user_id
  FROM project_members m
  JOIN people p ON p.id = m.person_id
  WHERE p.archived_at IS NULL
)
SELECT 'linked (same login)' AS kind, pr.name AS project, u.email AS who,
       count(DISTINCT c.card) AS cards, count(*) AS rows,
       string_agg(DISTINCT c.name || ' <' || coalesce(c.email, '') || '>', ', ') AS card_names
FROM c JOIN users u ON u.id = c.user_id JOIN projects pr ON pr.id = c.project_id
GROUP BY pr.name, u.email HAVING count(DISTINCT c.card) > 1
UNION ALL
SELECT 'same_email_only', pr.name, c.email, count(DISTINCT c.card), count(*), string_agg(DISTINCT c.name, ', ')
FROM c JOIN projects pr ON pr.id = c.project_id
WHERE c.email IS NOT NULL
GROUP BY pr.name, c.email
HAVING count(DISTINCT c.card) > 1 AND count(DISTINCT c.user_id) <= 1
   AND count(DISTINCT c.card) > count(DISTINCT c.card) FILTER (WHERE c.user_id IS NOT NULL)
ORDER BY 1, 2, 3;
