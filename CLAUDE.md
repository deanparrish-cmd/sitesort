# SiteSort – Claude Code Guide

## Project

SiteSort is a full-stack construction site information management platform for SME construction companies. Built as a pnpm monorepo with TypeScript throughout.

## Stack

- **Monorepo**: pnpm workspaces
- **API**: Express 5, Node 24, TypeScript 5.9
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite, React Query, react-hook-form, Recharts
- **Build**: esbuild (CJS bundle)

## Repo Structure

```
artifacts/
  api-server/       # Express API (port 8080, served at /api)
  sitesort/         # React + Vite frontend (port 18299, served at /)
lib/
  api-spec/         # OpenAPI spec + Orval codegen config
  api-client-react/ # Generated React Query hooks
  api-zod/          # Generated Zod schemas
  db/               # Drizzle ORM schema + DB connection
scripts/
  src/
    github-setup.ts # Creates the GitHub repo via Replit Connectors
    github-push.ts  # Pushes workspace files to GitHub via GitHub API
```

## Key Commands

```bash
pnpm run typecheck                              # Typecheck from root
pnpm --filter @workspace/api-spec run codegen  # Regenerate API client + Zod schemas
pnpm --filter @workspace/db run push           # Push DB schema changes
```

## Pushing to GitHub

There is no git remote pointing to GitHub. Pushes are done via the Replit Connectors SDK:

```bash
npx tsx scripts/src/github-push.ts
```

This uses the authenticated GitHub connector (no token needed) to push all workspace files to `deanparrish-cmd/sitesort` via the GitHub Contents API.

To create the repo fresh:
```bash
npx tsx scripts/src/github-setup.ts
```

## Auth

JWT tokens, stored as `sitesort_token` in localStorage. Header: `Authorization: Bearer <token>`.

Demo credentials: `paul@acme.com` / `password123` (company: Acme Construction)

## Features Built

1. Version-controlled document hub (auto versioning, SUPERSEDED badges)
2. Targeted team distribution (track pending/viewed/acknowledged)
3. Digital sign-off tracking (PIN confirmation, timestamped)
4. Real-time in-app notifications (bell with live unread count)
5. Compliance photo log (timestamped, GPS metadata, reference numbers)
6. Subcontractor insurance monitor (valid/expiring_soon/expired)
7. QR code site board integration
8. Permit management (active/expiring/expired, responsible persons, certificate file attachment, Open Certificate button)
9. Compliance Centre (aggregate view across projects, drag-and-drop certificate upload)
10. Team management (admin/project_manager/site_worker/subcontractor roles)
11. Subcontractor cards — call/email/SMS/WhatsApp action buttons, visible contact details, trade badges, notes field
12. Add subcontractors from company directory into individual projects
13. Full compliance page (was placeholder) — expiring insurance/permits, pending sign-offs, drag-and-drop file upload
14. Full team page (was placeholder) — members grouped by role, last-active
15. Team messaging — direct messages between team members, two-panel chat UI, 5s polling, unread badges
16. Message notifications — toast + browser OS notification on new message, live badge on sidebar Messages item and bell icon, manager "View All" read-only oversight mode
17. Notifications page (`/notifications`) — filter tabs (All/Unread/Messages/Documents/Safety), per-type icons, click-to-read, mark-all-read, badge clears on visit, navigates to related entity on click
18. Invoice file attachments — drag-and-drop or click-to-upload per invoice row, `attachmentUrl` column on invoices table, Open/Email/WhatsApp share dropdown, remove button
19. Document & certificate sharing — Open + Email/WhatsApp share on project documents tab and compliance insurance certificate rows; compliance API extended to include `certificateUrl`
20. Settings page (`/settings`) — Profile (name/phone/avatar upload), Security (change password), Notifications (toast + OS toggles in localStorage), Company (admin: name/size); API: `PATCH /auth/me`, `POST /auth/change-password`, `GET/PATCH /companies/mine`
21. Document supersedes selector — upload form shows optional dropdown of current docs of the same type; selecting one marks it superseded on save; API accepts explicit `supersededDocumentId` with same-name auto-supersede fallback
22. Document status/version editing — Edit button on document rows opens dialog to change status (current/superseded) and version number; `PATCH /api/documents/:documentId`
23. Subscription billing — Stripe Checkout (Solo £29/Team £79/Pro £149, 14-day trial), webhook sync, Customer Portal, plan-based project limits, trial-ending and payment-failed notifications
24. Read-only mode on cancellation — persistent red banner on all authenticated pages; all write actions across every page show a destructive toast and return early when cancelled; settings profile/password/company show inline error banner; `SubscriptionContext` exposes `isCancelled` app-wide
25. Real user dashboard — personalised greeting, quick-action buttons, 4-stat cards (active projects/expiring items/pending sign-offs/unread messages), "Needs Attention" panel, recent activity feed, portfolio snapshot, site calendar
26. Invoice document viewer — full-screen inline viewer panel; PDF via file card (Open PDF button + Download link), image via `<img>`; sidebar with invoice details; header actions: `window.open()` open, share, mark paid
27. Project detail report / PDF export — "Export Report" button generates a print-ready HTML report (team, permits, documents, finances, photos) and auto-triggers browser Save-as-PDF
28. Subcontractor "Add to Project" — FolderPlus button on each sub card opens a dialog listing active projects; one-click add with inline per-project feedback (added/already linked/error)
29. Enforced subcontractor directory-first workflow — removed "Add Person" form and dialog from the project Team tab; contacts must be added to the subcontractor directory first, then linked into a project via "Add from Subcontractor Directory"
30. Broadcast messaging — "New" button in Messages opens a three-mode picker: Individual (1-to-1), By Role (filter project members by Admin/PM/Site Worker/Subcontractor), All in Project; backend `POST /api/messages/broadcast` sends message + notification per recipient
31. Landing page pricing section — "Start Free Trial" smooth-scrolls to Solo £29/Team £79/Pro £149 plan cards; Book Demo button removed
32. Invoice sharing in messages — Receipt button in compose bar opens an invoice picker; selected invoice renders as a card in the thread (counterparty, amount, status badge, due date, PDF link); `invoiceId` nullable column on messages table; `content` defaults to `""` to allow invoice-only messages
33. Document, photo, and permit sharing in messages — Paperclip button in compose bar opens a tabbed picker (Document / Photo / Permit) with a project selector; selected item shown as a violet chip; thread renders typed cards: document (name, type, version, view link), photo (thumbnail, category, reference), permit (type, description, expiry status badge); `attachmentType` + `attachmentId` columns on messages table; API thread endpoint batch-fetches attachment data
34. Project channel group messaging — each active project gets a shared `#channel` thread visible to all project members; appears above DMs in sidebar with blue `#` icon and unread badge; full attachment support (doc/photo/permit cards); sender name + role chip on every message; edit/delete own messages; 5s polling; notifications to all project members on send; `channel_messages` + `channel_reads` tables; `GET/POST /api/channels/:projectId/messages`, `PATCH/DELETE /api/channel-messages/:id`
35. Message enhancements — emoji reactions (👍 ✅ 👀 ❤️ 😂) on DMs and channels (hover picker, pill badges, toggle); reply-to-message WhatsApp-style quote bubbles; debounced sidebar message search across DMs and channels with yellow-highlighted snippets; 18 quick reply templates in 4 site-specific categories via ⚡ Zap button
36. Subcontractor invite links — UserPlus button on each sub card generates a unique invite link; share modal with copy, WhatsApp/Email/SMS options; register page detects `?invite=<token>` and shows tailored join form (email locked, name pre-filled, password only); backend creates user with `subcontractor` role and marks invite as used
37. Beta access flag — `betaAccess` boolean on `companies` table; companies with `beta_access=true` bypass all Stripe subscription checks (`isCancelled` always false, effective status always "active"); set via `UPDATE companies SET beta_access=true WHERE name='...'`
38. Project progress tracking — `milestones` table (title, dueDate, completedAt, order; cascade-delete with project); 4 CRUD endpoints; `progressPercent` on list and detail now computed from completed/total milestones; "Progress" tab in project detail with progress bar, milestone checklist (add/tick/delete), and Gantt timeline (diamond markers, Today line); mini progress bar column added to project list table
39. Onboarding checklist — dismissible card at top of dashboard showing 5 steps (create project, invite team member, upload document, add subcontractor, set milestones); completion derived from real DB data via `GET /api/onboarding/status`; progress bar; each incomplete step shows description + CTA link; X dismisses to localStorage; auto-hides when all done
40. DM read receipts — single grey ✓ (sent) / double blue ✓✓ (seen) on outgoing DMs; `?after=` poll response includes `readUpdates [{id, readAt}]` so the sender's tick flips live within 5s without re-fetching the thread
41. Admin beta access UI — "Companies & Beta Access" section on admin dashboard; table lists all companies with plan/status/user count and an orange toggle switch per row; `GET /api/admin/companies` + `PATCH /api/admin/companies/:id/beta-access`, both behind `requireAdmin` email guard; replaces raw SQL workflow
42. Email notifications — `emailNotifications` boolean on users table (default true); Settings > Notifications tab has email toggle backed by `PATCH /api/auth/me`; emails sent via Resend for: new DMs, new channel messages (per-member opt-in), permit expiry at ~7 days and ~1 day (daily server-side interval in `permit-reminders.ts`)
43. QR site board check-in with date-stamped photo — anonymous workers scan QR code, enter name, take photo via device camera; Canvas API stamps name + date/time + project name onto image before upload; GPS captured optionally; `site_checkins` table stores record; Check-ins tab on project detail shows photo grid with worker name and timestamp; `POST /api/site/:token/checkin` (public multipart) + `GET /api/projects/:id/checkins` (auth)
44. QR board pin management — managers pin specific documents, photos, and permits to the site board QR; `qr_board_pins` table (unique per project+type+item, cascade-delete); `GET/POST/DELETE /api/projects/:id/qr-pins`; public `GET /api/site/:token` now resolves and returns `pinnedItems` with full data (doc fileUrl, photo thumbnail, permit status); project detail QR tab shows "Board Contents" panel with thumbtack toggle per item; site-board public page shows "Pinned to this Board" section with View buttons, photo grid, and status badges
45. Subcontractor notes/reminders log — StickyNote button on each sub card opens a "Notes & Reminders" dialog; append-only, timestamped history per subcontractor (date/time + author name); add form gated on `canManageSubcontractors`; Ctrl/Cmd+Enter submits; newest note shown first; `subcontractor_notes` table (id, subcontractorId FK, authorId FK, body, projectId FK nullable, createdAt); `GET/POST /api/subcontractors/:id/notes` (tenant-scoped, IDOR-safe); notes scoped as General (all projects) or project-specific; project Team tab has its own StickyNote button per subcontractor with a General/This-project-only toggle; directory page shows "General" or project-name badge per note
46. Invoice project organisation — invoices linked to a project after marking as paid (popup picker); can be unlinked back to the main list; project detail shows its invoices with viewer and share actions; paid invoices can be reversed to pending; project nav tabs wrap to new lines on mobile instead of scrolling

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22 through 2026-06-10 (early sessions, sign-up fixes, QR pins, compliance docs) — see CLAUDE_ARCHIVE.md for full detail

## End-of-session notes — 2026-06-10 (rename + contacts overhaul)

### Tasks completed today

1. **Global rename — Subcontractors → Contacts, Team → In House Team**
   - Sidebar nav, page headings, tab labels, button text, empty states, dialog titles, onboarding steps, stat cards, PDF report section, projects list column header — all updated across 7 files
   - Stripe plan names ("Team" plan) intentionally left unchanged

2. **Sidebar reorganised into two groups**
   - Top group: Dashboard · Projects · Contacts · In House Team · Messages
   - Bottom group: Compliance Center · Invoices · QR Codes · Admin · Settings
   - Thin divider between groups; `mainNavItems` / `adminNavItems` arrays in `sidebar-layout.tsx`

3. **Contact type field on Contacts directory**
   - `contactType` column added to `subcontractors` DB table (default `"subcontractor"`); pushed via drizzle-kit
   - Options: `subcontractor` · `merchant` · `supplier` · `professional` · `other`
   - Add/Edit form shows Contact Type selector at top; Trade Types section only visible when type is `subcontractor`
   - Directory groups non-subcontractor contacts under Merchants / Suppliers / Professional Services / Other Contacts sections below trade groups
   - Group header shows coloured folder icon + type badge; individual cards also show type badge

4. **Insurance certificates surfaced on contact cards**
   - `GET /api/subcontractors` list now returns `insuranceRecords[]` per contact
   - Contact card renders each record as a coloured pill (green/yellow/red by status) with type, expiry date, and external-link icon to open the certificate
   - Certificates uploaded within any project automatically appear on the contact's card

### Key files modified
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — two nav groups, label renames
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — contact type field, grouping logic, badges, insurance records display
- `artifacts/sitesort/src/pages/team/index.tsx` — heading rename
- `artifacts/sitesort/src/pages/projects/detail.tsx` — tab label, button text, dialog titles, report HTML
- `artifacts/sitesort/src/pages/projects/index.tsx` — Team column rename
- `artifacts/sitesort/src/pages/dashboard/index.tsx` — onboarding steps, stat card subtitles
- `artifacts/sitesort/src/pages/compliance/index.tsx` — field label rename
- `lib/db/src/schema/subcontractors.ts` — `contactType` column
- `artifacts/api-server/src/routes/subcontractors.ts` — `contactType` + `insuranceRecords` in all endpoints

### Notes for next session
- **`contactType` default**: existing rows have `"subcontractor"` from the DB column default — no migration needed
- **Non-subcontractor contacts skip trades**: `onAdd`/`onEdit` send `trades: []` when type ≠ subcontractor
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts` (must run from `/home/runner/workspace`)
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
- All commits are on `main`

## End-of-session notes — 2026-06-10 (file document dialog + contact type UX)

### Tasks completed today

1. **"File this document" dialog redesigned** (`artifacts/sitesort/src/pages/compliance/index.tsx`):
   - **Document Type** selector replaces "Insurance Type": Insurance Certificate, Method Statement, Risk Assessment, Permit to Work, Compliance Certificate, Drawing, Safety Document, Other
   - **Insurance Certificate path**: Contact selector + Insurance sub-type + Expiry Date; once a contact is chosen their linked projects appear inline with navigation links; success screen shows all linked projects with click-through links
   - **Other document types**: Project selector (active projects only) → `POST /api/projects/:id/documents` to file directly into that project's Documents tab
   - `projects` state fetched on page load from `/api/projects`; `contactProjects` fetched lazily when contact changes via `GET /api/subcontractors/:id`

2. **Contact type badge on group headers** — each trade group shows orange folder + "Subcontractor" badge; Merchant/Supplier/Professional Services/Other groups show their colour-matched badge and folder icon; `GROUP_LABEL_TO_TYPE` reverse map added

3. **Contact type badge on individual cards** — all cards now show their type badge (Subcontractor = orange, matching group header colour scheme)

4. **Insurance certificates surfaced on contact cards** — `GET /api/subcontractors` list returns `insuranceRecords[]` per contact; card renders each as a coloured pill with type, expiry date, and open-certificate link

### Key files modified
- `artifacts/sitesort/src/pages/compliance/index.tsx` — full dialog redesign; new `DOCUMENT_TYPES` / `INSURANCE_SUBTYPES` constants; `assignDocType`, `assignProjectId`, `assignInsSubType`, `contactProjects` state; two-path `assignFile` function
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — `GROUP_LABEL_TO_TYPE` reverse map; type badges on group headers and cards; `insuranceRecords` display; `normaliseUrl` helper
- `artifacts/api-server/src/routes/subcontractors.ts` — `contactType` + `insuranceRecords` in list/create/update responses

### Notes for next session
- **File dialog paths**: insurance cert → `POST /api/subcontractors/:id/insurance`; all other types → `POST /api/projects/:id/documents`
- **Contact linked projects**: fetched from `GET /api/subcontractors/:id` `.assignedProjects` array (already returned by single-contact endpoint)
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts` (must run from `/home/runner/workspace`)
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
- All commits are on `main`

## End-of-session notes — 2026-06-10 (contacts filter + UK English)

### Tasks completed today

1. **Contact type filter chips on Contacts page** (`artifacts/sitesort/src/pages/subcontractors/index.tsx`):
   - Pill buttons: All · Subcontractor · Merchant · Supplier · Professional Services · Other
   - Active chip fills with type colour; works alongside existing text search
   - `typeFilter` state applied in `grouped` useMemo; dependency array updated
   - Filter chips rendered inline with the search bar (flex row, wraps on mobile)

2. **UK English** — "Compliance Center" → "Compliance Centre" in sidebar nav (`sidebar-layout.tsx`); page heading was already correct; no other US spellings found in visible UI text

### Key files modified
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — "Compliance Centre" spelling
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — `typeFilter` state + filter chip UI

### Notes for next session
- **Filter chips** use `CONTACT_TYPE_LABELS` entries prefixed with `["all", "All"]`; colour logic mirrors the badge colours on cards/headers
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts` (must run from `/home/runner/workspace`)
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
- All commits are on `main`
