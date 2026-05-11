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
