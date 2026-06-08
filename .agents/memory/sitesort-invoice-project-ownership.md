---
name: SiteSort invoice ↔ project ownership
description: Where invoices appear once assigned to a project, and the share-button precondition.
---
- The main Invoices page (`artifacts/sitesort/src/pages/invoices/index.tsx`) shows ONLY invoices with no project (projectId falsy). Its summary totals are computed from `unassigned` for the same reason.
- Invoices assigned/"moved" to a project (projectId set) are intentionally hidden from the main list and instead live in that project's Finances tab (`artifacts/sitesort/src/pages/projects/detail.tsx`), which fetches `/api/projects/:id/invoices`.
- **Why:** user expectation is "move" = leave the main page and belong to the project. Keep both surfaces consistent if you add new invoice views.
- View/Share controls (open attachment in new tab, email/whatsapp) must be gated behind `inv.attachmentUrl` — the share helpers dereference `attachmentUrl!` and throw on null. This applies on every surface (mobile cards, desktop table, viewer modal, project Finances rows).
