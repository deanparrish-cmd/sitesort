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
25. Read-only mode on cancellation — persistent red banner on all authenticated pages; "New Project" button redirects to billing when cancelled; `SubscriptionContext` exposes `isCancelled` app-wide
26. Global voice command navigation — mic button in sidebar and desktop header bar; Web Speech API listens for commands like "go to projects" / "open compliance" / "new project"; floating hint overlay with examples; toast feedback on match or no-match; hidden on unsupported browsers; "new project" / "create project" / "add project" navigates to `/projects?new=1` which auto-opens the create modal (or redirects to billing if cancelled)

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22 (continued)

#### Tasks completed
- **Global voice command navigation** — mic button added to sidebar (below nav items) and desktop header bar (between bell and user avatar); uses Web Speech API (`SpeechRecognition`); listens for navigation commands and routes accordingly
- **Command matching** — strips natural-language prefixes ("go to", "navigate to", "open", "show me", etc.) then matches against a command map covering all 11 nav destinations; also handles aliases (e.g. "home" → dashboard, "insurance" → compliance, "chat" → messages, "billing" → settings?tab=billing)
- **UX feedback** — floating dark hint overlay appears at screen bottom when listening with example phrases; toast confirms successful navigation or shows "not recognised" error; button pulses orange with bouncing audio bars while active; hidden on unsupported browsers (Firefox)

#### Key files modified
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — `Mic`/`MicOff` icons, `voiceSupported` check, `VOICE_COMMANDS` map, `startVoiceCommand`/`stopVoiceCommand`/`toggleVoiceCommand` callbacks, Voice Command button in sidebar, mic icon in desktop header, floating hint overlay

#### Tasks completed (continued)
- **"New project" voice command** — saying "new project", "create project", or "add project" navigates to `/projects?new=1`; projects page detects param on mount and opens the create modal, or redirects to `/settings?tab=billing` if subscription is cancelled; hint overlay updated to show "new project" as the first example

#### Key files modified (continued)
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — added `new project`/`create project`/`add project` entries to `VOICE_COMMANDS`; updated hint overlay example text
- `artifacts/sitesort/src/pages/projects/index.tsx` — `useEffect` reads `?new=1` param on mount, strips it from history, then opens modal or redirects to billing

#### Notes for next session
- Only project creation is blocked client-side on cancellation — other write actions (edit project, upload docs, etc.) are not yet restricted
- File storage is still ephemeral (Replit filesystem) — R2/S3 migration needed for production
- No message search or pagination yet

### 2026-05-21

#### Tasks completed
- **Billing tab in Settings** — new "Billing" tab added to `/settings`; displays three pricing cards (Solo/Team/Pro) and initiates a Stripe Checkout session on click
- **Stripe integration** — `@stripe/stripe-js` and `stripe` SDK installed; `POST /api/billing/checkout` endpoint creates a Stripe Checkout session in subscription mode; redirects to Stripe-hosted checkout; success/cancel redirect back to `/settings?checkout=success|cancelled`
- **Three subscription plans**:
  - **Solo** — £29/month, 1 project
  - **Team** — £79/month, up to 5 projects
  - **Pro** — £149/month, unlimited projects
- **14-day free trial** — all plans configured with `trial_period_days: 14`; payment method collected upfront; trial auto-cancels if no payment method on file at trial end
- **Checkout success/cancel feedback** — settings page reads `?checkout=` query param on load and shows appropriate UI state

#### New/updated API endpoints
- `POST /api/billing/checkout` — creates a Stripe Checkout session for the selected plan (`solo`|`team`|`pro`); requires auth; returns `{ url }` for redirect

#### Key files added/modified
- `artifacts/api-server/src/routes/billing.ts` — new billing route with PLANS config and Stripe session creation
- `artifacts/api-server/src/routes/index.ts` — billing router registered
- `artifacts/sitesort/src/pages/settings/index.tsx` — Billing tab with pricing grid and checkout flow
- `package.json` / `pnpm-lock.yaml` — `stripe` and `@stripe/stripe-js` dependencies added

#### Notes for next session (after billing tab)
- `STRIPE_SECRET_KEY` env var must be set for checkout to work; currently returns 500 if missing
- No upgrade/downgrade flow between plans; users can only initiate a new checkout

### 2026-05-22

#### Tasks completed
- **Stripe webhook handler** — `POST /api/billing/webhook` added; verifies Stripe signature when `STRIPE_WEBHOOK_SECRET` is set (skips verification in dev if unset); handles three events:
  - `checkout.session.completed` — fetches the resulting subscription and writes tier + status to the companies table
  - `customer.subscription.updated` — syncs status changes (trialing → active, active → past_due, etc.) and plan tier
  - `customer.subscription.deleted` — resets company to `subscriptionTier: free`, `subscriptionStatus: cancelled`
- **Raw body middleware** — `express.raw({ type: 'application/json' })` registered for `/api/billing/webhook` before `express.json()` so Stripe signature verification receives the unmodified body

#### Key files modified
- `artifacts/api-server/src/routes/billing.ts` — webhook handler + `mapSubscriptionStatus` / `handleSubscriptionUpsert` / `handleSubscriptionDeleted` helpers
- `artifacts/api-server/src/app.ts` — raw body middleware for webhook route

#### Notes for next session (after webhook)
- Set `STRIPE_WEBHOOK_SECRET` env var (from Stripe Dashboard → Webhooks → signing secret) to enable signature verification in production
- Events to subscribe to in Stripe Dashboard: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- No upgrade/downgrade flow yet — users can only initiate a new checkout; switching plans would need a Stripe portal or custom flow

### 2026-05-22 (continued)

#### Tasks completed
- **Project creation gating** — `POST /projects` checks the company's plan before inserting; limits: `free`/`solo` = 1 project, `team` = 5, `pro` = unlimited, `cancelled` = 1 regardless of tier; returns `403 { error: "plan_limit" }` with a human-readable message if over limit
- **Upgrade dialog on projects page** — when `POST /projects` returns a `plan_limit` 403, the create modal closes and a dedicated "Project limit reached" dialog appears with an "Upgrade plan" button that navigates to `/settings?tab=billing`
- **Billing tab current-plan display** — billing tab in settings now fetches `/api/companies/mine` on mount; active plan card is highlighted green with a "Current plan" badge and disabled button; status banner at the top shows subscription status (trial active / past due warning)
- **`?tab=` URL param in Settings** — `SettingsPage` initialises `activeTab` from `?tab=` query param, so the upgrade dialog link (`/settings?tab=billing`) opens directly to the Billing tab

#### Key files modified
- `artifacts/api-server/src/routes/projects.ts` — `planProjectLimit()` helper + limit check in `POST /projects`
- `artifacts/sitesort/src/pages/projects/index.tsx` — `plan_limit` error detection, upgrade dialog, removed stale `DialogContent` import
- `artifacts/sitesort/src/pages/settings/index.tsx` — company fetch in `BillingTab`, current-plan highlighting, `?tab=` init

#### Notes for next session (after gating)
- Only project count is gated so far — team member count, document uploads, and other per-plan limits are not enforced yet
- Upgrade dialog is intentionally simple — could be enhanced to show current usage (e.g. "2 of 5 projects used")

### 2026-05-22 (continued)

#### Tasks completed
- **Stripe Customer Portal** — users can now self-serve cancel, swap plans, update payment method, and download invoices
- **`stripeCustomerId` column** — added to `companies` table (`stripe_customer_id`, nullable); schema pushed to DB; `handleSubscriptionUpsert` in webhook now saves `subscription.customer` to this column on every subscription event
- **`POST /api/billing/portal`** — creates a Stripe Billing Portal session using the stored `stripeCustomerId`; falls back to `stripe.customers.list({ email })` lookup if not yet set; returns to `/settings?tab=billing` after the user exits the portal
- **"Manage subscription" button** — appears in the billing tab status banner when on an active/trialing plan; calls the portal endpoint and redirects

#### DB schema changes
- `companies` table: added `stripe_customer_id` column

#### Key files modified
- `lib/db/src/schema/companies.ts` — `stripeCustomerId` column added
- `artifacts/api-server/src/routes/billing.ts` — `POST /api/billing/portal` endpoint; `stripeCustomerId` saved in `handleSubscriptionUpsert`
- `artifacts/sitesort/src/pages/settings/index.tsx` — `ManageSubscriptionButton` component + rendered in billing status banner

#### Notes for next session (after portal)
- Stripe Customer Portal must be activated in Stripe Dashboard → Settings → Billing → Customer portal before the portal URL will work
- Only project count is gated — team member limits, read-only mode on cancellation, and other per-plan gates are not yet enforced

### 2026-05-22 (continued)

#### Tasks completed
- **Trial-ending notification** — `customer.subscription.trial_will_end` webhook event handled; fires 3 days before trial ends; creates a `trial_ending` notification for every admin in the company with the exact end date and a link to billing settings
- **Notifications page — billing support** — `trial_ending` type added: orange `CreditCard` icon, orange background, clicks through to `/settings?tab=billing`; new **Billing** filter tab on the notifications page isolates billing notifications

#### Key files modified
- `artifacts/api-server/src/routes/billing.ts` — `handleTrialWillEnd()` helper + `customer.subscription.trial_will_end` case in webhook switch; imports `usersTable`, `notificationsTable`, `generateId`
- `artifacts/sitesort/src/pages/notifications/index.tsx` — `trial_ending` icon/bg/link, `billing` filter tab

#### Stripe webhook events now handled
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`

#### Notes for next session (after trial notification)
- Add `customer.subscription.trial_will_end` to the Stripe Dashboard webhook event list
- Only project count is gated — read-only mode on cancellation and other per-plan limits not yet enforced
- Messages page still has no editing or deletion

### 2026-05-22 (continued)

#### Tasks completed
- **Payment-failure notification** — `invoice.payment_failed` webhook event handled; looks up company by `stripeCustomerId` (invoice objects don't carry `companyId` in metadata); creates a `payment_failed` notification for every admin prompting them to update their payment method
- **Notifications page — payment_failed type** — red `CreditCard` icon, red background, clicks through to `/settings?tab=billing`; Billing filter tab now catches both `trial_ending` and `payment_failed`

#### Key files modified
- `artifacts/api-server/src/routes/billing.ts` — `handlePaymentFailed()` helper + `invoice.payment_failed` case in webhook switch
- `artifacts/sitesort/src/pages/notifications/index.tsx` — `payment_failed` icon/bg/link, Billing filter updated

#### Stripe webhook events now handled (full list)
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.payment_failed`

#### Notes for next session (after payment failure)
- Add all five webhook events to Stripe Dashboard → Webhooks → event list
- Only project count is gated — read-only mode on cancellation not yet enforced
- File storage is still ephemeral (Replit filesystem) — R2/S3 migration needed for production

### 2026-05-22 (continued)

#### Tasks completed
- **Message editing** — own message bubbles show a pencil icon on hover; clicking opens an inline input pre-filled with current content; Enter saves, Escape cancels; edited messages show a faint `(edited)` label; backed by `PATCH /api/messages/:id`
- **Message deletion** — trash icon on hover shows an inline "Delete this message? Yes / No" confirm; confirmed deletes remove the message from the thread and refresh the conversation list; backed by `DELETE /api/messages/:id`
- **`editedAt` column** — added to `messages` table and pushed to DB; returned in thread API response

#### DB schema changes
- `messages` table: added `edited_at` column

#### New API endpoints
- `PATCH /api/messages/:id` — edit own message content; sets `editedAt`; 404 if not found or not sender
- `DELETE /api/messages/:id` — delete own message; 404 if not found or not sender

#### Key files modified
- `lib/db/src/schema/messages.ts` — `editedAt` column added
- `artifacts/api-server/src/routes/messages.ts` — PATCH + DELETE endpoints; `editedAt` in thread response
- `artifacts/sitesort/src/pages/messages/index.tsx` — hover actions, inline edit input, inline delete confirm, `(edited)` label

#### Notes for next session
- Only project count is gated — read-only mode on cancellation not yet enforced
- File storage is still ephemeral (Replit filesystem) — R2/S3 migration needed for production
- No message search or pagination yet

### 2026-05-22 (continued)

#### Tasks completed
- **Read-only mode on cancellation** — when `subscriptionStatus === "cancelled"`, a persistent red banner appears at the top of every authenticated page: "Your subscription has ended — new projects and edits are restricted." with an "Upgrade now" button → `/settings?tab=billing`
- **`SubscriptionContext`** — new React context (`artifacts/sitesort/src/contexts/subscription.tsx`) fetches `/api/companies/mine` on mount (only when a JWT token exists) and exposes `{ tier, status, isCancelled, isLoading }` to the whole app
- **Project creation blocked on cancel** — "New Project" button in `/projects` redirects to `/settings?tab=billing` instead of opening the create modal when `isCancelled` is true
- **`SubscriptionProvider` wraps app** — added to `App.tsx` around the router so all pages have access to subscription state without prop-drilling

#### Key files added/modified
- `artifacts/sitesort/src/contexts/subscription.tsx` — new file; `SubscriptionProvider` + `useSubscription()` hook
- `artifacts/sitesort/src/App.tsx` — `SubscriptionProvider` wrapping the router
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — imports `useSubscription`, `AlertCircle`; renders red cancellation banner; `authHeaders()` typed as `Record<string, string>`
- `artifacts/sitesort/src/pages/projects/index.tsx` — `isCancelled` gate on "New Project" button

#### Notes for next session
- Only project creation is blocked client-side on cancellation — other write actions (edit project, upload docs, etc.) are not yet restricted
- File storage is still ephemeral (Replit filesystem) — R2/S3 migration needed for production
- No message search or pagination yet

### 2026-05-14

#### Tasks completed
- **Settings page** (`/settings`) — fully built out; replaces the placeholder; four tabs:
  - **Profile** — edit name, phone, and avatar photo; email shown read-only
  - **Security** — change password (requires current password; client-side validation before submit)
  - **Notifications** — toggle in-app toast and browser OS notifications (stored in localStorage); handles denied/unsupported OS permission states gracefully
  - **Company** (admin only) — edit company name and size; shows subscription tier/status badges
- **Notification toggles wired** — sidebar poller checks `sitesort_notif_toast` and `sitesort_notif_os` localStorage keys before firing; both default to enabled
- **Document supersedes selector** — upload form shows optional "Supersedes" dropdown of current docs of the same type; API accepts `supersededDocumentId`, falls back to same-name auto-supersede if omitted
- **Avatar upload** — Profile tab has a hover camera overlay on the avatar circle and a "Change photo" link; uploads via `POST /api/upload` then patches `avatarUrl` on the user; sidebar shows uploaded photo in all three avatar spots
- **"Share" label** — added text label next to the Share icon on document rows (projects), compliance certificates, and invoice attachments
- **Document status/version editing** — Edit button on every document row opens a dialog to change status (current/superseded) and version number; backed by new `PATCH /api/documents/:documentId`

#### New/updated API endpoints
- `PATCH /api/auth/me` — update name, phone, avatarUrl
- `POST /api/auth/change-password` — change password with current-password verification
- `GET /api/companies/mine` — get own company info
- `PATCH /api/companies/mine` — update company name/size (admin only)
- `PATCH /api/documents/:documentId` — update document status and/or version

#### Key files added/modified
- `artifacts/sitesort/src/pages/settings/index.tsx` — settings page (all four tabs + avatar upload)
- `artifacts/sitesort/src/App.tsx` — `/settings` route wired to `SettingsPage`
- `artifacts/api-server/src/routes/auth.ts` — profile/password/company endpoints; `avatarUrl` in GET+PATCH responses
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — notification pref gates; `Avatar` component; avatar shown in all three spots
- `artifacts/sitesort/src/pages/projects/detail.tsx` — supersedes dropdown, Edit doc dialog, Share label
- `artifacts/sitesort/src/pages/compliance/index.tsx` — Share label on certificate rows
- `artifacts/sitesort/src/pages/invoices/index.tsx` — Share label on attachment rows
- `artifacts/api-server/src/routes/documents.ts` — `supersededDocumentId` in POST; new PATCH endpoint

#### Notes for next session
- Messages page: no deletion or editing yet
- Notifications page only shows `new_message`, `document_uploaded`, and `safety_concern` types — any new notification types need a matching icon/filter in `notifications/index.tsx`
- Uploaded files (avatars, attachments) are stored on the Replit filesystem — ephemeral on full restart; consider migrating to object storage (R2/S3)

### 2026-05-13

#### Tasks completed
- **Notifications page** (`/notifications`) — built out from placeholder; filter tabs (All, Unread, Messages, Documents, Safety) each with count badge; per-type icons (blue message, indigo document, amber safety); unread items highlighted; click marks as read and navigates to related entity; "Mark all as read" button; bell badge in sidebar clears on visit
- **Invoice file attachments** — added `attachment_url` column to `invoices` DB table (schema pushed); `PATCH /api/invoices/:id` now accepts `attachmentUrl`; per-row drag-and-drop with global overlay naming the target invoice; click-to-upload fallback (paperclip button); spinner while uploading; Open link, Share dropdown (Email/WhatsApp pre-filled), and remove button on rows with attachments
- **Open/Share on project documents** — Documents tab in project detail now has Open link and Email/WhatsApp share dropdown on every document row; share message pre-filled with doc name and version
- **Open/Share on compliance insurance certificates** — compliance API extended to return `certificateUrl` per insurance record; certificate rows now show Open icon + Share dropdown when a certificate is present
- **Fixed file serving** — uploads were 404-ing because Replit routes `/uploads/*` to the Vite server, not Express; fixed by serving uploads at `/api/uploads/` (guaranteed to reach Express), updating the upload endpoint, and rewriting legacy URLs in all frontend share/open helpers

#### DB schema changes
- `invoices` table: added `attachment_url` column

#### Key files added/modified
- `artifacts/sitesort/src/pages/notifications/index.tsx` — new notifications page
- `artifacts/sitesort/src/pages/invoices/index.tsx` — drag-and-drop attachment, open/share
- `artifacts/sitesort/src/pages/compliance/index.tsx` — open/share on insurance certificate rows
- `artifacts/sitesort/src/pages/projects/detail.tsx` — open/share on document rows
- `artifacts/api-server/src/routes/compliance.ts` — added `certificateUrl` to expiring insurance response
- `artifacts/api-server/src/routes/invoices.ts` — PATCH accepts `attachmentUrl`
- `artifacts/api-server/src/routes/upload.ts` — returns `/api/uploads/…` URLs
- `artifacts/api-server/src/app.ts` — serves `/api/uploads` static path
- `artifacts/sitesort/vite.config.ts` — proxy `/uploads` to API server (belt-and-braces)
- `artifacts/sitesort/src/App.tsx` — notifications route wired up
- `lib/db/src/schema/invoices.ts` — `attachmentUrl` column added

#### Notes for next session
- Uploaded files are stored on the Replit filesystem (`artifacts/api-server/uploads/`) — they are **ephemeral** and will be lost on a full Repl restart. Consider migrating to object storage (e.g. Cloudflare R2, AWS S3) for persistence
- Messages page: no deletion or editing yet
- Settings page (`/settings`) is still a placeholder
- Notifications page only shows `new_message`, `document_uploaded`, and `safety_concern` types — any new notification types added to the API should have a matching icon/filter added to `notifications/index.tsx`
- Consider adding file/image attachment support to messages (upload API already exists at `POST /api/upload`)

## Session Log

### 2026-05-11

#### Tasks completed
- Drag-and-drop file upload on compliance page — global drag overlay, `dragCounter` ref for accurate enter/leave tracking, per-row insurance targets that pre-fill subcontractor, paste support, post-drop modal (subcontractor select, insurance type, expiry date), saves via `POST /api/subcontractors/:id/insurance`
- Team messaging (`/messages`) — new `messages` DB table, full CRUD API (`/api/messages/*`), two-panel chat UI with conversation list + threaded view, 5-second polling, unread badge on Messages nav item
- Message notifications — server creates a `notifications` row on every sent message; sidebar polls unread count every 10s, fires toast and browser OS notification when count increases; bell icon shows live unread count

#### New DB tables
- `messages` (id, companyId, senderId, recipientId, content, readAt, createdAt)

#### Key files added/modified
- `lib/db/src/schema/messages.ts` — new messages table
- `artifacts/api-server/src/routes/messages.ts` — conversations, thread, send, users, unread-count endpoints
- `artifacts/sitesort/src/pages/messages/index.tsx` — chat UI
- `artifacts/sitesort/src/pages/compliance/index.tsx` — drag-and-drop upload (full rewrite)
- `artifacts/sitesort/src/components/layout/sidebar-layout.tsx` — live unread badge, bell count, message poller

#### Known pre-existing issues (not introduced this session)
- `lib/api-zod/src/index.ts` has two duplicate-export TS errors (`ListDocumentsParams`, `ListPhotosParams`) — pre-existing, does not affect runtime
- Several `buttonVariants` and `queryKey` TS errors in `projects/detail.tsx` and UI components — pre-existing

#### Notes for next session
- Notifications page (`/notifications`) is still a placeholder — could build it out to list all notification types (messages, compliance alerts, document distributions) with mark-read actions
- Messages currently poll every 5s (thread) / 10s (sidebar) — could upgrade to WebSockets or SSE for true real-time if needed
- No message deletion or editing yet
- Consider adding file/image attachment support to messages (upload API already exists at `POST /api/upload`)
- Subcontractor `notes` column was added to DB this session — confirm it is visible in all subcontractor list/detail API responses

### 2026-04-07
- Landing page visual polish session (no functional changes)
- All three feature cards (Version Control, Compliance Hub, QR Site Boards) changed to dark grey (`bg-gray-800`, `border-gray-700`) with white headings and `text-gray-300` body text
- All three feature card icons changed to `text-orange-500` / `bg-orange-500/20`
- "site information" hero gradient updated to `from-orange-800 to-orange-400` (dark-to-light orange)
- Accent button variant updated to match: `bg-gradient-to-r from-orange-800 to-orange-400`
- Removed the "Built for Construction SMEs" animated badge from the hero
- Added "Built for Construction SMEs." as bold text inline below the hero paragraph
- `logo-concepts.html` added to `public/` (5 SVG logo concepts) — untracked, included in this commit
- Note: `index.css` ring colour was nudged to `24 100% 50%` (pure safety orange) in the committed base

### 2026-03-26
- Built and completed all 10 core features of the SiteSort platform
- Added `scripts/src/github-setup.ts` to create the GitHub repo via Replit Connectors SDK
- Added `scripts/src/github-push.ts` to push workspace files to GitHub via the GitHub Contents API (owner: `deanparrish-cmd`, repo: `sitesort`)
- Confirmed GitHub push mechanism works without a personal access token (uses Replit OAuth connector)
