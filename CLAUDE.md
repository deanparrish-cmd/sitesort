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

## End-of-session notes — 2026-06-17 (mobile/tablet feature-parity audit + fixes, tablet stat density)

### Context
Full audit of every page for desktop features missing or unreachable on tablet/mobile. Ran 4 parallel page-group audits, then **verified each flagged item by hand** (the audits over-flagged: many "bugs" were intended designs — detail tabs *wrap* by design #46, projects "View Site" button is visible ≤lg by design, messages has a back button, admin tables are intentionally all-visible w/ horizontal scroll per 2026-06-15). Drove the real app in headless Chromium across mobile/tablet/desktop to confirm.

### Tasks completed today

1. **Feature-parity fixes** (commit `03870e6`):
   - **Invoices** (`pages/invoices/index.tsx`): added a **Delete** button to the invoice viewer modal (mobile cards open this modal on tap) — Delete was previously desktop-table-only, so invoices couldn't be deleted on mobile/tablet. Gated on `caps.canManageInvoices`; imported `Trash2`.
   - **Project detail** (`pages/projects/detail.tsx`): team member **phone-edit pencil** was `opacity-0 group-hover/phone` → genuinely **unreachable on touch** (no other edit trigger). Changed to `opacity-100 lg:opacity-0 lg:group-hover/phone:opacity-100`. Same touch fix for the avatar **camera overlay** (+ lighter `bg-black/40` so the avatar stays visible).
   - **Settings** (`pages/settings/index.tsx`): avatar camera affordance showed on phones but `sm:opacity-0` hid it on tablets → changed `sm:` to `lg:`.

2. **Tablet stat-strip density** (commit `d0f0f6c`):
   - Dashboard + admin `BigStat` strips used `grid-cols-2 lg:grid-cols-4`, so tablets (768–1023px) showed a sparse 2×2. Shifted to `md:grid-cols-4` (dashboard:428; admin User Metrics / Primary Actions / Revenue strips + the `sm:grid-cols-2 lg:grid-cols-4` feature-usage rows — all via `lg:grid-cols-4`→`md:grid-cols-4`). Verified 4-across at 768/1023px.
   - **Deliberately left** the other audit-flagged cosmetic items: `grid-cols-3` strips are compact stat chips (fine 3-across on tablet); `sm:grid-cols-2 lg:grid-cols-3` grids hold pricing/member cards that need the width; dashboard main 2+1 grid stacks fine on tablet; site-board is phone-first. Changing them = churn risk, no tablet gain.

3. **Dashboard Site Calendar — clickable dates with day detail dialog** (commit `5eef9f4`, `pages/dashboard/index.tsx`):
   - Each calendar day is now a `<button>`; clicking opens a responsive `Dialog` listing **all** events on that day (no longer capped at the 3 visible dots). Each row shows the colored type dot, type label (Project Start/End, Permit/Insurance Expiry, Payment Due, Invoice Due In), the untruncated event text, and a "View →" link to the relevant section via new `EVENT_LINK` map (projects/compliance/invoices).
   - Calendar days with >3 events now show a `+N` hint; empty days show a friendly empty state. `SiteCalendar` return wrapped in a fragment to host the Dialog; new state `selectedDate`.
   - **Only one calendar/dashboard exists** in the repo — the single responsive component covers mobile/tablet/desktop (Dialog already handles narrow viewports). Verified by clicking an event day at 390/820/1280px: dialog opens with full info, zero page errors.

### Browser-test method (reusable)
App runs on **:18299** (serves live source via HMR) but Vite doesn't proxy `/api` locally (404). To drive **authenticated** pages in Playwright: log in via the API on **:8080** for a JWT, inject it with `context.addInitScript(t => localStorage.setItem('sitesort_token', t))`, and `context.route('**/api/**', …)` to re-`fetch`+`fulfill` each call against :8080. Set `viewport` per width (390 / 820 / 1280). Used this all session — all pages 200, zero errors.

### Key files modified
- `artifacts/sitesort/src/pages/invoices/index.tsx` — modal Delete button + `Trash2` import
- `artifacts/sitesort/src/pages/projects/detail.tsx` — phone pencil + avatar camera touch affordances
- `artifacts/sitesort/src/pages/settings/index.tsx` — avatar camera on tablet
- `.../admin/index.tsx` — stat strips `md:grid-cols-4`
- `artifacts/sitesort/src/pages/dashboard/index.tsx` — stat strip `md:grid-cols-4` **+** clickable calendar dates with day detail Dialog (`EVENT_LINK` map, `selectedDate` state)
- `.claude/skills/browser-check/{package.json,package-lock.json}` — committed `playwright-core` dep (commit `a837e6b`)

### Notes for next session
- **`pnpm run typecheck` is green (exit 0)** — kept green this session; working tree clean, all work pushed to `main`.
- **GitHub push is automatic** via PostToolUse hook; **API server rebuild**: `pnpm --filter @workspace/api-server run build` after backend changes.
- Local browser testing of authenticated pages needs the `/api`→:8080 reroute trick (see Browser-test method above) — Vite doesn't proxy `/api` locally.

---

## End-of-session notes — 2026-06-17 session 2 (site calendar dot indicator, plan limit upgrade dialog)

### Tasks completed today

1. **Site Calendar red-dot event indicator** (commit `ffe5026`, `pages/dashboard/index.tsx`):
   - Small red badge now overlays the day number for any day that has events, giving at-a-glance signal before reading the coloured dots inside the cell.
   - Also committed `tmux` to nix packages (`.replit`) and tracked `cal-dot-check.mjs` Playwright test script.

2. **Plan limit upgrade dialog — proactive check + improved UI** (commit `a9e8db8`):
   - **Previously**: dialog only fired after an API `403 plan_limit` response (user had to fill the form first).
   - **Now**: check is proactive — uses client-side project count + plan tier from `useSubscription()`. Button click or `?new=1` auto-open shows the dialog immediately if the user is at their limit.
   - **Dialog improved**: shows current plan badge + usage count ("3 of 1 project used"), next-tier callout with project count and price ("Team plan — 5 projects · £79/mo"), "Maybe later" / "Upgrade plan →" buttons.
   - Applied to both `/projects` page and `/dashboard` "New Project" button.
   - Plan limits (matching server): `free`/`solo` = 1, `team` = 5, `pro` = Infinity. Beta-access companies bypass the check.
   - **Browser-tested**: Playwright confirmed dialog fires immediately on both pages, all elements present, "Upgrade plan" routes to `/settings?tab=billing`. Zero console errors.

### Key files modified
- `artifacts/sitesort/src/pages/projects/index.tsx` — `PLAN_LIMITS`/`NEXT_PLAN` constants, `atLimit` computed value, proactive button + auto-open check, improved Dialog JSX
- `artifacts/sitesort/src/pages/dashboard/index.tsx` — `useSubscription` import, `atLimit` check on "New Project" button, upgrade Dialog

### Notes for next session
- **`pnpm run typecheck` is green** — kept clean this session.
- **GitHub push is automatic** via PostToolUse hook; **API server rebuild**: `pnpm --filter @workspace/api-server run build` after backend changes.
