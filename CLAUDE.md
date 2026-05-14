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

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Session Log

### 2026-05-14

#### Tasks completed
- **Settings page** (`/settings`) — fully built out; replaces the placeholder; four tabs:
  - **Profile** — edit name and phone; email shown read-only; avatar initial auto-updates on save
  - **Security** — change password (requires current password; client-side validation before submit)
  - **Notifications** — toggle in-app toast and browser OS notifications (stored in localStorage); handles denied/unsupported OS permission states gracefully
  - **Company** (admin only) — edit company name and size; shows subscription tier/status badges

#### New API endpoints (`artifacts/api-server/src/routes/auth.ts`)
- `PATCH /api/auth/me` — update own name/phone
- `POST /api/auth/change-password` — change password with current-password verification
- `GET /api/companies/mine` — get own company info
- `PATCH /api/companies/mine` — update company name/size (admin role required)

#### Key files added/modified
- `artifacts/sitesort/src/pages/settings/index.tsx` — new settings page (Profile / Security / Notifications / Company tabs)
- `artifacts/api-server/src/routes/auth.ts` — four new endpoints appended
- `artifacts/sitesort/src/App.tsx` — `/settings` route now uses `SettingsPage` component

#### Notes for next session
- Settings notification toggles are stored in localStorage; the sidebar poller does not yet read these flags — it always fires toasts/OS notifications regardless. Wire `NOTIF_TOAST_KEY` / `NOTIF_OS_KEY` checks into `sidebar-layout.tsx` to honour the preferences
- Messages page: no deletion or editing yet
- Settings page is complete — the only remaining major placeholder is none; consider adding an avatar upload to the Profile tab (upload API already exists)

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
