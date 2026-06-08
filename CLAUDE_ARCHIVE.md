# SiteSort – Session Log Archive

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
