---
name: Per-subcontractor timestamped notes pattern
description: How the subcontractor notes/reminders history is modelled (dedicated table, not the single notes text field).
---

# Subcontractor notes history

Subcontractors have TWO distinct note concepts — don't conflate them:
- `subcontractors.notes` (single free-text column) — a static "about" blurb edited in the Add/Edit dialog.
- `subcontractor_notes` table — an append-only, timestamped LOG (id, subcontractorId FK, authorId FK, body, createdAt defaultNow), one row per reminder/conversation. Surfaced via the StickyNote "Notes & Reminders" dialog on each subcontractor card.

**Why:** The user wanted a date+time-stamped record of chasing expiring insurance/permits — i.e. history, not a single overwritten field.

**How to apply:** This mirrors the `daily_notes` pattern. API: `GET/POST /subcontractors/:id/notes` in api-server subcontractors.ts — both MUST verify the sub belongs to `req.user.companyId` before read/write (tenant scoping), POST sets authorId from `req.user.id` (never client), GET joins users for authorName and orders `desc(createdAt)`. Write gating is UI-only (`caps.canManageSubcontractors`); add a server capability check if policy hardening is needed.
