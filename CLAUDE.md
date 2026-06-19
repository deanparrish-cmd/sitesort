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

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-06-19 (mobile/tablet responsiveness audit pass — overflow + date-input hardening)

Systematic audit (4 parallel agents over all 22 pages) + fixes. Feature parity was already solid (tables all have mobile card counterparts; messages master-detail; grids mostly collapse). Real issues were overflow/sizing, mostly **date/select inputs in grid cells**.
- **Shared components (cascade fix):** `ui/input.tsx` + `ui/textarea.tsx` now carry `min-w-0 max-w-full box-border` — the guard that stops `type="date"` inputs blowing out of flex/grid (iOS Safari intrinsic-width issue). This covers every Input app-wide.
- **Date/time/select-in-grid:** added `[&>*]:min-w-0` to grid containers (+ `min-w-0 max-w-full` on native `<select>`s) in projects/index (create-project + permit dates), projects/detail (permit dates, schedule times, milestone title), invoices (currency select + due-date), subcontractors (reliability select), checkins (project filter). Pattern to reuse: `grid ... [&>*]:min-w-0` makes every cell flex/grid-safe.
- **Stat grids collapsing:** `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` on subcontractors/issues/checkins summary cards.
- **Text overflow:** messages channel header got `min-w-0 flex-1` + `truncate`.
- **Admin tables:** 24 dead `table-cell` no-op classes (intended responsive hiding that did nothing) → `hidden md:table-cell`; verified consistent across header/skeleton/body so columns stay aligned.
- **Verified in-browser at 375/768/1280** against the rebuilt bundle on `:8080` (full app + API): 10 pages × 3 breakpoints = zero horizontal page overflow, zero console errors; New Invoice dialog (date + currency select in grid) and Add Permit dialog (Start/Expiry date range) both fit cleanly at 375px (screenshots). Root typecheck + build green. Note: `paul@acme.com` demo is Free-Plan project-limited, so "New Project" opens the upgrade dialog — test the create-project date grid via a non-limited account.
- **✅ DEPLOYED LIVE + verified 2026-06-19.** Pushed to GitHub mirror (`main → ae38da0a`, signatures verified). Published; live bundle `index-DmGZWGzO.js` (matches the locally-built+verified bundle). Re-ran the live check on `www.sitesort.co.uk` at 375/768/1280: 10 pages × 3 breakpoints = **zero horizontal overflow, zero console errors**; New Invoice dialog @375px `scroll=343 client=343` no overflowing fields (date input + currency select fit). All four task categories confirmed in production.
- **Auth + landing final pass 2026-06-19 — confirmed clean, NO changes needed.** Audited all 6 (landing `/`, login, register, forgot-password, reset-password, verify-email) + browser-verified at 320/375/768/1280: zero horizontal overflow (incl. 320px low end), zero layout console errors. Landing grids all collapse (`md:grid-cols-3`, `sm:grid-cols-2 lg:grid-cols-3`, trust stats `grid-cols-2 md:grid-cols-4`), hero CTAs stack (`flex-col sm:flex-row w-full sm:w-auto`), navbar (logo + Sign in + Get Started) fits at 320px, footer nav `flex-wrap`, decorative blur blobs sit inside `overflow-hidden`. Auth pages all use the same safe `w-full max-w-md p-8` centered card with shared Input/Button; register's company-size `<select>` is full-width in a block (not a flex/grid cell). Nothing built/pushed (no diff).
- **Create-project date dialog verified 2026-06-19** (the one the Free-Plan demo couldn't reach): temporarily set Acme `beta_access=true` (workspace DB) so `paul@acme.com` bypassed the project cap → "Create New Project" dialog opened at 375px with **2 date inputs (Start/Target End) both fitting** (`bad:[]`, dialog `scroll=343 client=343`, no console errors); screenshot clean. **Restored Acme `beta_access=false`** afterward (no lasting DB change). Reusable trick: the create gate is `atLimit = !betaAccess && planLimit!==Infinity && projects.length>=planLimit`, so toggling `beta_access` is the cleanest reversible way to reach plan-gated UI on a limited demo account.

### 2026-05-22 through 2026-06-10 (all sessions up to and including site issues log) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-11 & 2026-06-12 (tablet fixes, eye icon, check-ins page, notes fixes, team enhancements) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-12 (team enhancements, site issues refactor, share fix)

See CLAUDE_ARCHIVE.md for full detail.

---

## End-of-session notes — 2026-06-12 (overview note open/share, tab reorder, auto-push hook) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-12 (mobile/tablet responsive audit) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-15 (photo backfill, mobile feature parity) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-16 (full monorepo typecheck repair) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-17 (mobile/tablet feature-parity audit + fixes, tablet stat density, clickable calendar dates) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-17 session 2 (site calendar dot indicator, plan limit upgrade dialog) — see CLAUDE_ARCHIVE.md for full detail

---

## End-of-session notes — 2026-06-18 (Site Calendar event deep-links to the actionable item) — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 session 5 (Feature #57: multi-company membership + company switcher) — see CLAUDE_ARCHIVE.md for full detail

**Key facts to carry forward** (full write-up + Dean verification in CLAUDE_ARCHIVE.md):
- **Model:** `company_members` table (`id, userId, companyId, role`, unique(userId,companyId), cascade) is the source of truth for "who's in company X" and "role in X". `users.companyId`/`role` = the user's **home** company. **JWT shape unchanged** (`{id, companyId, role, email}` = ACTIVE company). Helpers in `lib/memberships.ts`; switch via **`POST /auth/switch-company`** (403 if not a member). `POST /users` **links** an existing email instead of erroring.
- **Per-company role chips:** `messages.ts` conversations `userMap` + `channels.ts` sender `userMap` `leftJoin company_members` on the active `companyId` so chips show the person's role *in the active company*, not their home role. **✅ DEPLOYED LIVE 2026-06-19.**
- **⚠️ DEPLOY SAFETY (prod DB is SEPARATE):** `drizzle push` is NOT part of the deploy. New tables/columns MUST be added to **`lib/ensure-schema.ts`** (idempotent boot migration run from `index.ts` before `app.listen`) or prod will query a non-existent table and break login. `getMemberships` also falls back to the home company if the table query throws. **Pattern for ALL future schema changes: add them to `ensureSchema` — pushing to the workspace DB does NOT migrate prod.**
- **Dean role-per-company verified 2026-06-19:** `dean.parrish@me.com` shows `project_manager` in "Test SiteSort" but `admin` in his home "Test SiteSort 2" — both sides proven via the real API path (workspace DB); live confirmed at deploy level (membership-join endpoints return 200/200/403). DB note: `company_members` INSERTs need an explicit `id` (`gen_random_uuid()`) — the table has NO id default.
- **Test data:** Test SiteSort members = Amy (admin), Dean (PM), Tom + Annabelle (site_worker). Annabelle (`annabelleparrish@icloud.com` / `password123`) is a usable workspace login.

---

## End-of-session notes — 2026-06-18 session 4 (messaging `=ANY()`→`inArray` 500-fix + invoice Open/list previews/timestamps/save-to-notes; DEPLOYED LIVE) — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 (custom user-created calendar events, Feature #56) — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 (custom events → QR site board) — extends Feature #56 — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 (BUGFIX: site check-in rejected in-house team members) — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 (check-in photo cropped faces — `object-cover` → `object-contain`) — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 session 3 (signup card-upfront: fail-CLOSED + abandonment gate) — see CLAUDE_ARCHIVE.md

---

## End-of-session notes — 2026-06-18 session 2 (browser-verified Upcoming Events card post-check-in, pushed) — see CLAUDE_ARCHIVE.md
