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
45. Subcontractor notes/reminders log — StickyNote button on each sub card opens a "Notes & Reminders" dialog; append-only, timestamped history per subcontractor (date/time + author name); add form gated on `canManageSubcontractors`; Ctrl/Cmd+Enter submits; newest note shown first; `subcontractor_notes` table (id, subcontractorId FK, authorId FK, body, createdAt); `GET/POST /api/subcontractors/:id/notes` (tenant-scoped, IDOR-safe)
46. Invoice project organisation — invoices linked to a project after marking as paid (popup picker); can be unlinked back to the main list; project detail shows its invoices with viewer and share actions; paid invoices can be reversed to pending; project nav tabs wrap to new lines on mobile instead of scrolling

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22, 2026-05-25 & 2026-05-26 — see CLAUDE_ARCHIVE.md for full detail

## End-of-session notes — 2026-06-09 (CLAUDE.md housekeeping)

### Changes made (Replit Agent work since last Claude Code session)

- **Voice features removed** — voice search inputs, the global voice command mic button, voice dictation component, and all `?new=1`/`?recall=1`/`?photo=1`/`?dictate=1` URL-driven openers stripped from every page; `sidebar-layout.tsx` and `voice-dictation.tsx` deleted; references removed from items 13, 15, 25, 26, 27 in old features list. Features list renumbered (47 → 46 items).
- **Subcontractor notes/reminders log** added as feature #45 — `subcontractor_notes` table; `GET/POST /api/subcontractors/:id/notes`; StickyNote dialog on each sub card.
- **Invoice project organisation** added as feature #46 — link invoices to a project after marking paid; unlink back to main list; reverse paid→pending; project detail invoice view; mobile nav tab wrapping.
- **AGENTS.md** created — handover doc for shell-based AI agents (Codex, Claude Code) working in the Replit environment.

### Notes for next session
- **Voice is gone** — do not re-add any voice/speech/Web Speech API features; user deliberately removed them
- **Features now numbered 1–46** (3 voice items removed, 2 new items added at end)

## End-of-session notes — 2026-06-10

### Tasks completed today

1. **QR board pin management (feature #47)** — completed the half-built feature end-to-end:
   - **DB**: `qr_board_pins` table (`id`, `projectId` FK cascade, `itemType`, `itemId`, `pinnedAt`; unique constraint on `projectId+itemType+itemId`); pushed via `drizzle-kit push`
   - **API — management endpoints**: `GET /api/projects/:id/qr-pins`, `POST /api/projects/:id/qr-pins`, `DELETE /api/projects/:id/qr-pins` (body: `{itemType, itemId}`); all authenticated; `onConflictDoNothing` on insert
   - **API — public site board**: `GET /api/site/:token` now batch-fetches pinned docs/photos/permits and returns `pinnedItems` array with full data (document `fileUrl`, photo `photoUrl` + `referenceNumber`, permit computed `status`); URL normalisation via `normaliseUrl()` helper
   - **Frontend — QR tab**: "Board Contents" panel below the QR code; three sections (Documents, Photos, Permits) each with a thumbtack `<Pin>` toggle button (filled orange = pinned); state loaded at component mount alongside other project data; `isPinned()` / `togglePin()` helpers
   - **Frontend — site board public page**: new "Pinned to this Board" card with document rows (View button → `window.open()`), 2-column photo thumbnail grid, permit rows with colour-coded status badge (Active/Expiring Soon/Expired)

### Key files modified
- `lib/db/src/schema/qr_board_pins.ts` — new table
- `lib/db/src/schema/index.ts` — exports `qrBoardPinsTable`
- `artifacts/api-server/src/routes/qr.ts` — 3 pin endpoints + `pinnedItems` in public site board response
- `artifacts/sitesort/src/pages/projects/detail.tsx` — `Pin` icon import; `qrPins` state; `isPinned`/`togglePin`; Board Contents panel in QR tab; pin fetch added to main `useEffect`
- `artifacts/sitesort/src/pages/site-board.tsx` — `Pin` icon import; `pinnedItems` destructured; "Pinned to this Board" section

### Notes for next session
- **Pin toggle UX**: `<Pin fill="currentColor">` when pinned, `fill="none"` when not; button has `text-primary bg-primary/10` when active
- **`qrBoardPinsTable`** uses `onConflictDoNothing` on insert — safe to call POST twice without error
- **Public site board items**: only pinned items the manager explicitly chose are shown in `pinnedItems`; general permits/docs sections remain unchanged
- **API server does NOT hot-reload** — after editing any backend file: `pnpm --filter @workspace/api-server run build` then restart node process
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
- All commits are on `main`

## End-of-session notes — 2026-06-09

### Tasks completed today

1. **CLAUDE.md maintenance** — trimmed file from 30k+ chars to 24k by moving 2026-06-05 and 2026-05-27 session logs to CLAUDE_ARCHIVE.md

2. **Share button on documents mobile card** — the documents tab in project detail has two layouts (mobile card `block lg:hidden` + desktop table `hidden lg:block`); Share dropdown (Email / WhatsApp / Share with project team) existed only in the desktop table; added matching Share dropdown to the mobile card action row

3. **Share added across compliance page** — all three compliance sections now have share on mobile:
   - **Expiring Insurance** — already had share ✓
   - **Expiring Permits** — added Email + WhatsApp share (permit type, project, expiry); layout made responsive (`flex-col sm:flex-row` like insurance rows)
   - **Pending Sign-offs** — added Open button + Email/WhatsApp share with document link; layout made responsive; API extended to return `fileUrl` on `pendingAcknowledgments`

4. **Share on invoice mobile card** — desktop table had Share dropdown; mobile card had only a "File" open button; added Email/WhatsApp Share dropdown to mobile card with `e.stopPropagation()` to prevent opening the viewer

5. **Share on team member cards** — both the `/team` page and the project detail Team tab; Share2 icon added to card top-right corner; Email + WhatsApp with name, role, trades, email, phone

6. **Share on subcontractor cards** — Email/WhatsApp Share dropdown added to both the desktop action icon bar and the mobile bottom action bar; content includes company name, contact name, email, phone, trades

7. **Per-project Compliance tab** — the "Permits" tab in project detail was listed but had no content; built it out as a full per-project Compliance tab:
   - Updated `PERMIT_TYPES` list across project detail and projects index to include: `"CSCS Check"`, `"IPAF Certificate"`, `"Hot Works"`, `"Working at Heights"`, `"Scaffolding Inspection"`, `"Confined Space Entry"`, `"Excavation"`, `"Electrical Isolation"`, `"Demolition"`, `"Asbestos"`, `"Method Statement"`, `"Other"`
   - Tab label changed from "Permits" to "Compliance" (tab value stays `"permits"` to avoid breaking URL routing)
   - Permits grouped by status: Expired (red), Expiring Soon (amber), Active (green)
   - Each permit row: type badge, description, responsible person, start/expiry dates, status badge, Share dropdown (Email/WhatsApp), Delete button
   - "Add Permit" Dialog: type selector from PERMIT_TYPES, description, responsible person (team selector), start/expiry dates
   - `submitNewPermit()` POSTs to `/api/projects/:id/permits`; `deletePermit(id)` DELETEs `/api/permits/:id`
   - Team Insurance section below permits shows each member with their PLI cert status
   - `DELETE /permits/:permitId` endpoint added to `permits.ts` — verifies permit belongs to user's company before deleting

### Key files modified
- `artifacts/sitesort/src/pages/projects/detail.tsx` — Share in mobile doc card; Share on project Team tab member cards; full Compliance tab; Add Permit dialog; `deletePermit()` + `submitNewPermit()`; `PERMIT_TYPES` constant
- `artifacts/sitesort/src/pages/projects/index.tsx` — updated `PERMIT_TYPES` list; default reset `"Hot Works"`
- `artifacts/sitesort/src/pages/compliance/index.tsx` — Share on permits + sign-offs; responsive layouts
- `artifacts/sitesort/src/pages/invoices/index.tsx` — Share on mobile invoice card
- `artifacts/sitesort/src/pages/team/index.tsx` — Share on team member cards
- `artifacts/sitesort/src/pages/subcontractors/index.tsx` — Share on sub cards (desktop + mobile)
- `artifacts/api-server/src/routes/compliance.ts` — `fileUrl` added to `pendingAcknowledgments` response
- `artifacts/api-server/src/routes/permits.ts` — `DELETE /permits/:permitId` endpoint added

### Notes for next session
- **Share pattern is now consistent across all entities** — DropdownMenu with `<Mail>` (mailto:) and `<MessageCircle>` (wa.me) items; always use `window.open()` not `<a target="_blank">`
- **Two-layout pages** (mobile card + desktop table): documents tab, invoices — any new actions added to one must be added to both
- **Per-project Compliance tab** at `TabsContent value="permits"` in project detail — tab label is "Compliance" but value must stay `"permits"` to keep URL routing intact
- **PERMIT_TYPES** defined in both `detail.tsx` and `projects/index.tsx` — keep in sync
- **API server does NOT hot-reload** — after editing any backend file: `pnpm --filter @workspace/api-server run build` then restart node process
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
- All commits are on `main`

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

6. **Invoice attachment `{"error":"not_found"}` investigation**:
   - GCS confirmed working — `GET /api/uploads/:filename` streams correctly for files that exist
   - Specific PDF `dccbf650-91e2-4597-8cb9-a3e17a098003.pdf` was missing from GCS (uploaded in an earlier session when storage may have been configured differently; file permanently lost)
   - Fixed by nulling out the orphaned `attachment_url` on that invoice row — UI now shows "Attach document" so user can re-upload
   - All other attachments tested and confirmed working

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
- **GCS file serving**: `GET /api/uploads/:filename` streams from GCS bucket `replit-objstore-8ff09467-8d72-4a2a-902a-af340cf33a56` with prefix `.private`; `objectKey(filename)` → `.private/uploads/<filename>`; `{"error":"not_found"}` means the file genuinely doesn't exist in GCS (not a code bug)
- **API server does NOT hot-reload** — after editing any backend file: `pnpm --filter @workspace/api-server run build` then restart node process
- **GitHub push command**: `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
- All commits are on `main`

## End-of-session notes — 2026-06-05, 2026-05-27 & 2026-06-06 — see CLAUDE_ARCHIVE.md for full detail
