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
8. Permit management (active/expiring/expired, responsible persons)
9. Compliance center (aggregate view across projects, drag-and-drop certificate upload)
10. Team management (admin/project_manager/site_worker/subcontractor roles)
11. Subcontractor cards — call/email/SMS/WhatsApp action buttons, visible contact details, trade badges, notes field
12. Add subcontractors from company directory into individual projects
13. Voice search on: Projects, Dashboard, Compliance, Team, Invoices, Admin pages
14. Full compliance page (was placeholder) — expiring insurance/permits, pending sign-offs, drag-and-drop file upload
15. Full team page (was placeholder) — members grouped by role, voice search, last-active
16. Team messaging — direct messages between team members, two-panel chat UI, 5s polling, unread badges
17. Message notifications — toast + browser OS notification on new message, live badge on sidebar Messages item and bell icon, manager "View All" read-only oversight mode
18. Notifications page (`/notifications`) — filter tabs (All/Unread/Messages/Documents/Safety), per-type icons, click-to-read, mark-all-read, badge clears on visit, navigates to related entity on click
19. Invoice file attachments — drag-and-drop or click-to-upload per invoice row, `attachmentUrl` column on invoices table, Open/Email/WhatsApp share dropdown, remove button
20. Document & certificate sharing — Open + Email/WhatsApp share on project documents tab and compliance insurance certificate rows; compliance API extended to include `certificateUrl`
21. Settings page (`/settings`) — Profile (name/phone/avatar upload), Security (change password), Notifications (toast + OS toggles in localStorage), Company (admin: name/size); API: `PATCH /auth/me`, `POST /auth/change-password`, `GET/PATCH /companies/mine`
22. Document supersedes selector — upload form shows optional dropdown of current docs of the same type; selecting one marks it superseded on save; API accepts explicit `supersededDocumentId` with same-name auto-supersede fallback
23. Document status/version editing — Edit button on document rows opens dialog to change status (current/superseded) and version number; `PATCH /api/documents/:documentId`
24. Subscription billing — Stripe Checkout (Solo £29/Team £79/Pro £149, 14-day trial), webhook sync, Customer Portal, plan-based project limits, trial-ending and payment-failed notifications
25. Read-only mode on cancellation — persistent red banner on all authenticated pages; all write actions across every page show a destructive toast and return early when cancelled; voice modal openers redirect to billing; settings profile/password/company show inline error banner; `SubscriptionContext` exposes `isCancelled` app-wide
26. Global voice command navigation — mic button in sidebar and desktop header bar; Web Speech API listens for navigation and action commands; floating hint overlay with examples; toast feedback on match or no-match; hidden on unsupported browsers. Action commands: "new project" → `/projects?new=1`; "new invoice" → `/invoices?new=1`; "find invoice" / "recall invoice" → `/invoices?recall=1`; "add subcontractor" → `/subcontractors?new=1`; "find subcontractor [term]" → `/subcontractors?q=<term>` or `?find=1`; "upload compliance/certificate" → `/compliance?upload=1`; "find/recall compliance [term]" → `/compliance?q=<term>` or `?find=1`; "new/send message" → `/messages?new=1`; "send message to [name]" → `/messages?to=<name>`; "dictate message" → `/messages?dictate=1`; "log safety issue" / "report hazard" → `/projects?safety=1`; "add/new permit" → `/projects?permit=1` (opens add permit modal); "find/recall permit [term]" → `/compliance?q=<term>` (filters expiring permits by type/project); "upload/log/new photo" → `/projects?photo=1` (opens photo log modal); "recall/find/view photos" → `/projects?viewphoto=1` (navigates to project photos tab)
27. Photo voice commands — "upload photo" / "log photo" / "new photo" opens a global photo log modal (project picker, category, voice-dictated description, zone, file upload with preview); "recall photos" / "find photos" navigates to the active project's Photos tab; Photos tab in project detail built out as a full colour-coded grid (thumbnail, category badge, reference number, zone, date, uploader); `?tab=photos` URL param selects the Photos tab on load
28. Real user dashboard — personalised greeting, quick-action buttons, 4-stat cards (active projects/expiring items/pending sign-offs/unread messages), "Needs Attention" panel, recent activity feed, portfolio snapshot, site calendar
29. Invoice document viewer — full-screen inline viewer panel; PDF via iframe, image via img tag, fallback open-in-tab; sidebar with invoice details; header actions: open in new tab, share, mark paid
30. Project detail report / PDF export — "Export Report" button generates a print-ready HTML report (team, permits, documents, finances, photos) and auto-triggers browser Save-as-PDF
31. Subcontractor "Add to Project" — FolderPlus button on each sub card opens a dialog listing active projects; one-click add with inline per-project feedback (added/already linked/error)
32. Enforced subcontractor directory-first workflow — removed "Add Person" form and dialog from the project Team tab; contacts must be added to the subcontractor directory first, then linked into a project via "Add from Subcontractor Directory"
33. Broadcast messaging — "New" button in Messages opens a three-mode picker: Individual (1-to-1), By Role (filter project members by Admin/PM/Site Worker/Subcontractor), All in Project; backend `POST /api/messages/broadcast` sends message + notification per recipient
34. Landing page pricing section — "Start Free Trial" smooth-scrolls to Solo £29/Team £79/Pro £149 plan cards; Book Demo button removed
35. Invoice sharing in messages — Receipt button in compose bar opens an invoice picker; selected invoice renders as a card in the thread (counterparty, amount, status badge, due date, PDF link); `invoiceId` nullable column on messages table; `content` defaults to `""` to allow invoice-only messages
36. Document, photo, and permit sharing in messages — Paperclip button in compose bar opens a tabbed picker (Document / Photo / Permit) with a project selector; selected item shown as a violet chip; thread renders typed cards: document (name, type, version, view link), photo (thumbnail, category, reference), permit (type, description, expiry status badge); `attachmentType` + `attachmentId` columns on messages table; API thread endpoint batch-fetches attachment data
37. Project channel group messaging — each active project gets a shared `#channel` thread visible to all project members; appears above DMs in sidebar with blue `#` icon and unread badge; full attachment support (doc/photo/permit cards); sender name + role chip on every message; edit/delete own messages; 5s polling; notifications to all project members on send; `channel_messages` + `channel_reads` tables; `GET/POST /api/channels/:projectId/messages`, `PATCH/DELETE /api/channel-messages/:id`

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22 (latest — see CLAUDE_ARCHIVE.md for full detail)

#### All features completed this session
- Global voice command navigation (mic in sidebar + header, hint overlay, toast feedback)
- Voice action commands: new project/invoice/message, find subcontractor/compliance/permit/invoice, safety issue modal, permit modal, photo upload modal, photo recall
- Photo voice commands + Photos tab in project detail (colour-coded grid, category badges)
- Read-only mode on cancellation (`SubscriptionContext`, persistent red banner app-wide)
- Message editing + deletion (inline pencil/trash, `PATCH`/`DELETE /api/messages/:id`, `editedAt` column)
- Stripe: webhook handler, project gating, Customer Portal, trial-ending + payment-failed notifications

### 2026-05-25

#### Tasks completed
- **Real user dashboard** — full rebuild of `artifacts/sitesort/src/pages/dashboard/index.tsx`:
  - Personalised greeting with user's first name (fetched from `GET /api/auth/me`) and today's full date
  - Quick-action buttons in header: New Project → `/projects?new=1`, Log Photo → `/projects?photo=1`, Message → `/messages?new=1`, Upload Doc → `/compliance?upload=1`
  - 4-stat cards: Active Projects, Expiring Soon (insurance + permits in 30d), Pending Sign-offs, Unread Messages — each links to its page and colour-codes when non-zero
  - "Needs Attention" panel — only renders when items exist; surfaces expired/near-expiry compliance, overdue invoices, pending sign-offs, unread messages as clickable rows
  - 2-column main area: active project cards (left 2/3, horizontal with progress %, team count, due date) + Recent Activity feed (right 1/3, last 8 notifications with per-type icons and time-ago labels)
  - Portfolio Snapshot card: avg. progress bar, total team size, on-track project ratio
  - Removed dev-only "Send Test Email" button
  - Site Calendar and expiry-alert list retained at bottom

#### Key files modified
- `artifacts/sitesort/src/pages/dashboard/index.tsx` — full rewrite; fetches `/api/auth/me`, `/api/notifications`, `/api/messages/unread-count`, `/api/invoices` alongside existing hooks

- **Inline invoice document viewer** — clicking any invoice row (or eye icon) opens a full-screen viewer panel:
  - Left sidebar: counterparty, direction, amount, status badge, due date, description, created date; "Attach document" shortcut if no file attached
  - Right pane: PDF rendered via `<iframe>`, images via `<img>`, fallback "Open file" link for other formats, empty state prompting upload if no attachment
  - Header actions: Open in new tab, Share (Email/WhatsApp dropdown), Mark Paid, Close
  - File type detected from URL extension (`.pdf` → iframe, `.png/.jpg/.jpeg/.webp/.gif` → img)

#### Key files modified
- `artifacts/sitesort/src/pages/invoices/index.tsx` — invoice viewer overlay added (custom wide panel, not Dialog which is max-w-lg); `ExternalLink`, `FileText`, `Image` icons added

- **Project detail report / PDF export** — "Export Report" button in project header (next to "Edit Details") opens a print-ready HTML page in a new tab and auto-triggers the browser print/Save-as-PDF dialog. Report sections: project summary (name, address, status badge, start/end dates, progress bar), team grouped by trade, permits sorted by expiry with colour-coded status, documents with sign-off counts, finances (due-to-you/you-owe summary + invoice list), photo log count by category. Zero new dependencies — uses `window.open` + `window.print()` with `print-color-adjust: exact`.

#### Key files modified
- `artifacts/sitesort/src/pages/projects/detail.tsx` — `generateReport()` function + `FileDown` icon + "Export Report" button in project header

- **Subcontractor "Add to Project"** — `FolderPlus` icon button on each subcontractor card opens a dialog to link the sub into any active project. Dialog shows sub summary + active project list; each project row is a one-click "Add" button with inline per-project feedback: spinner → "Added ✓" (200), "Already on project" (409 conflict), "Failed — retry?" (other errors). Error rows stay clickable for retry without closing.

#### Key files modified
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — `shareTarget`/`shareProjects`/`linkStatus` state; `useEffect` fetches active projects on open; `linkToProject()` calls `POST /api/projects/:id/members/link`; share dialog JSX; `FolderPlus`, `CheckCircle2`, `Loader2`, `Building2` icons added

### 2026-05-25 (continued)

#### Tasks completed
- **Enforced directory-first contact workflow** — removed the "+ Add Person" button from each trade folder in the project Team tab, removed the Add Person dialog and `submitAddPerson` handler, and removed associated state/form (`addPersonTrade`, `addPersonError`, `personRegister`). All contacts must now be added to the subcontractor directory first and then linked into a project via the "Add from Subcontractor Directory" button. Updated empty-state copy to reflect this.

#### Key files modified
- `artifacts/sitesort/src/pages/projects/detail.tsx` — removed `addPersonTrade` state, `submitAddPerson` function, "+ Add Person" trade folder button, and Add Person dialog

### 2026-05-25 (session 3)

#### Tasks completed

- **Cancellation enforcement on all write actions** — every create/edit/delete operation now checks `isCancelled` before executing; shows a destructive toast and returns early. Voice command modal openers (safety, permit, photo, new subcontractor) also redirect to billing when cancelled.
  - Pages gated: projects list (photo, permit, safety modals), project detail (upload doc, edit doc, edit project, add trade, save phone), subcontractors (add sub, link to project), messages (send, edit, delete), invoices (create, delete, attach file, mark paid)

- **Cancellation enforcement on settings page** — Profile save + avatar upload, Change Password, Company save all show an inline red `StatusBanner` and return early when cancelled. Billing and Notifications tabs intentionally ungated.

- **Removed "Book Demo" button** from landing page hero — "Start Free Trial" is now the only CTA.

- **Pricing section on landing page** — "Start Free Trial" smooth-scrolls to a new `#pricing` section showing Solo £29 / Team £79 / Pro £149 plan cards, each with their own "Start free trial" → `/register` button. Trial badge and Stripe disclaimer included.

- **Feature card bullet alignment fix** — changed `list-inside` to `list-outside pl-5` on the three dark feature cards so bullets sit flush left.

- **Broadcast messaging** — "New" button in messages now opens a three-mode picker:
  - **Individual**: existing 1-to-1 flow (unchanged)
  - **By Role**: pick a project → filter by role chip (Admin/PM/Site Worker/Subcontractor) → compose → "Send to X members"
  - **All in Project**: pick a project → send to all members with accounts
  - Backend: `POST /api/messages/broadcast` inserts a message + notification per recipient
  - Also fixed pre-existing `authHeaders()` TypeScript return-type issue in messages page

#### Key files modified
- `artifacts/sitesort/src/pages/projects/index.tsx` — cancellation guards on submitPhoto, submitPermit, submitSafetyIssue; modal-opener useEffects redirect to billing
- `artifacts/sitesort/src/pages/projects/detail.tsx` — cancellation guards on onUpload, saveDocEdit, onEditSubmit, submitAddTrade, savePhone
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — cancellation guards on onAdd, linkToProject; ?new=1 voice command blocked
- `artifacts/sitesort/src/pages/messages/index.tsx` — cancellation guards on sendMessage, saveEdit, deleteMessage; broadcast mode picker; authHeaders() fix
- `artifacts/sitesort/src/pages/invoices/index.tsx` — cancellation guards on onSubmit, deleteInvoice, attachFile, markPaid
- `artifacts/sitesort/src/pages/settings/index.tsx` — isCancelled prop threaded to ProfileTab, SecurityTab, CompanyTab
- `artifacts/sitesort/src/pages/landing.tsx` — removed Book Demo button; added #pricing section; fixed bullet alignment
- `artifacts/api-server/src/routes/messages.ts` — added POST /api/messages/broadcast endpoint

#### Pending / open tasks
- File storage migrated to object storage (done in prior session)
- No message search or pagination yet
- Stripe Dashboard setup needed: activate Customer Portal; add all 5 webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`)

### 2026-05-25 (session 4)

#### Tasks completed

- **Invoice sharing in messages** — Receipt button in compose bar opens a picker dropdown of all company invoices; selected invoice shows as a blue chip above the input; sends `invoiceId` with the message; thread renders an invoice card (counterparty, amount/currency, status badge, due date, optional PDF link). Schema: `invoiceId` nullable column + `content` changed to `.default("")` to allow invoice-only messages. DB migrated.

- **Document, photo, and permit sharing in messages** — Paperclip button in compose bar opens a tabbed picker (Document / Photo / Permit) with a project dropdown. Selecting an item shows a violet chip preview above the input. Thread renders typed cards for each:
  - Document: name, type, version badge, status badge, view-document link
  - Photo: thumbnail (if available), category badge, reference number, zone, description
  - Permit: type, description, colour-coded expiry badge (Active / Expiring soon / Expired), view-permit link
  - Schema: `attachmentType` + `attachmentId` nullable columns on messages table. DB migrated.
  - API: thread endpoint batch-fetches docs/photos/permits by IDs and returns as `attachment` field; POST endpoint accepts `attachmentType` + `attachmentId`

#### Key files modified
- `lib/db/src/schema/messages.ts` — added `invoiceId`, `attachmentType`, `attachmentId` columns; `content` → `.default("")`
- `artifacts/api-server/src/routes/messages.ts` — thread endpoint fetches and returns `invoice` + `attachment`; POST accepts all new fields; imports `documentsTable`, `photosTable`, `permitsTable`
- `artifacts/sitesort/src/pages/messages/index.tsx` — `DocAttachment`, `PhotoAttachment`, `PermitAttachment` types; attach picker state + effects; `openAttachPicker()`; `Paperclip` button; tabbed picker UI with project selector; typed attachment cards in thread; updated send button guard

#### Pending / open tasks
- No message search or pagination yet
- Stripe Dashboard setup needed: activate Customer Portal; add all 5 webhook events

### 2026-05-25 (session 5)

#### Tasks completed

- **Project channel group messaging** — each active project gets a shared group thread available to all project members:
  - Sidebar: "Project Channels" section above Direct Messages; each channel shown as `#ProjectName` with blue `#` icon and unread badge (count resets on open)
  - Thread: all members' messages with sender name + role chip; edit/delete on own messages; 5s polling
  - Attachments: full doc/photo/permit card rendering (same as DMs); Paperclip picker + voice dictation in compose bar
  - Notifications: sending a channel message notifies all other project members via `notificationsTable`
  - Read tracking: `channel_reads` table stores `lastReadAt` per user per project; unread count = messages after `lastReadAt` by other users
  - Admins/PMs see all active company projects as channels; other roles see only projects they're a member of

#### Key files added/modified
- `lib/db/src/schema/channel_messages.ts` — new table: id, projectId, companyId, senderId, content, attachmentType, attachmentId, editedAt, createdAt
- `lib/db/src/schema/channel_reads.ts` — new table: projectId, userId, lastReadAt
- `lib/db/src/schema/index.ts` — exports new tables
- `artifacts/api-server/src/routes/channels.ts` — new route file: GET /api/channels, GET/POST /api/channels/:projectId/messages, PATCH/DELETE /api/channel-messages/:id
- `artifacts/api-server/src/routes/index.ts` — registered channelsRouter
- `artifacts/sitesort/src/pages/messages/index.tsx` — Channel + ChannelMessage types; channel state + fetch/poll effects; sendChannelMessage, saveChannelEdit, deleteChannelMessage; channels section in sidebar; full channel thread panel with compose area

#### Technical notes
- `lib/db` is a composite TypeScript project (`composite: true`, `emitDeclarationOnly: true`); adding new schema files requires running `npx tsc -p tsconfig.json` in `lib/db/` to regenerate `dist/` `.d.ts` files before the api-server typecheck will pick up the new exports
- DB migrated with `pnpm --filter @workspace/db run push`

#### Pending / open tasks
- No message search or pagination yet
- Stripe Dashboard setup needed: activate Customer Portal; add all 5 webhook events

---

## End-of-session notes — 2026-05-25

### All tasks completed today (across 5 sessions)

1. **Cancellation enforcement** — all write actions across every page (projects, project detail, subcontractors, messages, invoices, settings) check `isCancelled` and return early with a destructive toast or inline `StatusBanner`
2. **Landing page** — removed Book Demo button; "Start Free Trial" smooth-scrolls to new `#pricing` section (Solo £29 / Team £79 / Pro £149); fixed bullet alignment on dark feature cards
3. **Broadcast messaging** — three-mode picker (Individual / By Role / All in Project); backend `POST /api/messages/broadcast`
4. **Invoice sharing in messages** — Receipt button, invoice picker, invoice card in thread; `invoiceId` + `content` default schema changes
5. **Document / photo / permit sharing in messages** — Paperclip picker with tabbed project selector; typed attachment cards in thread; `attachmentType` + `attachmentId` schema columns
6. **Project channel group messaging** — `#ProjectName` shared threads for all project members; full attachment support; unread counts; notifications; `channel_messages` + `channel_reads` tables

### Fixes applied
- Fixed pre-existing `authHeaders()` TypeScript return-type error in messages page (`{ Authorization: string } | {}` → `Record<string, string>`)
- Fixed `lib/db` composite project stale `.d.ts` cache blocking api-server typecheck of new schema exports — resolved by running `npx tsc -p tsconfig.json` in `lib/db/`

### Known pre-existing issues (not introduced today)
- TypeScript errors in `alert-dialog.tsx`, `calendar.tsx`, `command.tsx`, `pagination.tsx` (missing `buttonVariants` / `DialogContent` exports), `dashboard/index.tsx`, `projects/detail.tsx`, and Drizzle ORM `eq()` overload errors across api-server routes — none affect runtime
- `lib/api-zod` duplicate export error (`ListDocumentsParams`, `ListPhotosParams`) blocks root `pnpm typecheck` but does not affect the app

### Notes for next session
- **Good next messaging features**: message reactions (thumbs up / tick), reply-to-a-specific-message (WhatsApp-style quote), quick-reply templates for site workers, message search
- **Stripe still needs manual setup**: activate Customer Portal in Stripe Dashboard; register all 5 webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`)
- **When adding new DB schema files**: always run `npx tsc -p tsconfig.json` inside `lib/db/` after editing `src/schema/index.ts` to regenerate `dist/` before typechecking api-server
- All commits are on `main`; push via `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
