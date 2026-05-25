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
