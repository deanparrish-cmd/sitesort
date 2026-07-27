---
name: Contact email identity rules
description: Rules for editing contact details (email/phone) across people, users, and subcontractor rows.
---

**Rule:** A login account's email is its sign-in identity — never editable via contact-edit endpoints (project member contact, people PATCH). Refuse email edits whenever the target has a linked `userId` (project_members.user_id or people.user_id). Phone is always safe to edit.

**Why:** people.email is used for account linking on portal invites and must stay in sync with users.email; editing the person copy desyncs invite/login matching. Also: two authz holes were found on reused endpoints — PATCH members/:id/contact had no tenant check or role gate, and PATCH /users/:userId let any member change roles/phones. Both are now manager-gated (self-edit of own name/phone allowed on /users).

**How to apply:** When surfacing contact editing in new UI, gate email edits client-side on `!member.userId`, and keep the subcontractors row mirror (contactEmail/contactPhone/contactName) in sync for primary-contact people. Normalize emails trim+lowercase everywhere.
