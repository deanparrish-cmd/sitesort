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
29. Invoice document viewer — full-screen inline viewer panel; PDF via iframe, image via img tag, fallback open-in-tab; sidebar with invoice details; header actions: open in new tab, share, mark paid
30. Project detail report / PDF export — "Export Report" button generates a print-ready HTML report (team, permits, documents, finances, photos) and auto-triggers browser Save-as-PDF
31. Subcontractor "Add to Project" — FolderPlus button on each sub card opens a dialog listing active projects; one-click add with inline per-project feedback (added/already linked/error)
32. Enforced subcontractor directory-first workflow — removed "Add Person" form and dialog from the project Team tab; contacts must be added to the subcontractor directory first, then linked into a project via "Add from Subcontractor Directory"
33. Broadcast messaging — "New" button in Messages opens a three-mode picker: Individual (1-to-1), By Role (filter project members by Admin/PM/Site Worker/Subcontractor), All in Project; backend `POST /api/messages/broadcast` sends message + notification per recipient
34. Landing page pricing section — "Start Free Trial" smooth-scrolls to Solo £29/Team £79/Pro £149 plan cards; Book Demo button removed
35. Invoice sharing in messages — Receipt button in compose bar opens an invoice picker; selected invoice renders as a card in the thread (counterparty, amount, status badge, due date, PDF link); `invoiceId` nullable column on messages table; `content` defaults to `""` to allow invoice-only messages
36. Document, photo, and permit sharing in messages — Paperclip button in compose bar opens a tabbed picker (Document / Photo / Permit) with a project selector; selected item shown as a violet chip; thread renders typed cards: document (name, type, version, view link), photo (thumbnail, category, reference), permit (type, description, expiry status badge); `attachmentType` + `attachmentId` columns on messages table; API thread endpoint batch-fetches attachment data
37. Project channel group messaging — each active project gets a shared `#channel` thread visible to all project members; appears above DMs in sidebar with blue `#` icon and unread badge; full attachment support (doc/photo/permit cards); sender name + role chip on every message; edit/delete own messages; 5s polling; notifications to all project members on send; `channel_messages` + `channel_reads` tables; `GET/POST /api/channels/:projectId/messages`, `PATCH/DELETE /api/channel-messages/:id`

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-22 & 2026-05-25 — see CLAUDE_ARCHIVE.md for full detail

### 2026-05-26

#### Tasks completed
- **Message reactions** — emoji reactions on both DMs and project channel messages:
  - Hover any message → 😊 button appears in the action row; clicking opens an inline emoji picker (👍 ✅ 👀 ❤️ 😂)
  - Reactions displayed as pill badges (emoji + count) below the bubble; your own reactions are highlighted in primary colour
  - Clicking an existing reaction pill toggles it (remove if already reacted, add if not)
  - Works identically in DM threads and channel threads
  - Schema: `message_reactions` + `channel_message_reactions` tables, each with unique constraint on (messageId/channelMessageId, userId, emoji) and cascade-on-delete
  - API: `POST /api/messages/:id/react` and `POST /api/channel-messages/:id/react` — toggle and return updated grouped reactions
  - Thread endpoints now batch-fetch reactions and embed as `reactions: Array<{emoji, count, mine}>` on each message

#### Key files added/modified
- `lib/db/src/schema/message_reactions.ts` — new table
- `lib/db/src/schema/channel_message_reactions.ts` — new table
- `lib/db/src/schema/index.ts` — exports new tables
- `artifacts/api-server/src/routes/messages.ts` — imports `messageReactionsTable`; reactions batch-fetched in thread endpoint; `POST /api/messages/:id/react` toggle endpoint
- `artifacts/api-server/src/routes/channels.ts` — same pattern for channel messages; `POST /api/channel-messages/:id/react`
- `artifacts/sitesort/src/pages/messages/index.tsx` — `Reaction` type; `emojiPickerId` state; `toggleReaction` / `toggleChannelReaction` functions; reactions row + emoji picker UI in both DM and channel thread renders; reaction button also available to non-own messages (not just own)

- **Reply-to-message (WhatsApp-style quote)** — hover any message → ↩ button appears; clicking sets a "Replying to" bar above compose with dismiss X; sending attaches `replyToId`; thread renders quoted block (sender name + content preview, left-border accent) above the reply bubble; works in DMs and channels; falls back to `[document/photo/permit]` for attachment-only quoted messages
  - Schema: `replyToId` nullable column on `messages` and `channel_messages` tables (no new tables)
  - API: thread endpoints batch-fetch quoted messages and embed `replyTo: {id, senderName, content, attachmentType}`; POST endpoints accept `replyToId`

#### Key files modified (reply-to)
- `lib/db/src/schema/messages.ts` — added `replyToId` column
- `lib/db/src/schema/channel_messages.ts` — added `replyToId` column
- `artifacts/api-server/src/routes/messages.ts` — batch-fetch quoted messages in thread; `replyTo` in response; accept `replyToId` on POST
- `artifacts/api-server/src/routes/channels.ts` — same for channels
- `artifacts/sitesort/src/pages/messages/index.tsx` — `ReplyTo` type; `replyingTo` state; reply button in hover actions; quote bubble in thread; reply-to bar above compose; `CornerUpLeft` icon

- **Message search** — debounced (300ms) search input in the sidebar; while active, replaces conversation list with grouped results (Direct Messages / Channel Messages); each result shows sender, channel/conversation name, timestamp, and the matched snippet with the term **highlighted in yellow**; clicking opens that conversation or channel; X clears back to normal view
  - API: `GET /api/messages/search?q=` (ILIKE, respects viewAll permissions, min 2 chars, max 30 results); `GET /api/channels/search?q=` (filters to accessible projects by role)

#### Key files modified (search)
- `artifacts/api-server/src/routes/messages.ts` — added `GET /api/messages/search`
- `artifacts/api-server/src/routes/channels.ts` — added `GET /api/channels/search`
- `artifacts/sitesort/src/pages/messages/index.tsx` — `DmSearchResult` / `ChannelSearchResult` types; `searchQuery/searchDms/searchChannels/searchLoading` state; debounce effect; search input in sidebar header; grouped results panel

- **Quick reply templates** — ⚡ Zap button in both DM and channel compose bars opens an inline panel with 18 construction site templates across 4 categories: Acknowledge, Status, Requests, Safety; clicking a template inserts it into the draft (doesn't auto-send) so user can edit; panel closes on selection or conversation switch; no DB changes

#### Key files modified (quick replies)
- `artifacts/sitesort/src/pages/messages/index.tsx` — `QUICK_REPLIES` constant; `quickReplyOpen` state; Zap button + template panel in both compose bars

## End-of-session notes — 2026-05-26

### All tasks completed today

1. **Message reactions** — 👍 ✅ 👀 ❤️ 😂 on DMs and channel messages; toggle via hover picker; pill badges with count; `message_reactions` + `channel_message_reactions` tables
2. **Reply-to-message** — WhatsApp-style quote bubble; `replyToId` column on both message tables; reply bar above compose; works in DMs and channels
3. **Message search** — debounced sidebar search across DMs and channels; yellow-highlighted snippets; grouped results; `GET /api/messages/search` + `GET /api/channels/search`
4. **Quick reply templates** — 18 site-specific templates in 4 categories; ⚡ Zap button in compose bar; inserts into draft for editing before send

### Notes for next session
- **Good next features**: message pagination (currently loads entire thread), read receipts per-message in DMs, push notifications (PWA), project progress tracking / Gantt view
- **Stripe still needs manual setup**: activate Customer Portal in Stripe Dashboard; register all 5 webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`)
- **When adding new DB schema files**: always run `npx tsc -p tsconfig.json` inside `lib/db/` after editing `src/schema/index.ts` to regenerate `dist/` before typechecking api-server
- All commits are on `main`; push via `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`

## End-of-session notes — 2026-05-25

### All tasks completed today (across 5 sessions)

1. **Cancellation enforcement** — all write actions across every page (projects, project detail, subcontractors, messages, invoices, settings) check `isCancelled` and return early with a destructive toast or inline `StatusBanner`
2. **Landing page** — removed Book Demo button; "Start Free Trial" smooth-scrolls to new `#pricing` section (Solo £29 / Team £79 / Pro £149); fixed bullet alignment on dark feature cards
3. **Broadcast messaging** — three-mode picker (Individual / By Role / All in Project); backend `POST /api/messages/broadcast`
4. **Invoice sharing in messages** — Receipt button, invoice picker, invoice card in thread; `invoiceId` + `content` default schema changes
5. **Document / photo / permit sharing in messages** — Paperclip picker with tabbed project selector; typed attachment cards in thread; `attachmentType` + `attachmentId` schema columns
6. **Project channel group messaging** — `#ProjectName` shared threads for all project members; full attachment support; unread counts; notifications; `channel_messages` + `channel_reads` tables

### Fixes applied
- Fixed pre-existing `authHeaders()` TypeScript return-type error in messages page (`{ Authorization: string } | {}` → `Record<string, string>`)
- Fixed `lib/db` composite project stale `.d.ts` cache blocking api-server typecheck of new schema exports — resolved by running `npx tsc -p tsconfig.json` in `lib/db/`

### Known pre-existing issues (not introduced today)
- TypeScript errors in `alert-dialog.tsx`, `calendar.tsx`, `command.tsx`, `pagination.tsx` (missing `buttonVariants` / `DialogContent` exports), `dashboard/index.tsx`, `projects/detail.tsx`, and Drizzle ORM `eq()` overload errors across api-server routes — none affect runtime
- `lib/api-zod` duplicate export error (`ListDocumentsParams`, `ListPhotosParams`) blocks root `pnpm typecheck` but does not affect the app

### Notes for next session
- **Good next messaging features**: reply-to-a-specific-message (WhatsApp-style quote), quick-reply templates for site workers, message search
- **Stripe still needs manual setup**: activate Customer Portal in Stripe Dashboard; register all 5 webhook events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_failed`)
- **When adding new DB schema files**: always run `npx tsc -p tsconfig.json` inside `lib/db/` after editing `src/schema/index.ts` to regenerate `dist/` before typechecking api-server
- All commits are on `main`; push via `/home/runner/workspace/scripts/node_modules/.bin/tsx scripts/src/github-push.ts`
