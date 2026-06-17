# SiteSort – Session Log Archive

## End-of-session notes — 2026-06-06 (session 2)

### Tasks completed
1. **Mobile header logo size** — increased from `h-8` to inline `style={{ height: '72px' }}` on the `md:hidden` mobile header in `sidebar-layout.tsx`; used inline style rather than Tailwind class to guarantee the size isn't affected by CSS purging.
2. **QR site board check-in with date-stamped photo**: New `site_checkins` table; `POST /api/site/:token/checkin` (public multipart, stamps photo via Canvas API, uploads to GCS, records GPS); `GET /api/projects/:id/checkins` (auth); Check-ins tab in project detail with photo grid; site-board "Site Check-In" card with camera trigger, retake option, success screen.

### Key files modified
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — mobile logo height inline style
- `lib/db/src/schema/site_checkins.ts` — new table
- `artifacts/api-server/src/routes/qr.ts` — check-in POST + GET endpoints
- `artifacts/sitesort/src/pages/site-board.tsx` — `stampPhoto()` canvas helper + `CheckInCard`
- `artifacts/sitesort/src/pages/projects/detail.tsx` — `checkins` state, fetch, Check-ins tab

## End-of-session notes — 2026-06-06 (session 1)

### Tasks completed
1. **DM read receipts** — `?after=` poll response includes `readUpdates: [{id, readAt}]`; grey ✓ (sent) / blue ✓✓ (seen); indicator updates live within 5s.
2. **Admin beta access UI** — `GET/PATCH /api/admin/companies` + `/beta-access`; orange toggle per company row on admin dashboard.
3. **Email notifications via Resend** — `emailNotifications` boolean on users; `email.ts` templates for DM/channel/permit-expiry; `permit-reminders.ts` daily cron (30s after startup, then 24h); Settings > Notifications email toggle.

### Key files modified
- `lib/db/src/schema/users.ts` — `emailNotifications` boolean column
- `artifacts/api-server/src/lib/email.ts`, `permit-reminders.ts` — email helpers + scheduler
- `artifacts/api-server/src/routes/auth.ts`, `messages.ts`, `channels.ts` — email triggers
- `artifacts/sitesort/src/pages/settings/index.tsx` — email toggle

## 2026-03-26
- Built and completed all 10 core features of the SiteSort platform
- Added `scripts/src/github-setup.ts` to create the GitHub repo via Replit Connectors SDK
- Added `scripts/src/github-push.ts` to push workspace files to GitHub via the GitHub Contents API (owner: `deanparrish-cmd`, repo: `sitesort`)
- Confirmed GitHub push mechanism works without a personal access token (uses Replit OAuth connector)

## 2026-04-07
- Landing page visual polish session (no functional changes)
- All three feature cards changed to dark grey (`bg-gray-800`, `border-gray-700`) with white headings and `text-gray-300` body text
- All three feature card icons changed to `text-orange-500` / `bg-orange-500/20`
- "site information" hero gradient updated to `from-orange-800 to-orange-400`
- Accent button variant updated to match: `bg-gradient-to-r from-orange-800 to-orange-400`
- Removed animated badge; added "Built for Construction SMEs." as bold inline text below hero paragraph
- `logo-concepts.html` added to `public/` (5 SVG logo concepts)

## 2026-05-11
- Drag-and-drop file upload on compliance page — global drag overlay, per-row insurance targets, paste support, post-drop modal
- Team messaging (`/messages`) — new `messages` DB table, full CRUD API (`/api/messages/*`), two-panel chat UI, 5s polling, unread badges
- Message notifications — server creates `notifications` row on send; sidebar polls unread count every 10s, fires toast + browser OS notification
- New DB table: `messages` (id, companyId, senderId, recipientId, content, readAt, createdAt)
- Key files: `lib/db/src/schema/messages.ts`, `artifacts/api-server/src/routes/messages.ts`, `artifacts/sitesort/src/pages/messages/index.tsx`, `artifacts/sitesort/src/components/layout/sidebar-layout.tsx`
- Known pre-existing TS errors: `lib/api-zod/src/index.ts` duplicate exports (`ListDocumentsParams`, `ListPhotosParams`); `buttonVariants`/`queryKey` errors in `projects/detail.tsx`

## 2026-05-13
- **Notifications page** (`/notifications`) — filter tabs (All/Unread/Messages/Documents/Safety), per-type icons, click-to-read, mark-all-read, badge clears on visit
- **Invoice file attachments** — `attachment_url` on invoices table; drag-and-drop + click-to-upload; Open/Email/WhatsApp share; remove button
- **Open/Share on project documents and compliance insurance certificates**
- **Fixed file serving** — uploads now at `/api/uploads/`; upload endpoint returns `/api/uploads/…` URLs; Vite proxy added
- DB schema: `invoices` table added `attachment_url` column
- Key files: `notifications/index.tsx`, `invoices/index.tsx`, `compliance/index.tsx`, `projects/detail.tsx`, `routes/compliance.ts`, `routes/invoices.ts`, `routes/upload.ts`, `app.ts`, `vite.config.ts`, `App.tsx`, `lib/db/src/schema/invoices.ts`

## 2026-05-14
- **Settings page** (`/settings`) — Profile (name/phone/avatar), Security (change password), Notifications (toast + OS toggles), Company (admin: name/size)
- **Notification toggles wired** — sidebar poller checks `sitesort_notif_toast` / `sitesort_notif_os` localStorage keys
- **Document supersedes selector** — upload form shows optional "Supersedes" dropdown; API accepts `supersededDocumentId`
- **Avatar upload** — hover camera overlay, uploads via `POST /api/upload`, patches `avatarUrl`
- **Document status/version editing** — Edit button opens dialog; backed by `PATCH /api/documents/:documentId`
- New API: `PATCH /api/auth/me`, `POST /api/auth/change-password`, `GET/PATCH /api/companies/mine`, `PATCH /api/documents/:documentId`
- Key files: `settings/index.tsx`, `App.tsx`, `routes/auth.ts`, `sidebar-layout.tsx`, `projects/detail.tsx`, `compliance/index.tsx`, `invoices/index.tsx`, `routes/documents.ts`

## 2026-05-21
- **Billing tab in Settings** — three pricing cards (Solo £29/Team £79/Pro £149), Stripe Checkout session on click, 14-day trial
- New API: `POST /api/billing/checkout`
- Key files: `routes/billing.ts`, `routes/index.ts`, `settings/index.tsx`

## 2026-05-25 (sessions 1–5)

### Session 1 — Dashboard, invoice viewer, PDF export, sub "Add to Project"
- **Real user dashboard** — personalised greeting, 4-stat cards, Needs Attention panel, active project cards + recent activity feed, portfolio snapshot, site calendar
- **Inline invoice document viewer** — full-screen panel; PDF iframe / image / fallback; sidebar with details; open/share/mark-paid header actions
- **Project detail PDF export** — "Export Report" button generates print-ready HTML in new tab, auto-triggers print dialog; sections: summary, team, permits, documents, finances, photos
- **Subcontractor "Add to Project"** — FolderPlus button on each sub card; dialog with active project list; one-click add with inline per-project feedback (spinner → Added ✓ / Already on project / Failed)
- Key files: `dashboard/index.tsx`, `invoices/index.tsx`, `projects/detail.tsx`, `subcontractors/index.tsx`

### Session 2 — Enforced directory-first workflow
- Removed "+ Add Person" button + dialog from project Team tab; contacts must come from subcontractor directory first
- Key files: `projects/detail.tsx`

### Session 3 — Cancellation enforcement, landing page, broadcast messaging
- Cancellation guards on all write actions across every page (projects, detail, subcontractors, messages, invoices, settings)
- Landing page: removed Book Demo button; added `#pricing` section (Solo £29 / Team £79 / Pro £149); fixed bullet alignment on dark feature cards
- Broadcast messaging: three-mode picker (Individual / By Role / All in Project); `POST /api/messages/broadcast`
- Key files: all page files + `routes/messages.ts`, `landing.tsx`

### Session 4 — Invoice + doc/photo/permit sharing in messages
- Invoice sharing: Receipt button, picker, invoice card in thread; `invoiceId` + `content default("")` schema changes
- Doc/photo/permit sharing: Paperclip picker with tabbed project selector; typed attachment cards; `attachmentType` + `attachmentId` schema columns
- Key files: `lib/db/src/schema/messages.ts`, `routes/messages.ts`, `messages/index.tsx`

### Session 5 — Project channel group messaging
- `#ProjectName` shared threads; sidebar above DMs with unread badge; edit/delete own messages; 5s polling; full attachment support; notifications to all members; read tracking
- New tables: `channel_messages`, `channel_reads`; new routes: `GET/POST /api/channels/:projectId/messages`, `PATCH/DELETE /api/channel-messages/:id`
- Key files: `lib/db/src/schema/channel_messages.ts`, `channel_reads.ts`, `routes/channels.ts`, `messages/index.tsx`

### End-of-session summary
- Fixed pre-existing `authHeaders()` TS return-type error; fixed `lib/db` composite stale `.d.ts` cache
- Known pre-existing TS errors: `alert-dialog.tsx`, `calendar.tsx`, `command.tsx`, `pagination.tsx`, `dashboard/index.tsx`, `projects/detail.tsx`, Drizzle `eq()` overloads; `lib/api-zod` duplicate exports — none affect runtime

## 2026-05-26

### Message reactions
- Emoji reactions (👍 ✅ 👀 ❤️ 😂) on DMs and channel messages; hover → 😊 button → inline picker; pill badges with count; own reactions highlighted; toggle on/off
- Schema: `message_reactions` + `channel_message_reactions` tables (unique on messageId/userId/emoji, cascade-delete)
- API: `POST /api/messages/:id/react`, `POST /api/channel-messages/:id/react` (toggle, return grouped reactions); thread endpoints embed `reactions: [{emoji, count, mine}]`

### Reply-to-message (WhatsApp-style quotes)
- Hover → ↩ button sets "Replying to" bar above compose; sending attaches `replyToId`; quoted block rendered above reply bubble
- Schema: `replyToId` nullable column on `messages` and `channel_messages` tables
- API: batch-fetch quoted messages in thread endpoints; POST endpoints accept `replyToId`

### Message search
- Debounced (300ms) search input in sidebar; grouped results (DMs / Channels); yellow-highlighted matched snippets; click to open conversation
- API: `GET /api/messages/search?q=`, `GET /api/channels/search?q=` (ILIKE, role-aware, max 30 results)

### Quick reply templates
- ⚡ Zap button in DM + channel compose bars; 18 templates across 4 categories (Acknowledge, Status, Requests, Safety); inserts into draft, doesn't auto-send; no DB changes

### Landing page text formatting
- Hero subtitle: 3 controlled lines via `<br />`; features subtitle: 2 lines via `<br />`

### Subcontractor invite links
- UserPlus button on sub card → `POST /api/subcontractors/:id/invite` → share modal (copy, WhatsApp/Email/SMS)
- Register page detects `?invite=<token>` → tailored form (email locked, name pre-filled, password only)
- `POST /api/auth/invite/:token/accept` creates user (role `subcontractor`, `emailVerified: true`), marks `inviteUsedAt`
- Key files: `routes/auth.ts`, `subcontractors/index.tsx`, `auth/register.tsx`

## 2026-06-05

1. **Message pagination** — cursor-based (`?before=<id>` / `?after=<id>`) for DM threads and channel threads; default returns last 50 + `hasMore`; "Load older messages" button; scroll-position preserved via `scrollHeight` anchor + `useLayoutEffect`
2. **Invoice document viewer fix** — replaced broken `<iframe>` with `<object>` PDF embed + fallback button; all "Open" links converted from `<a target="_blank">` to `window.open()`
- Key files: `routes/messages.ts`, `routes/channels.ts`, `messages/index.tsx`, `invoices/index.tsx`

## 2026-05-27

1. **Beta access flag** — `betaAccess` boolean on `companies` table; bypasses all Stripe checks; `GET/PATCH /api/companies/mine` returns `betaAccess`; `SubscriptionContext` overrides `isCancelled` and `effectiveStatus`
2. **Project progress tracking** — `milestones` table; 4 CRUD endpoints; `progressPercent` computed from milestones; Progress tab in project detail (progress bar, checklist, Gantt timeline); mini progress bar in project list
3. **Onboarding checklist** — dismissible card on dashboard; 5 steps derived from real DB data via `GET /api/onboarding/status`; localStorage dismiss key `sitesort_onboarding_dismissed`
- Key files: `lib/db/src/schema/milestones.ts`, `routes/projects.ts`, `routes/onboarding.ts`, `projects/detail.tsx`, `projects/index.tsx`, `dashboard/index.tsx`, `lib/db/src/schema/companies.ts`, `contexts/subscription.tsx`

## 2026-05-22 (detailed log)

### Stripe webhook handler
- `POST /api/billing/webhook` — verifies signature, handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Raw body middleware registered for webhook route before `express.json()`

### Project creation gating
- `POST /projects` checks plan: free/solo=1, team=5, pro=unlimited, cancelled=1; returns `403 { error: "plan_limit" }`
- Upgrade dialog shown on projects page when plan limit hit
- Billing tab highlights current plan, shows subscription status banner
- `?tab=` URL param in Settings opens correct tab directly

### Stripe Customer Portal
- `stripeCustomerId` column added to companies table
- `POST /api/billing/portal` creates portal session; falls back to email lookup if no stored ID
- "Manage subscription" button in billing tab

### Trial-ending + payment-failed notifications
- `customer.subscription.trial_will_end` — creates `trial_ending` notification for all admins
- `invoice.payment_failed` — creates `payment_failed` notification for all admins
- Notifications page: orange/red `CreditCard` icons, `billing` filter tab
- Full webhook event list: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`

### Message editing + deletion
- Pencil icon on hover opens inline edit; Enter saves, Escape cancels; `(edited)` label shown
- Trash icon shows inline confirm; deletes from thread and refreshes conversation list
- `editedAt` column added to `messages` table
- New API: `PATCH /api/messages/:id`, `DELETE /api/messages/:id`

### Read-only mode on cancellation
- `SubscriptionContext` (`contexts/subscription.tsx`) fetches `/api/companies/mine`; exposes `{ tier, status, isCancelled, isLoading }`
- `SubscriptionProvider` wraps app in `App.tsx`
- Persistent red banner on all authenticated pages when `isCancelled`
- "New Project" button redirects to billing when cancelled

### Global voice command navigation
- Mic button in sidebar + desktop header; Web Speech API; floating hint overlay; toast feedback
- Prefix-strip regex covers "go to", "navigate to", "open", "show me", "view", "see", "list", "my"
- Commands: all nav destinations + aliases (home→dashboard, insurance→compliance, chat→messages, billing→settings?tab=billing)
- Action commands: "new project" → `/projects?new=1`; "new invoice" → `/invoices?new=1`; "find invoice" → `/invoices?recall=1`; "add subcontractor" → `/subcontractors?new=1`; "find subcontractor [term]" → `/subcontractors?q=<term>`; "upload compliance" → `/compliance?upload=1`; "find compliance [term]" → `/compliance?q=<term>`; "new message" → `/messages?new=1`; "send message to [name]" → `/messages?to=<name>`; "dictate message" → `/messages?dictate=1`; "log safety issue" → `/projects?safety=1`; "add permit" → `/projects?permit=1`; "find permit [term]" → `/compliance?q=<term>`; "upload photo" → `/projects?photo=1`; "recall photos" → `/projects?viewphoto=1`

### Safety issue + permit voice command modals
- Safety issue modal: project picker, voice description, zone, optional photo → `POST /api/projects/:id/photos` (category `safety_concern`)
- Permit modal: project picker, 9 permit types, voice description, responsible person, start/expiry dates → `POST /api/projects/:id/permits`
- `photoUrl` made optional/nullable in `photos` table

### Photo voice commands + Photos tab
- Photo upload modal: project picker, category, voice description, zone, file upload with preview → `POST /api/projects/:id/photos`
- Recall flow: `?viewphoto=1` navigates to active project's `/projects/:id?tab=photos`
- Photos tab in project detail: colour-coded grid (thumbnail, category badge, reference number, zone, date, uploader)
- `?tab=photos` URL param selects Photos tab on load

## End-of-session notes — 2026-06-08

### Tasks completed today

1. **Mobile subcontractor card layout fix** — two-section card: top (avatar + info) + mobile-only bottom bar with insurance badge + action icons. Desktop unchanged.
2. **Mobile layout fixes** — projects/index.tsx: `min-w-0 flex-1 truncate` on project name; messages/index.tsx: `min-w-0 flex-1` on thread header; compliance/index.tsx: `flex-col sm:flex-row` insurance rows.
3. **Invoice attachment viewer** — replaced `<object>` PDF embed with file card (Open PDF button + Download link); image viewer unchanged.
4. **File-open link audit** — 9 `<a target="_blank">` links converted to `window.open()` across compliance, insurance-cert-zone, messages, projects/detail.
5. **Share dropdowns on photos, permits, check-ins** in project detail — Email + WhatsApp with URL normalisation.
6. **Invoice attachment not_found fix** — orphaned GCS file nulled out on the DB row.

### Notes
- All file-open links use `window.open()` — no `<a target="_blank">` for file links
- No `<object>` or `<iframe>` PDF embeds — use file card pattern
- GCS `{"error":"not_found"}` = file genuinely missing, not a code bug

## End-of-session notes — 2026-06-09 (share buttons + per-project compliance tab)

### Tasks completed today

1. **Share on mobile doc card** — added Share dropdown to the mobile card layout in the documents tab (was desktop-only).
2. **Share across compliance page** — Expiring Permits and Pending Sign-offs got Email + WhatsApp share; responsive layouts; API returns `fileUrl` on `pendingAcknowledgments`.
3. **Share on invoice mobile card**, **team member cards**, **subcontractor cards**.
4. **Per-project Compliance tab** — full build-out of the previously empty Permits tab:
   - PERMIT_TYPES list expanded (CSCS Check, IPAF, Hot Works, etc.)
   - Tab label "Compliance", value stays `"permits"` for URL routing
   - Permits grouped Expired/Expiring Soon/Active; Add Permit dialog; Delete endpoint
   - Team Insurance section below permits

### Notes
- **Per-project Compliance tab** at `TabsContent value="permits"` — label "Compliance", value must stay `"permits"`
- **PERMIT_TYPES** defined in both `detail.tsx` and `projects/index.tsx` — keep in sync

## End-of-session notes — 2026-06-09 (CLAUDE.md housekeeping)

- Voice features removed by user (do not re-add Web Speech API features)
- Feature #45 (subcontractor notes) and #46 (invoice project organisation) added by Replit Agent
- Features renumbered 1–46

## End-of-session notes — 2026-06-09 (compliance documents + certificate attachment)

### Tasks completed

1. **Subcontractor notes project scoping (feature #45 enhancement)**:
   - `subcontractor_notes.projectId` nullable FK added (DB already pushed)
   - API `GET ?projectId=` filter returns general + project-scoped notes together; POST accepts `projectId`
   - Directory page shows "General" or project-name pill badge per note
   - Project Team tab: StickyNote button on each subcontractor member opens a notes dialog with "General (all projects)" / "This project only" scope toggle

2. **Compliance Documents section in project compliance tab** — shows `permit`, `safety`, `method_statement` docs; empty state is a dashed drop zone; each doc row has Open + Share dropdown

3. **Certificate attachment on Add Permit dialog** — `FileDropZone` field saved to `permits.document_url`; permit rows show Open Certificate button; Email/WhatsApp share includes cert URL

4. **Certificate open button on global compliance page** — `expiringPermits` in `GET /api/compliance` returns `documentUrl`; permit rows show Open Certificate button when present

### Key files
- `lib/db/src/schema/subcontractor_notes.ts`, `artifacts/api-server/src/routes/subcontractors.ts`, `artifacts/api-server/src/routes/compliance.ts`
- `artifacts/sitesort/src/pages/projects/detail.tsx`, `artifacts/sitesort/src/pages/subcontractors/index.tsx`, `artifacts/sitesort/src/pages/compliance/index.tsx`

## End-of-session notes — 2026-06-10 (QR board pin management)

### Tasks completed

1. **QR board pin management (feature #44 completion)**:
   - `qr_board_pins` table (`id`, `projectId` FK cascade, `itemType`, `itemId`, `pinnedAt`; unique constraint)
   - `GET/POST/DELETE /api/projects/:id/qr-pins`; `onConflictDoNothing` on insert
   - `GET /api/site/:token` returns `pinnedItems` array with full data; `normaliseUrl()` helper
   - Project QR tab: "Board Contents" panel with thumbtack `<Pin>` toggle per item
   - Site board public page: "Pinned to this Board" section with doc/photo/permit rows

### Key files
- `lib/db/src/schema/qr_board_pins.ts`, `lib/db/src/schema/index.ts`
- `artifacts/api-server/src/routes/qr.ts`
- `artifacts/sitesort/src/pages/projects/detail.tsx`, `artifacts/sitesort/src/pages/site-board.tsx`

## End-of-session notes — 2026-06-10 (sign-up flow fixes + drag-and-drop)

### Tasks completed

1. **Sign-up flow fixes** (`artifacts/sitesort/src/pages/auth/register.tsx`):
   - Plan-change token reuse: decodes JWT on submit, skips register if email matches, goes direct to billing checkout
   - Confirm email field: Zod `.refine()` match check; stripped before API call
   - Password visibility toggle: `Eye`/`EyeOff` via `rightAction` prop on `Input` component

2. **Drag-and-drop fixed globally**:
   - Dialog backdrop `pointer-events-none`; click-to-close moved to outer wrapper
   - `FileDropZone` + `InsuranceCertZone`: document-level `dragover`/`drop` prevention while mounted
   - Upload route multer errors now return JSON instead of HTML

3. Database cleanup — deleted 4 automated `@test.com` test accounts

### Key files
- `artifacts/sitesort/src/pages/auth/register.tsx`, `artifacts/sitesort/src/components/ui/input.tsx`
- `artifacts/sitesort/src/components/ui/dialog.tsx`, `artifacts/sitesort/src/components/ui/file-drop-zone.tsx`
- `artifacts/sitesort/src/components/ui/insurance-cert-zone.tsx`, `artifacts/api-server/src/routes/upload.ts`

---

## End-of-session notes — 2026-06-10 (rename + contacts overhaul)

### Tasks completed
1. Global rename — Subcontractors → Contacts, Team → In House Team (sidebar, headings, tabs, buttons, dialogs, onboarding, PDF report across 7 files; Stripe "Team" plan name left unchanged)
2. Sidebar reorganised into two groups (Dashboard/Projects/Contacts/In House Team/Messages top; Compliance Centre/Invoices/QR Codes/Admin/Settings bottom)
3. `contactType` column on `subcontractors` table (subcontractor/merchant/supplier/professional/other); Add/Edit form shows selector; Trade Types section hidden for non-subcontractor types; directory groups by type
4. Insurance certificates surfaced on contact cards via `insuranceRecords[]` in list API; coloured pills with type, expiry, open-cert link

### Key files
- `sidebar-layout.tsx`, `subcontractors/index.tsx`, `team/index.tsx`, `projects/detail.tsx`, `projects/index.tsx`, `dashboard/index.tsx`, `compliance/index.tsx`
- `lib/db/src/schema/subcontractors.ts` — `contactType` column
- `api-server/src/routes/subcontractors.ts` — `contactType` + `insuranceRecords` in all endpoints

---

## End-of-session notes — 2026-06-10 (file document dialog + contact type UX)

### Tasks completed
1. "File this document" dialog redesigned — Document Type selector (Insurance Cert, Method Statement, Risk Assessment, Permit to Work, Compliance Cert, Drawing, Safety Doc, Other); insurance path → contact + sub-type + expiry → POST /api/subcontractors/:id/insurance; other types → project selector → POST /api/projects/:id/documents
2. Contact type badges on group headers and individual cards
3. Insurance cert pills on contact cards

### Key files
- `compliance/index.tsx`, `subcontractors/index.tsx`, `api-server/src/routes/subcontractors.ts`

---

## End-of-session notes — 2026-06-10 (contacts filter + UK English)

### Tasks completed
1. Contact type filter chips (All/Subcontractor/Merchant/Supplier/Professional Services/Other) on Contacts page
2. "Compliance Center" → "Compliance Centre" in sidebar

### Key files
- `sidebar-layout.tsx`, `subcontractors/index.tsx`

---

## End-of-session notes — 2026-06-10 (Compliance Centre superseded archiving)

### Tasks completed
1. Compliance Centre UI polish — removed Upload icon from insurance rows; Open/Share pills restyled to solid bg-gray-800
2. `archivedAt` column on `insurance_records` and `permits`; new cert/permit upload auto-archives existing same-type record; compliance API returns separate archived arrays; collapsible Superseded sections in Compliance Centre
3. Superseded Documents section in Compliance Centre (uses existing status="superseded")
4. Project Permits tab: live vs superseded split; Finances/QR board exclude archived permits; Contacts API filters to archivedAt IS NULL

### Key files
- `lib/db/src/schema/insurance_records.ts`, `lib/db/src/schema/permits.ts`
- `api-server/src/routes/compliance.ts`, `subcontractors.ts`, `permits.ts`
- `compliance/index.tsx`, `projects/detail.tsx`

---

## End-of-session notes — 2026-06-10 (invoice tablet fix + site issues log)

### Tasks completed
1. Invoice page tablet fix — breakpoint lg→md; description column md→lg; viewer header buttons responsive
2. Site Issues log (#48) — `status`/`resolvedAt` on photos table; GET/PATCH /api/photos/:id; GET /api/issues; new /issues page with filters, thumbnail list, detail modal; "Site Issues" in sidebar
3. Photo detail modal on project Photos tab — clicking card opens overlay instead of raw image; status badges on snag/safety cards
4. Dashboard safety_concern activity deep-links to ?tab=photos&photo=<id>

### Key files
- `lib/db/src/schema/photos.ts`, `api-server/src/routes/photos.ts`
- `invoices/index.tsx`, `issues/index.tsx` (new), `projects/detail.tsx`, `dashboard/index.tsx`
- `sidebar-layout.tsx`, `App.tsx`

---

## End-of-session notes — 2026-06-12 (team enhancements, site issues refactor, share fix)

### Tasks completed today (continued from earlier session)

1. **In House Team — Add Team Member button** (`artifacts/sitesort/src/pages/team/index.tsx`):
   - "Add Team Member" button in header, gated by `canManageTeam` (admin/PM)
   - Dialog: name, email, role (admin/PM/site worker), phone (optional), project checklist
   - Projects fetched on dialog open; checkboxes link new user to selected projects via `POST /api/projects/:id/members` after account creation
   - API sends invitation email with generated credentials; inline error on duplicate email

2. **Site Issues moved to each project**: "Site Issues" tab added to project detail — stats, search, status filter, quick-resolve, thumbnail list, photo detail modal. Removed from global sidebar. Tab label shows open count badge.

3. **Share content includes full issue details**: new `additionalInfo?: string` prop on ShareModal; issues build and pass a details block (type, ref, description, zone, project, status, logged-by, date, GPS).

4. **Dialog z-index fix** (`artifacts/sitesort/src/components/ui/dialog.tsx`): bumped from `z-50` to `z-[60]`.

5. **Subcontractor notes scoping fix**: `GET /api/subcontractors/:id/notes` with no `?projectId` returns only general notes; project-specific notes no longer leak into contacts directory.

### Key files modified
- `artifacts/sitesort/src/pages/team/index.tsx`, `artifacts/sitesort/src/pages/projects/detail.tsx`, `artifacts/sitesort/src/components/ui/dialog.tsx`, `artifacts/sitesort/src/components/share-modal.tsx`, `artifacts/api-server/src/routes/subcontractors.ts`

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

---

## End-of-session notes — 2026-06-15 (photo backfill, mobile feature parity)

### Tasks completed today

1. **Photo status backfill** — ran `UPDATE photos SET status='open' WHERE category IN ('snag','safety_concern') AND status IS NULL`; returned `UPDATE 0` (all existing photos already had status set from upload-time code, nothing needed backfilling).

2. **Mobile/tablet feature parity audit** (`artifacts/sitesort/src/pages/admin/index.tsx`, `artifacts/sitesort/src/pages/invoices/index.tsx`):
   - **Admin page — hidden table columns**: removed `hidden sm/md/lg:table-cell` from all admin table columns (Activity sub-detail, Feature usage bar, Users email + last-active, Companies plan/status/user-count/created). Tables already had `overflow-x-auto` wrappers so data is now accessible by horizontal scroll on mobile/tablet.
   - **Admin page — hidden header items**: removed `hidden sm:block` from "SiteSort" label, separator, last-updated timestamp, and "← App" button — all now visible on all screen sizes.
   - **Admin progress bars**: removed `hidden md:block` from sub-detail text in `ProgressBar` component.
   - **Invoices — Description column**: removed `hidden lg:table-cell` from the Description column header and cell — now visible on tablet too.

### Key files modified
- `artifacts/sitesort/src/pages/admin/index.tsx` — all hidden table columns/header items now always visible
- `artifacts/sitesort/src/pages/invoices/index.tsx` — Description column always visible

---

## End-of-session notes — 2026-06-16 (full monorepo typecheck repair)

### Context
`pnpm run typecheck` had been silently broken — 185 pre-existing type errors accumulated unnoticed (esbuild/Vite strip types without checking). Repaired the whole chain to exit 0.

### Tasks completed today

1. **CLAUDE.md trim** — was 30.9k chars; moved 06-11/06-12 session logs to `CLAUDE_ARCHIVE.md`.

2. **Genuine code bugs fixed**:
   - `lib/api-zod/src/index.ts` — ambiguous `export *` for `ListDocumentsParams`/`ListPhotosParams`; added explicit named re-exports.
   - `scripts/src/github-push.ts` — typed `opts` as `ProxyOptions` instead of `RequestInit`.
   - `dashboard/index.tsx` — `status === "completed"` should be `"complete"` (stat always read 0). Real bug.
   - `site-board.tsx` — inverted ternary made `status === "uploading"` spinner unreachable. Real UX bug.
   - `billing.ts` — Stripe SDK v22 moved `current_period_end` onto subscription items.
   - `ai.ts` — `Buffer` not assignable to `BlobPart`; wrapped in `new Uint8Array(audioBuffer)`.
   - Deleted 4 dead shadcn UI files (`alert-dialog`, `calendar`, `command`, `pagination`).
   - `projects/detail.tsx` — orval hooks need `queryKey` passed via `getGet*QueryKey(...)` helpers.

3. **Dependency version-drift pins** in `pnpm-workspace.yaml`:
   - `@types/express-serve-static-core` pinned to 5.1.0 (5.1.1 broke `req.params.x` types).
   - `@hookform/resolvers` packageExtension pins zod to 3.25.76 so zodResolver uses the app's zod v3 not the hoisted v4.
