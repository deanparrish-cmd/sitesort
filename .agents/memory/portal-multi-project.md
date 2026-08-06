---
name: Portal multi-project sessions and invites
description: Rules for the contractor portal's multi-project switcher and in-portal invite delivery
---

- Portal membership predicate everywhere: a `project_members` row with BOTH userId AND personId. Any project list, switcher, or invite-visibility query must use this predicate, not userId alone.
- Project switching replaces the session by CLAIMING the old sid (conditional `UPDATE ... WHERE revoked_at IS NULL RETURNING`) before minting a new one — of two concurrent switches only one wins; the loser gets session_expired. Never revoke-then-create without the claim, or parallel requests leave two live sessions.
- **Why:** architect review found the revoke-then-create ordering still races; the claim serializes it.
- Invite matching for in-portal accept: match by linked person OR lower(email), but an invite whose personId is linked to a DIFFERENT user must be invisible to an email-matched account (the person is the invited identity, not the email string).
- Invite accept is a transaction: `SELECT ... FOR UPDATE` on the invite + conditional claim of status pending→accepted; membership reconciliation loads ALL matching rows, keeps the person-backed row (its pre-set permissions win) and deletes a duplicate user-backed row (project+user unique index).
- Invite delivery: if the invited person maps to a user with any person-backed membership, skip the email — set emailStatus 'portal', link person.userId, push via sendPushToUser (all devices, deduped by endpoint). PM UI renders "Invited via their portal".
- Frontend switch: replace localStorage `sitesort_portal_token`, `queryClient.clear()`, navigate /portal/overview. Every switch call needs a catch (session_expired is a normal outcome).
