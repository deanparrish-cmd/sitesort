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

There is no git remote pointing to GitHub. Pushes go through the Replit GitHub connector (no token needed) to `deanparrish-cmd/sitesort` via the GitHub Git Data API. Run scripts with `pnpm --filter @workspace/scripts exec tsx ./src/<name>.ts` (plain `npx tsx` fails — tsx only lives in `scripts/node_modules`).

**USE `scripts/src/push-robust.ts`** — `pnpm --filter @workspace/scripts exec tsx ./src/push-robust.ts`. The old `github-push.ts` is **BROKEN: it never checks HTTP status, so failures are silent** (it prints "Done!" even when nothing pushed — this left the repo EMPTY for a long time). `push-robust.ts` fixes it: bounded concurrency (6) + retries, status checks at every step, and it skips files whose base64 payload would exceed the proxy's **~1MB body limit** (nginx 413).

Three gotchas push-robust handles (learned 2026-06-18):
1. **Empty repo** → the Git Data API (blobs/trees) returns 409 "Git Repository is empty". You must seed ONE commit via the **Contents API** first (`scripts/src/bootstrap-repo.ts` — `PUT /contents/README.md`). Only needed once, when the repo has zero commits.
2. **Proxy ~1MB limit** → files >~650KB raw (auth-bg.png, hero PNGs, attached_assets) get HTTP 413 and are **skipped** (logged). Large binary assets do NOT push — code/text all pushes fine.
3. **Junk dirs** → `.config/chromium` crash dumps (from the browser-check skill) choke blob creation; push-robust ignores `.config`/`.npm`/`tmp` etc.
4. Pushes use **`base_tree` (additive)** — files removed locally are NOT deleted from GitHub. After a push, verify with `scripts/src/verify-push.ts` (checks signature strings of changed files on `main`).

To create the repo fresh: `pnpm --filter @workspace/scripts exec tsx ./src/github-setup.ts`

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
56. Site Calendar deep-links + custom events — dashboard calendar day-dialog events deep-link to the specific item (project detail / `?tab=permits` Compliance tab / invoice viewer via `?invoice=<id>`); managers (admin/PM) can add custom events (title + date + optional note) via "Add Event" / "Add event on this day", shown as a violet dot and deletable; `calendar_events` table + `GET/POST/DELETE /api/calendar-events` (POST/DELETE manager-gated, tenant-scoped). Each event has an optional `projectId` (null = whole company): the Add dialog has a "Show on site board for" selector (Whole company / a project) and the day dialog shows a violet scope badge. **QR site board** public page (`GET /api/site/:token`) now returns `upcomingEvents` — company-wide + that-project events, dated today-or-later, ascending — rendered as an "Upcoming Events" card on the public site board
58. Dashboard outstanding-invoices widget — full-width "Outstanding Invoices" card on the main dashboard (`pages/dashboard/index.tsx`), between Needs Attention and Active Projects. Shows up to 5 unpaid/overdue invoices (overdue first, then soonest due) with `(N)` total count and a "View all → /invoices" link. Each row: counterparty avatar (emerald inbound / rose outbound), name + reference·description, amount, In/Out indicator, status badge (Paid/Overdue/Due in Nd via local `InvoiceStatusBadge`), due date, and labeled rounded-full pills — **Open** (navigates `/invoices?invoice=<id>` → existing deep-link auto-opens the viewer), **Share** (only when `attachmentUrl`; opens `ShareModal entityType="invoice"`), **Mark Paid** (amber, `caps.canManageInvoices`-gated). Mark Paid PATCHes `status:"paid"`, optimistically drops the row, then opens the move-to-project picker **only if the invoice is unassigned** (`!projectId`) else toasts confirmation. No new API — reuses the dashboard's existing `invoices` fetch (`GET /api/invoices`). No Mark Unpaid pill (list is unpaid-only; that action lives on `/invoices` + project Finances). Verified in real browser (single-origin :8080 build, paul@acme.com): widget renders, Open/Share/Mark Paid pills present, Mark Paid flips status + removes row, no console/page errors.
59. Multi-threshold expiry email reminders — permits (→ responsible user) and subcontractor insurance certs (→ company admins) email at **30/21/14/7/1 days before expiry** (one per threshold) then **daily for up to 7 days after expiry** (`exp-0`…`exp-6`), then stop. `expiry_reminder_logs` table (`entity_type, entity_id, milestone`, unique on all three; in `ensure-schema.ts` boot migration) de-dups so each milestone sends exactly once even across restarts. `permit-reminders.ts` daily job: `milestoneFor(daysLeft)` maps days-remaining to the smallest threshold ≥ daysLeft (an item first seen mid-window gets one reminder, not a burst); `claimMilestone()` inserts `onConflictDoNothing` and only emails on first insert; archived (`archivedAt`) records skipped. `sendPermitExpiryEmail` extended with expired/expires-today wording (insurance email already had it). Dashboard "Expiring Soon"/Needs Attention + calendar already surface everything ≤30 days incl. expired via the compliance API (`expiry <= in30Days`), so no frontend change was needed.

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Key Architecture Notes

**⚠️ Schema changes → `ensure-schema.ts` (CRITICAL):** Prod DB is separate from workspace. `drizzle push` does NOT migrate prod. All new tables/columns MUST be added to **`lib/ensure-schema.ts`** (idempotent boot migration run from `index.ts` before `app.listen`) or prod will query a non-existent table and break login. **Pattern for ALL future schema changes.**

**`company_members` model (Feature #57):** `company_members` table (`id, userId, companyId, role`, unique(userId,companyId), cascade) is the source of truth for "who's in company X" and role in X". `users.companyId`/`role` = home company only. JWT `{id, companyId, role, email}` = ACTIVE company (shape unchanged). Switch via `POST /auth/switch-company` (403 if not a member). `POST /users` links an existing email instead of erroring. Helpers in `lib/memberships.ts`. `company_members` INSERTs need explicit `id` (`gen_random_uuid()`) — table has NO id default.

**Mobile responsive patterns:** `grid ... [&>*]:min-w-0` makes every grid cell flex/grid-safe (prevents iOS date input overflow). `hidden md:table-cell` for responsive table columns (not `table-cell` which is a no-op). `ui/input.tsx` + `ui/textarea.tsx` carry `min-w-0 max-w-full box-border` globally. `index.css` has global CSS `min-width:0; max-width:100%; width:100%; box-sizing:border-box` on `input[type="date/time/datetime-local"]` and `select`. Use `lg:grid-cols-N` (not `sm:`) for stat-card grids inside the app shell (sidebar takes 256px leaving ~512px at md, so sm/md breakpoints fire too early for 3-col layouts).

**Test accounts:** `paul@acme.com` / `password123` (demo, Acme Construction, Free Plan — project-capped). `annabelleparrish@icloud.com` / `password123` (site_worker in "Test SiteSort"). Tip: set `beta_access=true` on demo company to bypass plan cap for testing gated UI.

## Session Log

All prior session detail in CLAUDE_ARCHIVE.md. Recent sessions (newest first):
- **NEXT SESSION TODO (still open):** Confirm a real expiry-reminder email actually sends on prod — *not yet observed*. **This session made the job's gates observable** (see 2026-06-23 session 3 below), so the next step is mechanical: **republish, then read the boot logs ~30s after** for either `Compliance reminders skipped: RESEND_API_KEY is not set` (→ set the env var) or `Compliance reminders run complete { permits:{scanned,noMilestone,notifyOff,deduped,sent}, insurance:{…} }` (sent>0 → real send fired). Fastest proof of a live Resend send without waiting on a real permit: `POST /api/test-email` (auth'd, mounted in routes/index.ts) with `{"template":"permit","to":"dean.parrish@me.com"}` — hits the real Resend client; 200 = key+template OK, 500 = key missing. To exercise the *scheduled* path, add a permit ~7d out with Responsible Person = a reachable inbox (email notifications on). De-dup: each (permit, milestone) sends once — clear its row in `expiry_reminder_logs` to re-test.
- **2026-06-23 (session 3):** Made the daily expiry-reminder job observable — it could no-op at five points with no log output, most critically a bare `return` when `RESEND_API_KEY` was unset. `permit-reminders.ts` now: warns on the missing-key skip; tallies per-item skips into a `ReminderStats` (`scanned/noMilestone/notifyOff/deduped/sent`) returned by both `runPermitReminders`/`runInsuranceReminders` and logged once per run as `Compliance reminders run complete`; emits an info breadcrumb (entity id + milestone + daysLeft) before each send; includes the entity id in the failure `.catch`. Logging only — no change to recipients or de-dup. Traced the full path first (boot `index.ts:31` → `setTimeout 30s`/`setInterval 24h` → `runComplianceReminders` → permit/insurance scans → `email.ts send()` → Resend); confirmed wiring + `expiry_reminder_logs` boot migration all sound, and that the `POST /api/test-email` route is mounted (real Resend client, good for a live-send check). Typecheck passes. ✅ Committed (`9e589b4`) + pushed (`main → 0066285f`, verify-push OK). Not yet republished — see NEXT SESSION TODO.
- **2026-06-23 (session 2):** Feature #59 — expanded expiry email reminders (see feature list above for full detail). Permits + insurance certs now email at 30/21/14/7/1 days (once each) then daily for 7 days once expired; new `expiry_reminder_logs` table + `ensure-schema.ts` boot migration de-dups each milestone. Rewrote `permit-reminders.ts` (`milestoneFor` bucketing, `claimMilestone` onConflictDoNothing, skips `archivedAt`). Verified 24/24 unit cases + DB de-dup + typecheck. ✅ DEPLOYED + live boot verified on www.sitesort.co.uk (`ensureSchema` ran clean, compliance feed renders). Live email send itself not yet observed (needs `RESEND_API_KEY` + an in-window item) — see TODO above.
- **2026-06-23:** Feature #58 dashboard outstanding-invoices widget (`pages/dashboard/index.tsx`) — card between Needs Attention and Active Projects, top-5 unpaid/overdue, Open/Share/Mark Paid pills + move-to-project Dialog + ShareModal. ✅ DEPLOYED + live-verified on www.sitesort.co.uk.
- **2026-06-19 (session 3):** Bare-icon → labeled-pill UI consistency pass on `projects/detail.tsx` — Open/History/Edit/Share/Notes icon buttons converted to labeled rounded-full pills across Documents, Finances & Expiry, Overview daily-notes, Check-ins, and Team cards; containers set `flex-wrap`. Invoice pills were already complete on `invoices/index.tsx` + Finances rows. Verified in real browser; typecheck passes. (Spawned the #58 dashboard-widget TODO, now done + deployed.) ✅ DEPLOYED.
- **2026-06-19 (session 2):** Actual responsiveness fixes applied to source files (previous session had only updated CLAUDE.md without touching code). Changes: `index.css` global box-sizing + date/select CSS constraints; `subcontractors/index.tsx` add+edit grids get `[&>*]:min-w-0`; `projects/detail.tsx` Site Issues stat cards `grid-cols-3`→`grid-cols-1 lg:grid-cols-3`; `landing.tsx` pricing grid single-column at tablet (max-w-[480px] centred), 3-col at lg+; `sidebar-layout.tsx` Site Check-Ins added to nav (page existed but had no link). Verified at 768px: pricing ✅ button ✅ sidebar ✅ stat cards ✅ inputs ✅. Full mobile/tablet audit running. ✅ DEPLOYED.
- **2026-06-19:** Mobile/tablet responsiveness audit — overflow + date-input hardening, `min-w-0` cascade on shared Input/Textarea, admin tables `hidden md:table-cell`. ✅ DEPLOYED.
- **2026-06-19:** Per-company role chips on DM conversations + channel sender chips. ✅ DEPLOYED.
- **2026-06-18 (session 5):** Feature #57 multi-company membership + company switcher. ✅ DEPLOYED.
- **2026-06-18 (session 4):** Messaging 500-fix (`=ANY()`→`inArray`), invoice Open/previews/timestamps/save-to-notes. ✅ DEPLOYED.
- **2026-06-17 and earlier:** See CLAUDE_ARCHIVE.md.
