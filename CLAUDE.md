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
29. Invoice document viewer — full-screen inline viewer panel; PDF via `<object>` embed (fallback "Open PDF" button when inline blocked), image via `<img>`; sidebar with invoice details; header actions: `window.open()` open, share, mark paid
30. Project detail report / PDF export — "Export Report" button generates a print-ready HTML report (team, permits, documents, finances, photos) and auto-triggers browser Save-as-PDF
31. Subcontractor "Add to Project" — FolderPlus button on each sub card opens a dialog listing active projects; one-click add with inline per-project feedback (added/already linked/error)
32. Enforced subcontractor directory-first workflow — removed "Add Person" form and dialog from the project Team tab; contacts must be added to the subcontractor directory first, then linked into a project via "Add from Subcontractor Directory"
33. Broadcast messaging — "New" button in Messages opens a three-mode picker: Individual (1-to-1), By Role (filter project members by Admin/PM/Site Worker/Subcontractor), All in Project; backend `POST /api/messages/broadcast` sends message + notification per recipient
34. Landing page pricing section — "Start Free Trial" smooth-scrolls to Solo £29/Team £79/Pro £149 plan cards; Book Demo button removed
35. Invoice sharing in messages — Receipt button in compose bar opens an invoice picker; selected invoice renders as a card in the thread (counterparty, amount, status badge, due date, PDF link); `invoiceId` nullable column on messages table; `content` defaults to `""` to allow invoice-only messages
36. Document, photo, and permit sharing in messages — Paperclip button in compose bar opens a tabbed picker (Document / Photo / Permit) with a project selector; selected item shown as a violet chip; thread renders typed cards: document (name, type, version, view link), photo (thumbnail, category, reference), permit (type, description, expiry status badge); `attachmentType` + `attachmentId` columns on messages table; API thread endpoint batch-fetches attachment data
37. Project channel group messaging — each active project gets a shared `#channel` thread visible to all project members; appears above DMs in sidebar with blue `#` icon and unread badge; full attachment support (doc/photo/permit cards); sender name + role chip on every message; edit/delete own messages; 5s polling; notifications to all project members on send; `channel_messages` + `channel_reads` tables; `GET/POST /api/channels/:projectId/messages`, `PATCH/DELETE /api/channel-messages/:id`
38. Message enhancements — emoji reactions (👍 ✅ 👀 ❤️ 😂) on DMs and channels (hover picker, pill badges, toggle); reply-to-message WhatsApp-style quote bubbles; debounced sidebar message search across DMs and channels with yellow-highlighted snippets; 18 quick reply templates in 4 site-specific categories via ⚡ Zap button
39. Subcontractor invite links — UserPlus button on each sub card generates a unique invite link; share modal with copy, WhatsApp/Email/SMS options; register page detects `?invite=<token>` and shows tailored join form (email locked, name pre-filled, password only); backend creates user with `subcontractor` role and marks invite as used
40. Beta access flag — `betaAccess` boolean on `companies` table; companies with `beta_access=true` bypass all Stripe subscription checks (`isCancelled` always false, effective status always "active"); set via `UPDATE companies SET beta_access=true WHERE name='...'`
41. Project progress tracking — `milestones` table (title, dueDate, completedAt, order; cascade-delete with project); 4 CRUD endpoints; `progressPercent` on list and detail now computed from completed/total milestones; "Progress" tab in project detail with progress bar, milestone checklist (add/tick/delete), and Gantt timeline (diamond markers, Today line); mini progress bar column added to project list table
42. Onboarding checklist — dismissible card at top of dashboard showing 5 steps (create project, invite team member, upload document, add subcontractor, set milestones); completion derived from real DB data via `GET /api/onboarding/status`; progress bar; each incomplete step shows description + CTA link; X dismisses to localStorage; auto-hides when all done
43. DM read receipts — single grey ✓ (sent) / double blue ✓✓ (seen) on outgoing DMs; `?after=` poll response includes `readUpdates [{id, readAt}]` so the sender's tick flips live within 5s without re-fetching the thread
44. Admin beta access UI — "Companies & Beta Access" section on admin dashboard; table lists all companies with plan/status/user count and an orange toggle switch per row; `GET /api/admin/companies` + `PATCH /api/admin/companies/:id/beta-access`, both behind `requireAdmin` email guard; replaces raw SQL workflow
45. Email notifications — `emailNotifications` boolean on users table (default true); Settings > Notifications tab has email toggle backed by `PATCH /api/auth/me`; emails sent via Resend for: new DMs, new channel messages (per-member opt-in), permit expiry at ~7 days and ~1 day (daily server-side interval in `permit-reminders.ts`)
46. QR site board check-in with date-stamped photo — anonymous workers scan QR code, enter name, take photo via device camera; Canvas API stamps name + date/time + project name onto image before upload; GPS captured optionally; `site_checkins` table stores record; Check-ins tab on project detail shows photo grid with worker name and timestamp; `POST /api/site/:token/checkin` (public multipart) + `GET /api/projects/:id/checkins` (auth)

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22, 2026-05-25 & 2026-05-26 — see CLAUDE_ARCHIVE.md for full detail

## End-of-session notes — 2026-06-08

### Tasks completed today

1. **Mobile subcontractor card layout fix** — phone number was overlapping action icons in the single horizontal flex row:
   - Restructured each card into two sections: top (avatar + stacked text info with no competing elements) and a mobile-only bottom bar (`flex sm:hidden`) with insurance badge on the left and all action icons (call/SMS/WhatsApp/email + folder/invite/edit) on the right
   - Desktop single-row layout unchanged (`hidden sm:flex`)

2. **Additional mobile layout fixes** (found via audit of all pages):
   - `projects/index.tsx`: project name div missing `min-w-0 flex-1 truncate` — long names pushed status badge off-screen on mobile
   - `messages/index.tsx`: thread header name container missing `min-w-0 flex-1` — long contact name could collide with Manager View badge
   - `compliance/index.tsx`: insurance rows changed from always-horizontal to `flex-col sm:flex-row` with `flex-wrap` on the right side (date + badge + 4 action links were overflowing on mobile)

3. **Invoice attachment viewer fix** — `<object data="...pdf">` was rendering blank on mobile and in sandboxed iframe environments; Chrome's fallback content inside `<object>` is never shown:
   - Replaced with a reliable file card UI: PDF icon + "Open PDF" button (`window.open()`) + "Download" anchor (`<a href download>`)
   - Same card pattern for non-image/non-PDF file types; image viewer unchanged

4. **Systematic file-open link audit** — found 9 remaining `<a target="_blank">` file links that could be suppressed in sandboxed environments:
   - `compliance/index.tsx`: insurance certificate open icon
   - `insurance-cert-zone.tsx`: PLI cert open icon (collapsed + expanded states)
   - `messages/index.tsx`: invoice attachment, DM doc/permit "View" links, channel doc/permit "View" links (5 links)
   - `projects/detail.tsx`: documents tab "Open", distribution table "Open", sharing dialog "Open document"
   - All converted to `window.open()` via `onClick` — consistent with codebase standard

5. **Share (Email + WhatsApp) added to photos, permits, and check-ins** in project detail:
   - **Photos tab**: Share dropdown (DropdownMenu) in card footer; email includes ref number, category, description, zone, date, and URL; thumbnail click now opens full-size via `window.open()`
   - **Permits section**: Share dropdown on each permit row (right side); email/WhatsApp includes type, description, expiry, status label, responsible person, project name
   - **Check-ins tab**: Share dropdown in card footer alongside date/time; email/WhatsApp includes worker name, date, time, project, and stamped photo URL; photo thumbnail click opens full-size
   - URL normalisation consistent throughout: `.replace(/^\/uploads\//, "/api/uploads/")` then absolute URL via `window.location.origin`

### Key files modified
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — two-section mobile card layout
- `artifacts/sitesort/src/pages/projects/index.tsx` — min-w-0/truncate on mobile project name
- `artifacts/sitesort/src/pages/messages/index.tsx` — thread header min-w-0; file-open links → window.open()
- `artifacts/sitesort/src/pages/compliance/index.tsx` — responsive insurance rows; cert link → window.open()
- `artifacts/sitesort/src/pages/invoices/index.tsx` — replaced `<object>` PDF embed with file card UI
- `artifacts/sitesort/src/pages/projects/detail.tsx` — doc open links → window.open(); share dropdowns on photos, permits, check-ins
- `artifacts/sitesort/src/components/ui/insurance-cert-zone.tsx` — cert view links → window.open()

### Notes for next session
- **Good next features**: demo data seeder, per-project dashboard mini-view
- **All file-open links now use `window.open()`** — do NOT use `<a target="_blank">` for file links; it's blocked in Replit's sandboxed webview
- **No `<object>` or `<iframe>` PDF embeds** — these fail silently on mobile and in sandboxed environments; use the file card pattern (icon + Open button + Download link) instead
- **Share pattern**: use `DropdownMenu` with Email (`window.open("mailto:?subject=...&body=...")`) and WhatsApp (`window.open("https://wa.me/?text=...")`) items; always normalise file URLs before including them
- **API server does NOT hot-reload** — after editing any backend file: `pnpm --filter @workspace/api-server run build` then restart node process
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
- All commits are on `main`

## End-of-session notes — 2026-06-06 (session 2)

### Tasks completed today

1. **Mobile header logo size** — increased from `h-8` to inline `style={{ height: '72px' }}` on the `md:hidden` mobile header in `sidebar-layout.tsx`; used inline style rather than Tailwind class to guarantee the size isn't affected by CSS purging.

2. **QR site board check-in with date-stamped photo**:
   - New `site_checkins` table: `id`, `projectId` (FK cascade), `workerName`, `photoUrl`, `checkedInAt`, `lat`, `lng`
   - `POST /api/site/:token/checkin` — public, no auth, multipart; resolves project from QR token, uploads stamped photo to GCS, creates check-in record
   - `GET /api/projects/:id/checkins` — authenticated; returns all check-ins newest-first
   - Site board page: "Site Check-In" card with name input, camera trigger (`capture="environment"`), Canvas stamp (name · date · time bar + project name), optional GPS, retake option, success screen
   - Project detail: new "Check-ins" tab with live count badge; photo grid showing stamped image, worker name, date and time

### Key files modified
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — mobile logo height inline style
- `lib/db/src/schema/site_checkins.ts` — new table
- `lib/db/src/schema/index.ts` — exports site_checkins
- `artifacts/api-server/src/routes/qr.ts` — check-in POST + GET endpoints; multer handler for unauthenticated photo upload
- `artifacts/sitesort/src/pages/site-board.tsx` — `stampPhoto()` canvas helper + `CheckInCard` component
- `artifacts/sitesort/src/pages/projects/detail.tsx` — `checkins` state, fetch, Check-ins tab

### Notes for next session
- **Good next features**: demo data seeder, per-project dashboard mini-view
- **API server does NOT hot-reload** — `dev` command is `build && start` with no watch mode; after editing any backend file, run `pnpm --filter @workspace/api-server run build` then restart the node process (`kill <pid>` + `PORT=8080 node --enable-source-maps ./dist/index.mjs &`)
- **`lib/db/dist/` is gitignored** — do NOT include it in `git add`; it gets pushed to GitHub via the Replit push script automatically
- **Stripe still needs manual setup**: activate Customer Portal in Stripe Dashboard; register all 5 webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`)
- **When adding new DB schema files**: always run `npx tsc -p tsconfig.json` inside `lib/db/` after editing `src/schema/index.ts` to regenerate `dist/` before typechecking api-server
- **GitHub push command**: `cd /home/runner/workspace && /home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts` (do NOT use `npx tsx` — fails with "not found")
- **No `git pull` at session start**: no GitHub remote in git — pushes use Replit Connectors SDK. Use `git status` + `git log` only.
- All commits are on `main`

## End-of-session notes — 2026-06-06 (session 1)

### Tasks completed today

1. **DM read receipts** — WhatsApp-style double-tick indicator on sent DMs:
   - API: `?after=` poll response now includes `readUpdates: [{ id, readAt }]`; piggybacks on existing 5s poll
   - `POST /messages` 201 response includes `readAt: null` so indicator renders immediately on send
   - Frontend: `Circle` replaced with `Check` (grey) / `CheckCheck` (blue) from Lucide; poll merges updates into thread state

2. **Admin beta access UI** — toggle beta access per company without raw SQL:
   - `GET /api/admin/companies` + `PATCH /api/admin/companies/:id/beta-access`, both behind `requireAdmin`
   - New "Companies & Beta Access" section on admin dashboard with orange CSS toggle per row

3. **Email notifications** — full opt-in email system via Resend:
   - `emailNotifications` boolean column on users table (default `true`); pushed to DB
   - `GET/PATCH /api/auth/me` now exposes `emailNotifications`
   - `email.ts`: `sendNewMessageEmail` (DM + channel variants) and `sendPermitExpiryEmail` templates
   - `messages.ts`: emails recipient on new DM if opted in
   - `channels.ts`: batch-fetches member email prefs, emails each opted-in member on channel post
   - `permit-reminders.ts`: new file; `schedulePermitReminders()` runs 30s after startup then every 24h; emails responsible users for permits expiring in ~7 days and ~1 day; silently skips if `RESEND_API_KEY` unset
   - Settings > Notifications: new "Email notifications" toggle card, backed by `PATCH /api/auth/me`

### Key files modified
- `lib/db/src/schema/users.ts` — `emailNotifications` boolean column
- `artifacts/api-server/src/lib/email.ts` — `sendNewMessageEmail`, `sendPermitExpiryEmail`
- `artifacts/api-server/src/lib/permit-reminders.ts` — new; daily permit expiry check
- `artifacts/api-server/src/index.ts` — calls `schedulePermitReminders()` on startup
- `artifacts/api-server/src/routes/auth.ts` — `emailNotifications` in GET/PATCH /auth/me
- `artifacts/api-server/src/routes/messages.ts` — DM email trigger
- `artifacts/api-server/src/routes/channels.ts` — channel message email trigger
- `artifacts/sitesort/src/pages/settings/index.tsx` — email toggle in Notifications tab

## End-of-session notes — 2026-06-05

### Tasks completed today

1. **Message pagination** — cursor-based pagination for both DM threads and project channel threads:
   - API: `GET /api/messages/thread/:userId` and `GET /api/channels/:projectId/messages` now accept `?before=<id>` (load older page) and `?after=<id>` (poll for new messages)
   - Default (no params): returns last 50 messages + `hasMore` flag; response format changed from array to `{ messages, hasMore }`
   - `before`: fetches 50 messages before the cursor, oldest-first, with `hasMore` for further pages
   - `after`: fetches all messages since cursor (capped at 100) — typically 0 on a quiet 5s poll
   - Mark-as-read: initial load marks entire conversation; polls mark only new messages; load-older skips marking
   - Frontend: initial load sets `dmHasMore`/`channelHasMore`; polls use `?after=<lastId>` and append-only (preserves loaded-older messages); "Load older messages" button at top of both thread panels
   - Scroll position preserved on load-older via `scrollHeight` anchor + `useLayoutEffect` restoration; `skipScrollRef` suppresses auto-scroll-to-bottom during prepend

2. **Invoice document viewer fix** — replaced broken `<iframe>` PDF embed with `<object>`:
   - Root cause: `<iframe>` renders blank/silently in Replit's sandboxed webview; `<a target="_blank">` new-tab navigation suppressed by popup blockers in the same environment
   - PDF viewer changed from `<iframe src={url}>` to `<object data={url} type="application/pdf">` with a visible fallback ("PDF preview not available — Open PDF" button) when inline rendering fails
   - All "Open" / "Open in new tab" buttons changed from `<a target="_blank">` to `window.open(url, '_blank', 'noopener,noreferrer')` via `onClick` — fires correctly in popup-blocked environments
   - Table row "Open" link also converted to `<button onClick>` with `stopPropagation()` + `window.open()`
   - Verified: GCS is correctly serving the file (HTTP 200, `Content-Type: application/pdf`, 548 KB in test)

### Key files modified
- `artifacts/api-server/src/routes/messages.ts` — `lt`, `gt` imports; paginated thread endpoint; `{ messages, hasMore }` response
- `artifacts/api-server/src/routes/channels.ts` — same pagination for channel messages
- `artifacts/sitesort/src/pages/messages/index.tsx` — `useLayoutEffect` import; pagination state/refs; updated fetch/poll callbacks; `loadOlderDm`/`loadOlderChannel`; "Load older" buttons; scroll anchor restoration
- `artifacts/sitesort/src/pages/invoices/index.tsx` — `<object>` PDF embed; `window.open()` for all Open buttons; fallback UI inside `<object>`

## End-of-session notes — 2026-05-27

### Tasks completed today

1. **Beta access flag** — `betaAccess` boolean column on `companies` table (default `false`); companies with `beta_access=true` bypass all Stripe subscription checks; `SubscriptionContext` treats them as fully active regardless of Stripe status; `GET/PATCH /api/companies/mine` now returns `betaAccess`

2. **Project progress tracking** — milestones-driven progress with Gantt timeline:
   - New `milestones` table: `id`, `projectId`, `title`, `dueDate`, `completedAt` (nullable), `order`, cascade-delete on project removal
   - 4 API endpoints: `GET/POST /api/projects/:id/milestones`, `PATCH/DELETE /api/projects/:id/milestones/:milestoneId`
   - `progressPercent` in both `GET /projects` and `GET /projects/:projectId` now computed from completed/total milestones (was hardcoded from status)
   - New "Progress" tab in project detail: large progress bar + %, milestone checklist (add/tick/delete with due dates), CSS Gantt timeline (diamond markers positioned at due dates, orange Today line, legend)
   - Project list table: new "Progress" column with mini progress bar + %

3. **Onboarding checklist** — dismissible card at top of dashboard:
   - 5 steps: create project, invite team member, upload document, add subcontractor, set milestones
   - All completion states derived from real DB data — no new table; single `GET /api/onboarding/status` call
   - Progress bar (X/5); incomplete steps show description + CTA link; completed steps show green tick + strikethrough
   - X button dismisses permanently (`sitesort_onboarding_dismissed` in localStorage); auto-hides when all done

### Key files added/modified
- `lib/db/src/schema/milestones.ts` — new table
- `lib/db/src/schema/index.ts` — exports milestones table
- `artifacts/api-server/src/routes/projects.ts` — `milestonesTable` import; `computeProgress()` helper; 4 milestone endpoints; real progress in list + detail
- `artifacts/api-server/src/routes/onboarding.ts` — new file; `GET /api/onboarding/status`
- `artifacts/api-server/src/routes/index.ts` — registers onboarding router
- `artifacts/sitesort/src/pages/projects/detail.tsx` — Progress tab with checklist + Gantt
- `artifacts/sitesort/src/pages/projects/index.tsx` — Progress column header + mini progress bar
- `artifacts/sitesort/src/pages/dashboard/index.tsx` — onboarding checklist card; `OnboardingStatus` type; fetch + dismiss state
- `lib/db/src/schema/companies.ts` — `betaAccess` boolean column
- `artifacts/api-server/src/routes/auth.ts` — `betaAccess` in `GET/PATCH /api/companies/mine`
- `artifacts/sitesort/src/contexts/subscription.tsx` — reads `betaAccess`; overrides `isCancelled` and `effectiveStatus`

### Notes for next session
- **Good next features**: message pagination (currently loads entire thread), read receipts per-message in DMs, admin UI to toggle beta access without raw SQL, demo data seeder
- **Stripe still needs manual setup**: activate Customer Portal in Stripe Dashboard; register all 5 webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`)
- **When adding new DB schema files**: always run `npx tsc -p tsconfig.json` inside `lib/db/` after editing `src/schema/index.ts` to regenerate `dist/` before typechecking api-server
- **Beta access SQL**: `UPDATE companies SET beta_access = true WHERE name = 'Company Name';`
- All commits are on `main`; push via `cd /home/runner/workspace && /home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`

## End-of-session notes — 2026-05-26 — see CLAUDE_ARCHIVE.md for full detail
