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
47. Superseded document archiving — `archivedAt` column on `insurance_records` and `permits`; uploading a new insurance cert for the same contact+type auto-archives the old one; creating a new permit of the same type for the same project auto-archives the old one; Compliance Centre shows collapsible "Superseded" sections for insurance, permits, and documents (status=superseded) with Open/Share buttons; project Permits tab splits active/expiring/expired vs. a collapsible Superseded section; contact cards and insuranceStatus only reflect non-archived records; QR board pins and Finances permit list exclude archived permits
48. Site Issues log — `status` + `resolvedAt` columns on `photos` table; new snags/safety_concern photos auto-set `status="open"`; `GET /api/photos/:id` returns full data; `PATCH /api/photos/:id` for status updates (open/in_progress/resolved); `GET /api/issues` returns all snag+safety_concern photos company-wide; new `/issues` page (sidebar: Site Issues) with summary counts, type/status/search filters, thumbnail list, full detail modal with GPS, share, and resolve actions; project Photos tab cards now open a detail modal instead of raw image; dashboard safety_concern activity click deep-links to `?tab=photos&photo=<id>` auto-opening the modal uploading a new insurance cert for the same contact+type auto-archives the old one; creating a new permit of the same type for the same project auto-archives the old one; Compliance Centre shows collapsible "Superseded" sections for insurance, permits, and documents (status=superseded) with Open/Share buttons; project Permits tab splits active/expiring/expired vs. a collapsible Superseded section; contact cards and insuranceStatus only reflect non-archived records; QR board pins and Finances permit list exclude archived permits
49. Password visibility toggle — Eye/EyeOff icon button in all password fields on login and register pages; `showPassword` state toggles `type="text"/"password"`; uses existing `Input` `rightAction` prop; `p-1` padding for adequate mobile tap target; covers login (1 field), register main form (Create + Confirm), and register invite flow (1 field)
50. Mobile/tablet UX hardening — site board check-in `capture="environment"` removed so file picker opens correctly on all tablets/iPads; text overflow and horizontal scroll fixed across 6 pages (project header address, compliance permit/doc/sign-off rows, invoices table counterparty, team member name/phone, issues project name/zone, settings profile name)
51. Site Check-Ins page (`/checkins`) — company-wide aggregated log of all QR site board check-ins; photo grid with search (worker/company/project) and project-filter dropdown; 3-stat header (total/today/this week); click-to-expand detail modal with GPS map link, open photo, and share actions; `GET /api/checkins` (auth, tenant-scoped); sidebar "Site Check-Ins" nav item under admin nav
52. In House Team enhancements — contact action buttons (call/SMS/WhatsApp/email) on each team member card matching subcontractor directory style; Notes & Reminders dialog (StickyNote button) per member backed by `user_notes` table and `GET/POST /api/users/:userId/notes`; "Add Team Member" button (admin/PM only) opens invite dialog with name/email/role/phone fields and optional project checklist; creates user account, sends invitation email with generated credentials, and links to selected projects in one step; fixed note text overflow with `break-words`
53. Site Issues moved to each project — "Site Issues" tab added to project detail (stats, search, status filter, quick resolve, opens photo detail modal); removed from global sidebar nav; share via Email/WhatsApp now includes full issue details block (type, ref, description, zone, project, status, logged-by, date, GPS) via new `additionalInfo` prop on ShareModal; Dialog z-index bumped to `z-[60]` so share modal always renders above `z-50` detail overlays; subcontractor notes scoping fixed — contacts directory shows only general notes, project-specific notes stay in project Team tab only
54. Project overview daily notes Open/Share — each "Posted today" note card has ExternalLink (full-body detail dialog with copy + chain-to-share) and Share2 (ShareModal with Email/WhatsApp/Team/Individual) buttons; ShareModal extended with `shareText?: string | null` prop so text-only entities share without a fileUrl; Site Issues tab moved to between Team and Site Board in the project tab group order
55. Mobile/tablet responsive fixes — notifications filter tabs: overflow-x-auto + whitespace-nowrap so 5 tabs scroll on narrow screens; settings tab nav: overflow-x-auto on mobile so nav scrolls instead of overflowing; projects list "View Site" button: visible at lg breakpoint (touch tablets), hover-only at xl+ (desktop with pointer)
54. Overview tab daily note Open/Share — each "Posted today" note card has ExternalLink (Open) and Share2 (Share) icon buttons; Open shows a detail dialog with full text, author/date, Copy text button, and a chain-to-Share button; Share opens ShareModal with Email / WhatsApp / Project Team / Individual — note body sent as message content; ShareModal extended with `shareText?: string | null` prop so text-only items (no fileUrl) can use all share methods via `hasContent = !!(fullUrl || shareText)`; Site Issues tab reordered within Group 1 to sit between Team and Site Board

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22 through 2026-06-10 (all sessions up to and including site issues log) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-11 (tablet fixes + overflow audit + eye icon)

### Tasks completed today

1. **Site board check-in fix for tablets** (`artifacts/sitesort/src/pages/site-board.tsx`):
   - Removed `capture="environment"` from the check-in photo file input
   - On iPads and Android tablets, this attribute silently prevents the file picker from opening; removing it lets the OS standard picker appear (which still offers camera as an option)

2. **Text overflow / horizontal scroll audit and fixes** (6 files):
   - `projects/detail.tsx` — address in project header now uses `flex-wrap` + `truncate` + `shrink-0` on date; very long addresses no longer cause horizontal scroll
   - `compliance/index.tsx` — added `truncate` to permit type, project names, sign-off document names, and all superseded row detail lines (insurance, permits, documents)
   - `invoices/index.tsx` — counterparty name and reference in desktop table now have `max-w-[160px] truncate`
   - `team/index.tsx` — member name and phone in cards now truncate properly
   - `issues/index.tsx` — project name and zone use `truncate max-w-*`; date/uploader uses `whitespace-nowrap`
   - `settings/index.tsx` — profile display name capped with `truncate max-w-[200px]`

3. **Password eye icon on login page** (`artifacts/sitesort/src/pages/auth/login.tsx`):
   - Added `showPassword` state and Eye/EyeOff toggle button via existing `Input` `rightAction` prop
   - Register page already had this on all 3 password fields (main form + invite flow)
   - Added `p-1` padding to all 4 eye buttons across login + register for larger mobile tap targets (~24px vs bare 16px icon)

### Key files modified
- `artifacts/sitesort/src/pages/site-board.tsx` — removed `capture="environment"`
- `artifacts/sitesort/src/pages/projects/detail.tsx` — address truncation in header
- `artifacts/sitesort/src/pages/compliance/index.tsx` — truncate on permit/doc/sign-off rows
- `artifacts/sitesort/src/pages/invoices/index.tsx` — counterparty name max-w + truncate
- `artifacts/sitesort/src/pages/team/index.tsx` — member name + phone truncate
- `artifacts/sitesort/src/pages/issues/index.tsx` — project name, zone, uploader truncation
- `artifacts/sitesort/src/pages/settings/index.tsx` — profile name truncate
- `artifacts/sitesort/src/pages/auth/login.tsx` — eye icon added
- `artifacts/sitesort/src/pages/auth/register.tsx` — p-1 padding on existing eye buttons

### Notes for next session
- **Overflow audit**: Dashboard, Messages, Projects list table, and Subcontractors cards were all already clean — no changes needed
- **Photo status backfill**: still pending if desired — `UPDATE photos SET status='open' WHERE category IN ('snag','safety_concern') AND status IS NULL`
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts` (must run from `/home/runner/workspace`)
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
- All commits are on `main`

---

## End-of-session notes — 2026-06-12 (check-ins page, notes fixes, team enhancements)

### Tasks completed today

1. **Site Check-Ins page (`/checkins`)** — committed leftover work from previous session:
   - `GET /api/checkins` — company-wide check-in log, tenant-scoped, ordered by date
   - New `/checkins` frontend page: photo grid, search (worker/company/project), project-filter dropdown, 3-stat header (total/today/this week), click-to-expand detail modal with GPS map link, open and share actions
   - Sidebar "Site Check-Ins" nav item (ClipboardCheck icon) under admin nav

2. **Subcontractor notes fixes** (2 files):
   - **Text overflow**: added `break-words min-w-0` to note body `<p>` in both the contacts directory dialog and the project Team tab dialog — long text now wraps instead of overflowing
   - **Wrong notes in contacts**: changed `GET /api/subcontractors/:id/notes` so that with no `?projectId` it returns only general notes (`projectId IS NULL`); project-specific notes no longer leak into the contacts directory view. Project Team tab already passes `?projectId` so it still shows general + project notes.

3. **In House Team — contact actions + notes** (`artifacts/sitesort/src/pages/team/index.tsx`):
   - Added Call (tel:), SMS (sms:), WhatsApp (wa.me/), Email (mailto:) action buttons per card, matching the subcontractor directory style
   - Added Share dropdown (email / WhatsApp) — was already present, kept and restyled into the new action row
   - Added Notes & Reminders dialog (StickyNote button): text area, Add Note (Ctrl+Enter), timestamped history
   - New `user_notes` DB table (`lib/db/src/schema/user_notes.ts`): id, userId FK (cascade-delete), authorId FK, body, createdAt
   - New API endpoints: `GET /api/users/:userId/notes` and `POST /api/users/:userId/notes` (tenant-scoped IDOR-safe)

### Key files modified
- `artifacts/api-server/src/routes/qr.ts` — `GET /api/checkins` endpoint
- `artifacts/sitesort/src/pages/checkins/index.tsx` — new check-ins page (created)
- `artifacts/sitesort/src/App.tsx` — `/checkins` route
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — Site Check-Ins nav item
- `artifacts/api-server/src/routes/subcontractors.ts` — notes scope fix (general-only when no projectId)
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — break-words on note body
- `artifacts/sitesort/src/pages/projects/detail.tsx` — break-words on note body
- `lib/db/src/schema/user_notes.ts` — new table (created)
- `lib/db/src/schema/index.ts` — export user_notes
- `artifacts/api-server/src/routes/users.ts` — user notes endpoints
- `artifacts/sitesort/src/pages/team/index.tsx` — contact actions + notes dialog

### Notes for next session
- **Photo status backfill**: still pending — `UPDATE photos SET status='open' WHERE category IN ('snag','safety_concern') AND status IS NULL`
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
- All commits are on `main`

---

## End-of-session notes — 2026-06-12 (team enhancements, site issues refactor, share fix)

See CLAUDE_ARCHIVE.md for full detail.

---

## End-of-session notes — 2026-06-12 (overview note open/share, tab reorder, auto-push hook)

### Tasks completed today

1. **Overview tab daily notes — Open and Share** (`artifacts/sitesort/src/pages/projects/detail.tsx`, `artifacts/sitesort/src/components/share-modal.tsx`):
   - Each "Posted today" note card now has two icon buttons (bottom-right): ExternalLink (Open) and Share2 (Share)
   - **Open**: opens a detail dialog showing full note body, author/date, Copy text button, and a "Share" button that chains directly into the share modal
   - **Share**: opens ShareModal with Email / WhatsApp / Project Team / Individual — note body used as message content
   - `ShareModal` extended with optional `shareText?: string | null` prop; `hasContent = !!(fullUrl || shareText)` enables Email/WhatsApp even with no file; in-app team/individual sends `shareText` as message content
   - New state: `openingNote: DailyNote | null`, `sharingNote: DailyNote | null` in project detail
   - entityType `"daily_note"` used for share logging

2. **Site Issues tab reordered** (`artifacts/sitesort/src/pages/projects/detail.tsx`):
   - Moved from Group 2 (Site activity) into Group 1 (Project management)
   - New tab order: Overview → Progress → Team → **Site Issues** → Site Board → Documents → Compliance

3. **Auto-push to GitHub hook** (`.claude/settings.local.json`):
   - `PostToolUse` hook on `Bash` matcher; checks `git commit` in command, then runs `github-push.ts`
   - 120s timeout; status message "Pushing to GitHub…" shown while running
   - GitHub push now happens automatically after every `git commit` — no manual push needed

### Key files modified
- `artifacts/sitesort/src/components/share-modal.tsx` — `shareText` prop + `hasContent` logic
- `artifacts/sitesort/src/pages/projects/detail.tsx` — note Open/Share buttons + dialogs + tab reorder
- `.claude/settings.local.json` — PostToolUse auto-push hook added

### Notes for next session
- **GitHub push is now automatic** — fires after every `git commit` via hook in `.claude/settings.local.json`
- **Photo status backfill**: still pending — `UPDATE photos SET status='open' WHERE category IN ('snag','safety_concern') AND status IS NULL`
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
- All commits are on `main`

---

## End-of-session notes — 2026-06-12 (mobile/tablet responsive audit)

### Tasks completed today

1. **Mobile/tablet responsive audit** — code-level audit of all pages against desktop layout; identified 3 broken issues and fixed them:
   - `notifications/index.tsx`: filter tabs container got `overflow-x-auto`; each tab button got `whitespace-nowrap flex-shrink-0` — 5 tabs no longer overflow on 375px mobile
   - `settings/index.tsx`: tab nav wrapper got `overflow-x-auto md:overflow-visible`; buttons got `whitespace-nowrap md:w-full` — nav scrolls horizontally on mobile
   - `projects/index.tsx`: desktop table "View Site" button changed from `opacity-0 group-hover:opacity-100` to `opacity-100 xl:opacity-0 xl:group-hover:opacity-100` — visible on touch tablets at lg, hover-only on xl+ desktops
   - Confirmed OK (no changes needed): messages compose/actions, compliance rows, subcontractors, project detail tabs, invoices, dashboard, QR/reports tabs, team page, sidebar

### Key files modified
- `artifacts/sitesort/src/pages/notifications/index.tsx` — filter tab overflow fix
- `artifacts/sitesort/src/pages/settings/index.tsx` — nav overflow fix
- `artifacts/sitesort/src/pages/projects/index.tsx` — View Site button touch visibility fix

### Notes for next session
- **GitHub push is automatic** via PostToolUse hook
- **Photo status backfill**: `UPDATE photos SET status='open' WHERE category IN ('snag','safety_concern') AND status IS NULL`
- **API server rebuild**: `pnpm --filter @workspace/api-server run build` after any backend change
