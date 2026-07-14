# SiteSort – Session Log Archive

## Archived session one-liners (moved from CLAUDE.md)
- **2026-07-03 session wrap — ALL DEPLOYED+Published+prod-verified:** (1) **Team Portal (#61)** (see #61); (2) **Nav declutter** — removed Compliance Centre + Site Check-Ins from sidebar (redundant w/ per-project tabs); (3) **Contacts invite removed** — inviting is now project-only via Team Portal tab. **Loose ends (PD left):** dashboard still links now-unlinked `/compliance`; dormant subcontractor-invite backend (`/api/subcontractors/:id/invite` + `/register?invite=`, #36) unreachable from UI but KEPT; compliance/checkins routes still deep-linkable.
- **2026-06-29 — frontend performance pass (DEPLOYED ✅ `main → 16bc1bab`, Published):** code-splitting/lazy routes (`App.tsx` `React.lazy`+`Suspense`; 2.7 MB monolith → 88 chunks), `react-vendor` `manualChunks` (gotcha: DON'T name-chunk route-exclusive libs like recharts — drags shared helpers eager), images→WebP (PNG originals kept). Landing first paint ≈ 173 KB gz.
- **2026-06-28 session wrap:** shipped + Published verification UX (#60), F1 P3, F2, F3, F4 (all live); typecheck+browser-verified. **Known issue (minor, prod-safe):** raw-fetch handlers that `res.json()` on `res.ok` (e.g. `loadCloseout`) can throw "Unexpected token '<'" vs a stale local backend missing `/api` — never in prod; add a content-type check if it recurs.
- **2026-06-26 — Stripe billing hardening (ALL DEPLOYED + live on www):** Four fixes across `billing.ts`, `admin.ts`, `register.tsx`. **(W) Webhook ack-first + dedup** — `/billing/webhook` verifies sig, responds `200` *immediately*, then fire-and-forget `processWebhookEvent` (fixes ~10s timeout→retries). New `stripe_webhook_events` ledger (PK=`evt_…`; drizzle + index + **ensure-schema** boot migration). `claimEvent()` atomic `INSERT…ON CONFLICT DO NOTHING…RETURNING`; duplicate events skipped before side effects; `releaseEvent()` on throw. (commit `053ccb5`/`2eb7de1`) **(1) Dup customers/subs** — `/billing/checkout` reuses customer (stored `stripeCustomerId`→else `customers.list({email})`, persists), and if an `active`/`trialing` sub exists returns `{alreadySubscribed:true}`. **Idempotency keys:** `customers.create` keyed `cust:<companyId>` + `checkout.sessions.create` keyed `checkout:<userId>:<plan>` (double-click→one customer+sub). Frontend `register.tsx`: `useRef` re-entrancy guard; `alreadySubscribed`→toast + `/settings?tab=billing`. (commit `d02985f`/`2e27d6f`) **(2) Beta never charged — skip-Stripe** — `admin.ts` PATCH `/admin/companies/:id/beta-access`: GRANT sets `betaAccess+status=active+tier="pro"` FIRST (cancellation webhook sees beta & skips — no downgrade race), THEN cancels live Stripe sub (try/catch→`warning`); REVOKE sets `status="incomplete"+tier="free"` → CheckoutGate. `billing.ts` `isCompanyBeta()` guard skips both webhook sub-handlers for beta cos. (commit `458749e`/`0488f49`) All verified in Stripe TEST mode then deployed + live-confirmed. Pushed GitHub `main → dbed53bd`. **Beta limits RESOLVED (`6d8f434`):** project cap (`projects.ts`) is the ONLY tier-based limit; now honours `betaAccess` (beta→unlimited), `tier="pro"` masquerade dropped.
- **2026-06-24 — F1 Phase 2 (permits accountability + expiry consolidation):** Added `permits.due_date` (drizzle + ensure-schema; assignee = existing `responsibleUserId`). New shared **`expiry.ts`** helper (`daysUntilExpiry` + `expiryStatus`, canonical bands: `<0` expired / `0–30` expiring_soon / `>30` active) on **both** sides (`api-server/src/lib/`, `sitesort/src/lib/`). Migrated the scattered permit derivations to it: `permits.ts` (was exact-day `expiring_today` → now `expiring_soon`), `compliance.ts` (fixed the **7-day band mislabeled `expiring_today`** bug), `qr.ts`, and `permit-reminders.ts daysUntil` now delegates. `formatPermit` serializes `dueDate`+`overdue` (`isOverdue(dueDate, !!archivedAt)`); POST/PATCH accept `dueDate`. **Wired the previously-unused `PATCH /api/permits/:id`** via a new Edit dialog (reassign responsible + due date + expiry + description). Permits-tab UI: Due-by in add form, OVERDUE badge + red "Action due" pill on cards, "N overdue" header pill; also fixed Finances tab showing expired permits as "Overdue" (invoice label leak) + a latent `responsibleName`-blank-on-load bug (normalizePermit). **OpenAPI spec updated** (Permit/Create/Update/ExpiringPermitItem: status enum→`expiring_soon`, +`dueDate`/`overdue`) + codegen regenerated. Full typecheck ✅; browser-verified on single-origin `:8080`; test data cleaned. ✅ **DEPLOYED + live-verified** on www.sitesort.co.uk (live bundle `index-BpR-Enwo.js` carries "Action due by"/"Edit Permit / Certification"; prod API create returned `status=expiring_soon`+`dueDate`+`overdue=true`, proving ensureSchema added `due_date` on prod; test permit deleted). ✅ **Pushed to GitHub** `main → 998c2bad` (405 files; 5 known >1MB PNGs skipped). Remaining issue: standalone `/issues` page still routed but orphaned from sidebar.
- **2026-06-23 (session 3 cont.) — PD backlog B1/B2/F1:** **B1** (Post-an-update drag/drop photo): root cause was NOT a broken drop handler — the update & photo were decoupled and "Save update" ignored the upload. Added `daily_notes.photo_url` (+ensure-schema), API validates photoUrl (own `/api/uploads` only), thumbnail in note card + Open dialog. **B2** (drawing distribution): feature was *orphaned* — backend complete but frontend never created a distribution, and emailed links bypassed the authed view-tracker. Added **Allocate** UI → `POST /documents/:id/distribute` (team-members-only) + unauthenticated tracked `GET /documents/:id/open?d=<distId>` (flips pending→viewed, 302→file); upload/distribute now email a per-recipient tracked link. **F1 Phase 0+1** (assignment & accountability): shared primitives — `photos.assignedToUserId`+`dueDate` (+ensure-schema), `lib/accountability.ts isOverdue(dueDate,isDone,now)`, shared `components/ui/overdue-badge.tsx`; snags/safety end-to-end — Assign-to+Due-by in log form, OVERDUE badge+assignee+due on cards, Overdue stat+filter, inline reassign in detail modal; mirrored read-only on `/issues`. All verified on rebuilt temp `:8090` bundle + typecheck; test data cleaned. ✅ **All DEPLOYED + confirmed live** on www.sitesort.co.uk (live JS-bundle string-check + `/open` route body). Commits: B1 `d3825e7`, B2 `88023c1`, F1 `9cfae11`.
- **Expiry reminders — fully verified live (closed):** Made the daily job observable (`permit-reminders.ts` — warns on missing `RESEND_API_KEY`, per-run `ReminderStats` `scanned/noMilestone/notifyOff/deduped/sent`, per-send breadcrumb; `9e589b4`). Confirmed real send on prod: `POST /api/test-email` `{"template":"permit"}` → `200`, received; AND the *scheduled* job — a 7-day test permit (Responsible = Amy) emailed on next boot run and was received. Job runs 30s after boot + every 24h. `POST /api/test-email` is the fastest live-send check. Test permit deleted.
- **2026-06-23 (session 2):** Feature #59 — expanded expiry email reminders: 30/21/14/7/1 days then daily for 7 days once expired; `expiry_reminder_logs` table + ensure-schema de-dup; `permit-reminders.ts` `milestoneFor` bucketing + `claimMilestone`. ✅ DEPLOYED + live.
- **2026-06-23:** Feature #58 dashboard outstanding-invoices widget (`pages/dashboard/index.tsx`) — top-5 unpaid/overdue, Open/Share/Mark Paid pills + move-to-project Dialog + ShareModal. ✅ DEPLOYED + live-verified.
- **2026-06-18:** Feature #56 custom calendar events + QR site board upcoming events. ✅ DEPLOYED.
- **2026-06-18:** Signup fail-CLOSED on Stripe checkout failure + abandonment gate. ✅ DEPLOYED.
- **2026-06-18:** Site check-in bugfixes (in-house team members rejected; photo `object-contain`). ✅ DEPLOYED.
- **2026-06-17:** Mobile/tablet feature-parity audit, tablet stat density, clickable calendar dates, calendar dot indicator, plan limit upgrade dialog. ✅ DEPLOYED.

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

---

## End-of-session notes — 2026-06-18 (Site Calendar event deep-links to the actionable item)

### Task completed today
**Calendar day-dialog events now deep-link to the specific item, not the generic section page** (`pages/dashboard/index.tsx` + `pages/invoices/index.tsx`):
- Added optional `href?: string` to the `CalEvent` type; each event now carries a deep link computed where the id is available in the `calendarEvents` `useMemo`:
  - **Project start/end** → `/projects/${p.id}` (specific project detail)
  - **Permit** → `/projects/${permit.projectId}?tab=permits` (the project's **Compliance** tab — note tab nav maps `value:"permits"` → label "Compliance", `detail.tsx:975`; the permit list lives there)
  - **Invoice (in/out)** → `/invoices?invoice=${inv.id}` (opens the invoice viewer)
  - **Insurance** → unchanged `/compliance` fallback — the `ExpiringInsuranceItem` API record has only `subcontractorId`, **no `projectId`**, so there's no project to deep-link to.
- Day dialog link now uses `e.href ?? EVENT_LINK[e.type].href`; `EVENT_LINK` labels made action-oriented ("Open project" / "View permit" / "Open invoice").
- **Invoices page**: new `useEffect` reads `?invoice=<id>`, opens the viewer for the matching invoice once loaded, and strips the query param via `replaceState` (mirrors the existing `?new=1` pattern).

### "All versions of the app"
There is **only one** Site Calendar / `calendarEvents` implementation in the whole repo — `artifacts/sitesort/src/pages/dashboard/index.tsx`. It's a single responsive component covering mobile/tablet/desktop. (`artifacts/mockup-sandbox/src/components/ui/calendar.tsx` is an unrelated react-day-picker UI primitive, not the dashboard calendar.) So the change covers every version.

### Verification
- `pnpm run typecheck` **green**.
- Browser-tested via the `/api`→:8080 reroute trick (JWT injected, all `/api/**` re-fetched against :8080): clicked a red-dot day → "Open project" navigated to `/projects/<id>` (specific detail page, not the list); `?invoice=<id>` opened the viewer and cleaned the URL; `?tab=permits` landed on the Compliance tab showing the permit list. **Zero console errors** on all paths.

---

## End-of-session notes — 2026-06-18 (custom user-created calendar events) — Feature #56

### What was built
PMs/admins can **add their own shared events to the dashboard Site Calendar**; every company member sees them. Fields: **title + date + optional note** (company-shared visibility, decided with the user; future: surface on QR site board + subcontractor portal).

- **DB**: new `calendar_events` table (`lib/db/src/schema/calendar_events.ts`, exported from `schema/index.ts`) — `id` (text PK, app-gen uuid), `companyId` (FK→companies, `onDelete: cascade`), `createdBy` (FK→users), `title`, `eventDate` (date), `note` (nullable), `createdAt`. Pushed via `pnpm --filter @workspace/db run push`.
- **API**: `artifacts/api-server/src/routes/calendar-events.ts` (mounted in `routes/index.ts`): `GET /api/calendar-events` (company-scoped list, any member), `POST` (create — **managers only**, 403 otherwise; manual validation), `DELETE /:id` (managers only, tenant-scoped). Follows the invoices.ts pattern (authenticate, try/catch, `req.user!.companyId`).
- **Frontend** (`pages/dashboard/index.tsx`): new `CalEvent` type `"custom"` (violet dot + legend entry); `customEvents` fetched in the existing `useEffect` and merged into `calendarEvents`. `SiteCalendar` gained props `canManage` / `onCreate` / `onDelete`. **"Add Event"** button in the calendar header (managers only) + **"Add event on this day"** in the day-detail dialog (prefills that date). Add dialog = title `Input` + date `Input[type=date]` + note `Textarea`. Custom events in the day dialog show the note and a **Delete event** button (managers) instead of a deep-link. Create/delete go through `createCalendarEvent`/`deleteCalendarEvent` with the `isCancelled` read-only guard + toasts; delete is optimistic with rollback. Gated on `caps.canManageProjects` (= admin/project_manager).

### ⚠️ Server run model (important — learned the hard way this session)
The **api-server runs a prebuilt bundle** `artifacts/api-server/dist/index.mjs` (built by `build.mjs` = esbuild server + `pnpm sitesort build` frontend), started by the Replit workflow as `node --enable-source-maps ./dist/index.mjs` with **`PORT=8080` injected by the supervisor**. It does **NOT** watch source. After a backend change you must rebuild AND restart the process. **Killing the node server does NOT auto-restart** — it tears down the whole api-server workflow (frontend vite on :18299 survives, it's a separate workflow). To restart manually: `cd artifacts/api-server && PORT=8080 NODE_ENV=development node --enable-source-maps ./dist/index.mjs` (DATABASE_URL/JWT_SECRET/Stripe/etc. are already in the shell env; only PORT is missing). The user's **Run button / republish** will replace the manual process cleanly. Frontend (:18299) serves live HMR source, so FE changes don't need this.

### Verification
- `pnpm run typecheck` **green**; DB pushed; server bundle rebuilt + restarted on :8080 (health 200, `/api/calendar-events` returns JSON not SPA-fallback).
- Backend CRUD tested end-to-end against the fresh bundle (throwaway instance on :8091): POST 201, GET lists it, missing-title 400, DELETE 204, GET empty.
- Browser-tested (reroute to :8091 = new bundle): "Add Event" → fill title/date/note → submit shows "Event added" toast → custom event appears in the day dialog with note + Delete button → delete removes it. **Zero console errors.** (The one lingering title match post-delete was the success toast text, not the calendar.)

### Follow-ups not done (user mentioned, deferred)
- ~~Surface custom events on the **QR site board** public page~~ — DONE 2026-06-18, see next note.
- Surface in the **subcontractor portal** (to be built later).


---

## End-of-session notes — 2026-06-18 (BUGFIX: site check-in rejected in-house team members)

**Bug:** QR site-board check-in (`POST /api/site/:token/checkin`, `routes/qr.ts`) `innerJoin`ed **only `subcontractorsTable`**, so in-house team members (users on the project) always got `not_registered` ("Access Denied") — reproduced via curl as the project's own manager. Not device-specific (user reported it on tablet). **Fix (decided with user — "team + subs on project", in-house matched by "name alone"):** check the project's **users first** (`projectMembers ⨝ users`, name-only case-insensitive match, no company/insurance needed); only if not an in-house member fall through to the existing subcontractor path (name + company + valid non-archived insurance). Then the Upcoming Events card screenshot was finally captured (drove a real in-house check-in in-browser). **Verified** all 5 paths via curl: in-house→201, unregistered→403 not_registered, sub no-insurance→403 no_valid_insurance, sub wrong-company→403 not_registered, sub+valid-insurance→201. Test data (events, Dave→Riverside link, fake cert, check-ins) cleaned up. Company field still entered on the form but ignored for in-house matching. **Follow-up copy fix (`site-board.tsx`):** softened the now-inaccurate gate copy — requirements list → "You must be registered on this project (team member or subcontractor)" + "Subcontractors must have a valid insurance certificate on record"; `not_registered` Access-Denied message reworded to "couldn't match your details to anyone registered on this project…". NOTE: a pre-existing demo check-in "Dean Parrish" (2026-06-06) on Riverside is real data — leave it.

---

## End-of-session notes — 2026-06-18 (check-in photo cropped faces — `object-cover` → `object-contain`)

**Issue:** check-in photo "zooms in too close, can't see the face." Root cause was **CSS only** — `stampPhoto` (`site-board.tsx:5`) stores the FULL frame (canvas = naturalWidth×naturalHeight, no crop); the displays used `object-cover` in fixed-aspect boxes, cropping top/bottom (faces). **Fix:** switched the three **check-in** photo displays to `object-contain`: capture preview (`site-board.tsx`, also `max-h-48`→`max-h-72` + `bg-gray-100`), Site Check-Ins page grid thumbnail (`pages/checkins/index.tsx`), project-detail Check-ins tab grid thumbnail (`pages/projects/detail.tsx`). The check-in **detail modals already used `object-contain`** (untouched). Deliberately left `object-cover` on NON-check-in photos (issues, avatars, pinned site photos `site-board.tsx:621`). Verified in headless tablet (820px) with a 300×720 portrait test image: preview shows full frame (top+face+bottom, letterboxed), `objectFit: contain`, zero console errors.

---

## End-of-session notes — 2026-06-18 session 2 (browser-verified Upcoming Events card post-check-in, pushed)

New session opened with the startup checklist (CLAUDE.md was 28.2KB, under 30k; `git pull` is a no-op here — pushes go via the GitHub connector/API, so `origin/main` has different SHAs + 0-byte large PNGs and must **not** be merged; local `main` is authoritative).

**Task: verify the "Upcoming Events" card in the browser** (the prior session's one open gap — it was verified at the API/code-review layer but never with a post-check-in screenshot, because the card sits behind the check-in gate).

- **Verified end-to-end in headless Chromium** against the **:8080 full bundle** (serves frontend + `/api`; Vite :18299 does NOT proxy `/api`, so use :8080 for any page that hits the API). Flow: navigate `/site/<Riverside token>` → fill name `Paul Smith` (in-house admin on the project) + company → `setInputFiles` on the hidden `input[type=file]` (bypasses the native camera picker) → click **Confirm Check-In** → board renders. **Card confirmed**: shows BOTH a company-wide ("Site Safety Briefing") and a Riverside-scoped ("Concrete Pour Level 3") event, ascending, violet date chips + weekday + note, positioned after Site Manager. Zero console/page errors.
- **Driver gotchas** (one-off `/tmp` playwright-core script): playwright-core in the skill dir is **CJS** — import `pw.default.chromium`, not `{ chromium }`. Test photo made with `magick` (PIL absent; `convert`'s `-annotate` needs a font path so omit text). Granted empty geolocation perms so `getCurrentPosition` rejects fast instead of hanging the 5s timeout.
- **Test data fully cleaned up**: 2 `BROWSERTEST` calendar_events + the Paul Smith site_checkins row (matched on the `checked_in_at` column — NOT `created_at`) + the uploaded photo. Pre-existing demo "Dean Parrish" (2026-06-06) check-in left intact.
- **Pushed**: `push-robust.ts` → `main → ca74c860` (395 files; same 5 >1MB PNGs skipped as always). `verify-push.ts` → 12/12 signatures present on GitHub `main`. No app code changed this session — only CLAUDE.md/CLAUDE_ARCHIVE.md docs.

---

## End-of-session notes — 2026-06-18 (custom events → QR site board) — extends Feature #56

### What was added
Custom calendar events now flow to the **public QR site board**, scoped per-event (decided with the user: "let PM choose per event" + "upcoming only").

- **DB**: added nullable `projectId` (FK→projects, `onDelete: cascade`) to `calendar_events` (`lib/db/src/schema/calendar_events.ts`). `null` = company-wide (every board); set = that project's board only. Pushed via `pnpm --filter @workspace/db run push`.
- **API — create** (`routes/calendar-events.ts`): `POST` now accepts optional `projectId`, **IDOR-checked** (must belong to `req.user.companyId`, else 400). `GET` returns it (select-all).
- **API — public board** (`routes/qr.ts` `GET /site/:token`, ~line 242): new query returns `upcomingEvents` = `calendar_events` where `companyId = project.companyId AND (projectId IS NULL OR projectId = qr.projectId) AND eventDate >= today`, `orderBy(asc(eventDate))`. Added `or`/`asc` + `calendarEventsTable` to imports. `eventDate` is a `date` column so the `gte(..., todayStr)` string compare works.
- **Frontend — dashboard** (`pages/dashboard/index.tsx`): Add-event dialog gained a **"Show on site board for"** `<select>` (Whole company / each project, from a new `projects` prop passed to `SiteCalendar`). `CustomEvent` + `CalEvent` + `createCalendarEvent` carry `projectId`. Day-dialog custom events show a **violet scope badge** (project name or "Company-wide").
- **Frontend — public board** (`pages/site-board.tsx`): destructures `upcomingEvents = []`; new **"Upcoming Events"** card (violet date-chip + title + weekday + note) inserted after Site Manager, before Active Permits. Uses the already-imported `Calendar` icon. (`data` is untyped `any`, so no shared type to update — just read the field.)

### Verification
- `pnpm run typecheck` **green**; DB pushed; server bundle rebuilt + restarted on :8080 (health 200).
- **Backend scoping proven end-to-end** (curl, real QR tokens): created company-wide + Project-A-scoped + a PAST event. Project A board → both future events (asc-ordered), PAST excluded. Project B board → only the company-wide one. Exactly right.
- **Browser-tested** (reroute `/api`→:8080 = new bundle): Add dialog selector lists "Whole company" + all 3 projects; created a Project-A-scoped event → "Event added" toast → day dialog shows the violet **"Riverside Apartments Block A"** scope badge + Delete → delete works. Public `/site/:token` loads clean (check-in gate). **Zero console errors.** Note: the Upcoming Events *card itself* is behind the check-in gate, so it was verified at the data/API layer + code review at the time.
- **2026-06-18 follow-up — Upcoming Events card verified post-check-in (full browser screenshot).** Drove the real check-in gate headless against the :8080 full bundle. Card shows both a company-wide and a project-scoped event, ascending, violet date chips + weekday + note, after Site Manager. Driver: one-off playwright-core script (CJS `.default.chromium`); test photo via `magick`. Test data cleaned up.

### ⚠️ Server run-model gotcha
The :8080 process during these sessions is a manually-started `node dist/index.mjs` kept alive via the Bash tool's `run_in_background: true`. `nohup`/`setsid` from a tool shell did NOT survive. The user's Run/republish cleanly replaces it.

---

## End-of-session notes — 2026-06-18 session 3 (signup card-upfront: fail-CLOSED on checkout failure)

**Report:** "a new user just registered and it didn't ask for card." **Finding: the feature already exists** — `Collect card details at registration` (commit `f029d02`, 2026-06-09 09:35) wired signup → `/api/billing/checkout` → Stripe. Stripe is fully configured (live `sk_live…` key + 3 price IDs + webhook secret); checkout works. Card-upfront flow in `routes/billing.ts /billing/checkout`: `mode:subscription`, `trial_period_days:14`, `payment_method_collection:"always"`, `missing_payment_method:"cancel"`. Register UI shows Solo/Team/Pro selector then redirects to Stripe.

**Root cause of card-less accounts:** `register.tsx onSubmit` failed **OPEN** — if `/billing/checkout` returned non-OK (or a stale published bundle), it silently `setLocation("/dashboard")`, handing out a `free`/`active` card-less account. (NormCo, created 10h after the feature, status `active`, no `stripe_customer_id`, is the proof.)

**Fix:** fail **CLOSED** — on checkout failure show an error banner + stay on /register to retry (reuses existing token); only a genuine "Stripe not set/not configured" error falls through to /dashboard (dev). Verified with deterministic playwright (mocked register=201 + checkout=500): banner shown, URL stays /register, no /dashboard leak.

**Abandonment hole — CLOSED.** `contexts/subscription.tsx` only blocked on `status === "cancelled"`, so an abandoned signup (`active`) was usable free. Fix:
- **Backend** (`auth.ts` register): new companies start `subscriptionStatus: "incomplete"` (was `active`). Webhook `handleSubscriptionUpsert` already flips `incomplete → trialing` on `checkout.session.completed`.
- **Frontend**: `subscription.tsx` exposes `needsCheckout = !betaAccess && status === "incomplete"`. New `components/checkout-gate.tsx` = full-screen hard gate (plan buttons → checkout; Log-out escape; polls `/companies/mine` on `?checkout=success` to handle the webhook race). `sidebar-layout.tsx` early-returns `<CheckoutGate/>` when `needsCheckout`.
- **Scope:** only NEW registrations get `incomplete`; existing `active` companies unaffected. Beta bypasses via `effectiveStatus`.
- **Verified** via playwright (mocked `/auth/me` + `/companies/mine`): `incomplete` → gate, `trialing` → app. Gotcha: Playwright matches routes **most-recently-added first** — register the catch-all `**/api/**` mock BEFORE specific ones.

**⚠️ Deploy:** both fixes reach users only after **Run/Publish** (live bundle is separate from workspace).

---

## End-of-session notes — 2026-06-18 session 4 (BUGFIX: messaging was 500-ing on all real data — `= ANY()` → `inArray()`)

**Report:** "get the internal message feature up and running." Two distinct problems:
1. **Every company has exactly 1 user** → nobody to message, so the feature *looks* dead. `/messages/users` returns company peers (always empty). Not a bug — needs ≥2 users.
2. **Real bug — `/messages/conversations`, `/messages/thread/:id`, `/channels`, search etc. all returned HTTP 500 the moment ANY message row existed.** Root cause: the `sql\`${col} = ANY(${jsArray})\`` pattern (used **24×** across `routes/messages.ts` + `routes/channels.ts`). Drizzle expands a JS array there into a **tuple** `ANY(($1,$2))`, and Postgres throws `op ANY/ALL (array) requires array on right side` (code 42809). The feature was built but never exercised with data (0 message rows in DB), so this never surfaced.

**Fix:** replaced all 24 with drizzle's `inArray(col, arr)` (added `inArray` import to both files; `ne` too for the one compound `… AND senderId != userId` case at channels.ts ~L67). Pure mechanical swap; the existing `arr.length ? … : []` guards stay so empty arrays never hit `inArray`.

**Verified** (rebuilt bundle on a throwaway `PORT=8090` instance — the Replit :8080 process holds the OLD bundle in memory): created a 2nd Acme user (Sarah) + a teammate (Tom) in the user's test company; full round-trips work — `conversations`/`thread`/`channels`/`search`/`send`/reply all 200, unread counts + read-receipts (✓✓) correct. **UI tested across desktop/tablet/mobile** (browser, all green, zero console errors). Screenshots confirm the two-pane chat, project channels, DM badges.

**Test data left in DB (demo helpers — offer to remove):** `sarah@acme.com` (Acme PM) + `tom@testsitesort.co.uk` (Test SiteSort site worker), both password `password123` (copied Paul's bcrypt hash), + a couple of demo DMs. They give the otherwise-1-user companies someone to message.

**✅ DEPLOYED LIVE** — 2026-06-18 16:53 (`427ed2b "Published your App"`). Verified on `www.sitesort.co.uk`: deployed JS contains new strings (`Add payment to start your trial`, `Save to`, `Open invoice`); live `/api/health` + `/messages/conversations` + `/channels` all 200. So ALL this session's work (messaging `=ANY()`→`inArray` 500-fix, invoice Open button + list previews, timestamp tooltips + Save-to-notes, signup card-upfront fail-closed + abandonment checkout gate) is now on live. Replit `replit` CLI has NO deploy command (only `identity`/`ai`) — publishing is a UI button the **user** clicks; the agent cannot trigger it. 1-user-per-company means real users still need to invite teammates (In-House Team / invite links) before messaging is useful; live prod DB is separate so workspace test users Sarah/Tom are NOT on live.

**Dev/prod DB split (discovered):** the **live site has its OWN production database** — proven: workspace-created user Tom gets 401 on `www.sitesort.co.uk` while seed user Paul gets 200. Workspace test data does NOT appear on live; the user develops against the **workspace preview**. After source edits the **workspace :8080 holds the OLD bundle in memory** until restarted: `pnpm --filter @workspace/api-server run build` (also builds frontend → `dist/public`), `pkill -f dist/index.mjs`, then `PORT=8080 node dist/index.mjs` via `run_in_background`.

**Follow-up polish (same session):** (1) **invoice message card** now always shows an **"Open invoice"** button (deep-links `/invoices?invoice=<id>` → viewer auto-opens then `replaceState`s the param away) — previously only a "View document" link appeared, and only when the invoice had a file, so file-less shared invoices had no way to open. (2) **conversation/channel list previews** no longer render blank for attachment-only messages — backend `messages.ts`/`channels.ts` now return a typed label (`🧾 Invoice` / `📄 Document` / `📷 Photo` / `📋 Permit`) via `messagePreview()`/`channelPreview()` when `content` is empty. Both verified in-browser; typecheck green.

**Messaging enhancements (same day):** (1) **full date+time tooltip** on every message timestamp — `fullTimestamp()` ("Thu, 18 Jun 2026, 16:08") in the `title` attr; the visible label stays relative ("9m ago"). (2) **"Save to notes"** StickyNote action on each DM message → `POST /api/users/:otherId/notes` with body `"{sender} · {fullTimestamp}\n{text}"`, landing in that contact's In-House Team **Notes & Reminders** log (`messageText()` labels attachment-only msgs). DM-only (channels have no single contact); `isCancelled`-guarded. Verified across **desktop/tablet/mobile** (all 3 "versions") + functional note-creation; zero console errors. Messaging confirmed working on all 3 viewports.

---

## End-of-session notes — 2026-06-18 session 5 (Feature #57: multi-company membership + company switcher) — FULL DETAIL

**Why:** "Add Team Member" rejected an email already registered to ANOTHER company ("Email already registered"). Root cause: `users.email` is globally UNIQUE and each user has ONE `company_id` + role (baked into the JWT, used by 178 `companyId` refs across 21 files). User chose (AskUserQuestion): full membership model + one-login in-app switcher + **role per company**.

**Model:** new **`company_members`** table (`id, userId, companyId, role`, unique(userId,companyId), cascade). `users.companyId`/`role` kept as the user's **home** company; `company_members` is the source of truth for "who's in company X" and "role in X". Backfilled one membership per existing user. **JWT shape unchanged** (`{id, companyId, role, email}` = ACTIVE company) so all 178 refs keep working — only the value's provenance changed.

**Backend** (`artifacts/api-server/src`):
- `lib/memberships.ts` — `getMemberships`, `membershipRole`, `addMembership`, `resolveActiveCompany`.
- `routes/auth.ts` — login resolves active company (home if still a member, else first) + returns `memberships`; **`POST /auth/switch-company`** re-issues a token for another membership (403 if not a member); `/auth/me` returns `companyId/role` from the token (active) + `memberships`; register & sub-invite create a home membership.
- `routes/users.ts` — **`POST /users` LINKS an existing email** via `addMembership` (+ in-app notification) instead of erroring; new emails create user+membership+invite. `GET /users`, PATCH (role→membership; name/phone→home-company only), notes IDOR → membership-aware.
- `routes/messages.ts` (recipient/broadcast/messageable) + `routes/billing.ts` (company admins) → membership joins, not `usersTable.companyId`.

**Frontend** (`artifacts/sitesort/src`): `components/company-switcher.tsx` (sidebar dropdown, hidden for single-company users, `/auth/switch-company` → save token → full reload) wired into `sidebar-layout.tsx` (desktop + mobile menu); team page add-member shows a green linked/invited success message + `already_member` handling.

**Verified** (rebuilt :8080): link existing→201 `linked:true`; re-add→400 `already_member`; switch-company→new token, 403 for non-member; messageable/team lists correctly change per active company; **Dean shows `project_manager` in Test SiteSort but `admin` in his home co → role-per-company proven**. Browser: switcher renders + switches on **desktop/tablet/mobile**, zero console errors. **Test data:** linked Tom→Acme (multi-co test acct); seeded **Dean (linked, PM) + Annabelle (new user, pw `password123`) into Amy's Test SiteSort** so the user can test 4-way messaging.

**⚠️ DEPLOY SAFETY (critical — prod DB is SEPARATE):** proved again that **live has its own DB** (workspace-created Annabelle/Tom → 401 on live). `drizzle push` is NOT part of the deploy, so the new code would query a non-existent `company_members` on prod and **break live login**. Mitigations added so publishing is safe: (1) **`lib/ensure-schema.ts`** — idempotent boot migration (`CREATE TABLE IF NOT EXISTS company_members` + backfill `INSERT … SELECT FROM users ON CONFLICT DO NOTHING`) run from `index.ts` via `ensureSchema().finally(() => app.listen(...))` (uses exported `pool.query`; verified in boot log: "company_members table ready + backfilled"). (2) **`getMemberships` falls back** to the user's home company if the table query throws, so login never breaks even if the migration fails. **Pattern for future schema changes: add them to `ensureSchema` (or another boot migration) so prod gets them on deploy — pushing to the workspace DB does NOT migrate prod.**

**✅ DEPLOYED LIVE + verified 2026-06-18.** Published; live bundle `index-DmqLDOUV.js` has the switcher. Confirmed on `www.sitesort.co.uk`: boot migration created+backfilled `company_members` on the prod DB (proof: `POST /auth/switch-company` returns 200 — that path queries the table directly), and login/`/users`/`/messages/users` all 200. User added `dean.parrish@me.com` (linked) + `annabelleparrish@icloud.com` (new) to their real company (Amy/`amy-parrish@hotmail.co.uk` admin) via live In-House Team UI — **both show in the team list**, confirming the link-existing-user path works in production. Agent CANNOT verify a user's private live company (no prod creds; only demo `paul@acme.com`) — user self-confirmed in-app.

**Follow-up polish:** DM **conversation list** + **channel sender chips** now show the person's **per-company (membership) role**, not their home role — `messages.ts` conversations `userMap` and `channels.ts` sender `userMap` now `leftJoin company_members` on the active `companyId` (was `usersTable.role`). Verified: Dean shows "Project Manager" in Test SiteSort (his membership role) instead of "Admin" (his home role). **✅ DEPLOYED LIVE 2026-06-19.** Re-verified before publish (workspace API `:8080`: `/messages/conversations` returns Sarah Jones as `project_manager` — membership-derived, not home admin; typecheck clean; Messages page renders zero console errors). Pushed to GitHub mirror (`main → be303d27`). Post-deploy live health check passed: `/messages/conversations` + `/messages/users` (both use the `company_members` join) return **200, no 500s** on `www.sitesort.co.uk`.

**Dean role-per-company verification (2026-06-19, workspace DB):** Proved both sides of the chip for `dean.parrish@me.com` (home company = "Test SiteSort 2", home role `admin`). (1) **PM side:** logged in as Annabelle (`annabelleparrish@icloud.com` / `password123`, site_worker in "Test SiteSort") → `/messages/conversations` shows Dean's chip as **`project_manager`** (his membership role there), NOT his home `admin`. (2) **Admin side:** Dean is the *only* member of "Test SiteSort 2", so temporarily added Annabelle as a member (one `company_members` INSERT with `gen_random_uuid()` for `id` — the table has NO id default), switched her into TS2 via `/auth/switch-company`, `/messages/users` showed Dean as **`admin`**, then DELETED the temp row (restored TS2 to just Dean). Same person, two companies, two roles → confirmed via the real API path (the same `company_members` join the chips use). **Live confirmed at deploy level only** (user opted for this — no Dean prod creds): all three membership-join paths return correctly — `/messages/conversations` 200, `/messages/users` 200, `/auth/switch-company` **403** (direct `company_members` query rejecting a non-member = query runs, not a 500). Same code as workspace, so live behaves identically.

---

## End-of-session notes — 2026-06-19 (mobile/tablet responsiveness audit — overflow + date-input hardening)

Systematic audit (4 parallel agents over all 22 pages) + fixes. Feature parity was already solid (tables all have mobile card counterparts; messages master-detail; grids mostly collapse). Real issues were overflow/sizing, mostly **date/select inputs in grid cells**.

- **Shared components (cascade fix):** `ui/input.tsx` + `ui/textarea.tsx` now carry `min-w-0 max-w-full box-border` — the guard that stops `type="date"` inputs blowing out of flex/grid (iOS Safari intrinsic-width issue). Covers every Input app-wide.
- **Date/time/select-in-grid:** added `[&>*]:min-w-0` to grid containers (+ `min-w-0 max-w-full` on native `<select>`s) in projects/index (create-project + permit dates), projects/detail (permit dates, schedule times, milestone title), invoices (currency select + due-date), subcontractors (reliability select), checkins (project filter). **Pattern to reuse:** `grid ... [&>*]:min-w-0` makes every cell flex/grid-safe.
- **Stat grids collapsing:** `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` on subcontractors/issues/checkins summary cards.
- **Text overflow:** messages channel header got `min-w-0 flex-1` + `truncate`.
- **Admin tables:** 24 dead `table-cell` no-op classes → `hidden md:table-cell`; verified consistent across header/skeleton/body.
- **Verified in-browser at 375/768/1280** against rebuilt bundle on `:8080`: 10 pages × 3 breakpoints = zero horizontal page overflow, zero console errors. New Invoice dialog (date + currency select in grid) and Add Permit dialog (Start/Expiry date range) both fit cleanly at 375px.
- **Auth + landing final pass:** Audited all 6 auth/landing pages at 320/375/768/1280 — confirmed clean, NO changes needed.
- **Create-project date dialog verified** via temporarily setting Acme `beta_access=true` (reversible trick to bypass plan cap on demo account); restored to `false` after.
- **✅ DEPLOYED LIVE + verified 2026-06-19.** Pushed to GitHub mirror (`main → ae38da0a`, signatures verified). Live bundle `index-DmGZWGzO.js`. Re-ran live check on `www.sitesort.co.uk` at 375/768/1280: zero horizontal overflow, zero console errors across all pages.

---

## Migrated from CLAUDE.md (2026-06-23 session 3)

- **2026-06-18 (session 5):** Feature #57 multi-company membership + company switcher. ✅ DEPLOYED.
- **2026-06-18 (session 4):** Messaging 500-fix (`=ANY()`→`inArray`), invoice Open/previews/timestamps/save-to-notes. ✅ DEPLOYED.

## More migrated from CLAUDE.md (2026-06-23 session 3 wrap)

- **2026-06-19 (session 3):** Bare-icon → labeled-pill UI consistency pass on `projects/detail.tsx` (Open/History/Edit/Share/Notes pills across Documents, Finances, Overview notes, Check-ins, Team). ✅ DEPLOYED.
- **2026-06-19 (session 2):** Responsiveness fixes in source: `index.css` box-sizing + date/select constraints; `subcontractors` grids `[&>*]:min-w-0`; Site Issues stat cards `grid-cols-1 lg:grid-cols-3`; `landing` pricing single-col at tablet; Site Check-Ins added to sidebar nav. ✅ DEPLOYED.
- **2026-06-19:** Mobile/tablet responsiveness audit — overflow + date-input hardening, `min-w-0` cascade on shared Input/Textarea, admin tables `hidden md:table-cell`. ✅ DEPLOYED.
- **2026-06-19:** Per-company role chips on DM conversations + channel sender chips. ✅ DEPLOYED.

## 2026-06-28 session detail (archived 2026-06-29)

- **F4: group MS/Permit/Safety under one H&S tab (DEPLOYED `9e6417e2`):** Frontend-only (`projects/detail.tsx`). "Compliance" tab → **"H&S"** (value kept `permits` so `?tab=permits` deep links work); heading → "Health & Safety". Lumped doc list split into 3 by-type sections (Method Statements / Permit Documents / Safety Documents), each w/ count + Upload. Permits/Team Insurance/Share Log + Documents tab unchanged.
- **F3: alphabetical drawing revisions (DEPLOYED `0078a6de`):** Editable drawing **revision label** (Rev A/B/C…) + history view. `documents.revision` (ensure-schema). `documents.ts`: `versionToRevision()` (base-26) auto-assigns next letter for drawings (explicit wins; non-drawings null); PATCH accepts `revision`; tenant-scoped **`GET /documents/:id/revisions`** walks the supersede chain. `revision` on Document+UploadDocumentRequest (codegen). FE `docRev()` "Rev X"; revision input on upload+edit; "Revisions" dialog.
- **F2: project close-out / handover (DEPLOYED `2e4459d8`):** Manager-gated **"Close-out" tab**. Append-only **`project_closeouts`** (ensure-schema). **`routes/closeout.ts`:** `GET /projects/:id/closeout` → 4 readiness checks (snags, insurance, expired permits, pending sign-offs) + record; `POST` reuses doc sign-off **PIN mechanism** (bcrypt + `pin-attempts` lockout), writes audit + `status=complete` (one txn); `POST .../reopen` → active (audit kept). Manager-only, tenant-scoped. FE: checklist + PIN dialog (+ JIT PIN setup, handover note) + completed state w/ Re-open. Raw fetch.
- **F1 Phase 3: insurance cert accountability (DEPLOYED `f62ec479`):** Subcontractor insurance gets `assigned_to_user_id`+`due_date` (ensure-schema); `serializeInsuranceRecords` adds assignee id/name + dueDate + derived `overdue`; status via shared `expiry.ts` in subcontractors.ts+team.ts; tenant-scoped IDOR-safe **`PATCH /subcontractors/:id/insurance/:recordId`**. Contacts directory: assignee + due-by + **OVERDUE** + "Insurance Accountability" dialog.
- **"Check your email" screen UX (Feature #60 follow-up; DEPLOYED):** `register.tsx`: spam/"not spam" guidance; **rate-limited resend** (45s frontend countdown + 30s per-email throttle `resendThrottled()` in `/auth/resend-verification`); **"Wrong email? Go back and edit"**. Pushed `a98f5b26`.
- **2026-06-24 — F1 Phase 2 (permits accountability + expiry consolidation):** DEPLOYED + pushed (`main → 998c2bad`). `permits.due_date`, shared **`expiry.ts`** helper, `PATCH /api/permits/:id` Edit dialog + OVERDUE UI.
- **2026-07-11 (later) — PROD 502-on-login FIX + hardening (DEPLOYED+prod-verified):** Root cause = the pg `Pool` (`lib/db`) had **no `'error'` listener**, so a dropped idle connection surfaced as an unhandled EventEmitter error → **process crashed → Replit restart → intermittent 502**. **Fixes:** `pool.on('error')` + timeouts + `checkDbConnection()` (`lib/db`); process-level `unhandledRejection`/`uncaughtException` (log + stay-alive) + startup DB check + `ensureSchema` timeout + `0.0.0.0` bind (`index.ts`); global Express error handler + **JSON 404 for unmatched `/api/*`** (was SPA-html 200) + **real `GET /api/health`** (DB probe → 200/503) (`app.ts`/`health.ts`). Prod-verified post-Publish: `/api/health` 200 db:up, `/api/*` JSON 404, login 200.
