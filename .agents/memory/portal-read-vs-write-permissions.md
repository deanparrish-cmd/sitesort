---
name: Portal read vs write permission model
description: Site Issues / Plant & Materials / Daily Report are read-for-all-members, write-by-grant
---
Rule: every portal member can VIEW Site Issues, Plant & Materials, and Daily Report (nav entries always shown, GET routes only require portal session + membership). The per-member permission flags (canLogIssues, canUpdatePlantMaterials, canEditDailyReport) gate ONLY the write endpoints and the edit affordances in the views.

**Why:** gating reads on the edit flags made submitted items vanish for the submitter ("can't reopen to view what I sent") — user explicitly wanted read-only reopen for everyone.

**How to apply:** when adding a portal section, don't add a `permission` field to its nav entry or a client-side section guard for viewing; keep permission middleware on writes only.
