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

There is no git remote pointing to GitHub. Pushes go through the Replit GitHub connector (no token needed) to `deanparrish-cmd/sitesort` via the GitHub Git Data API. Run scripts with `pnpm --filter @workspace/scripts exec tsx ./src/<name>.ts` (plain `npx tsx` fails — tsx only lives in `scripts/node_modules`).

**USE `scripts/src/push-robust.ts`** — `pnpm --filter @workspace/scripts exec tsx ./src/push-robust.ts`. The old `github-push.ts` is **BROKEN: it never checks HTTP status, so failures are silent** (it prints "Done!" even when nothing pushed — this left the repo EMPTY for a long time). `push-robust.ts` fixes it: bounded concurrency (6) + retries, status checks at every step, and it skips files whose base64 payload would exceed the proxy's **~1MB body limit** (nginx 413).

Three gotchas push-robust handles (learned 2026-06-18):
1. **Empty repo** → the Git Data API (blobs/trees) returns 409 "Git Repository is empty". You must seed ONE commit via the **Contents API** first (`scripts/src/bootstrap-repo.ts` — `PUT /contents/README.md`). Only needed once, when the repo has zero commits.
2. **Proxy ~1MB limit** → files >~650KB raw (auth-bg.png, hero PNGs, attached_assets) get HTTP 413 and are **skipped** (logged). Large binary assets do NOT push — code/text all pushes fine.
3. **Junk dirs** → `.config/chromium` crash dumps (from the browser-check skill) choke blob creation; push-robust ignores `.config`/`.npm`/`tmp` etc.
4. Pushes use **`base_tree` (additive)** — files removed locally are NOT deleted from GitHub. After a push, verify with `scripts/src/verify-push.ts` (checks signature strings of changed files on `main`).

To create the repo fresh: `pnpm --filter @workspace/scripts exec tsx ./src/github-setup.ts`

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
8. Permit management (active/expiring/expired, responsible persons, certificate file attachment, Open Certificate button)
9. Compliance Centre (aggregate view across projects, drag-and-drop certificate upload)
10. Team management (admin/project_manager/site_worker/subcontractor roles)
11. Subcontractor cards — call/email/SMS/WhatsApp action buttons, visible contact details, trade badges, notes field
12. Add subcontractors from company directory into individual projects
13. Full compliance page (was placeholder) — expiring insurance/permits, pending sign-offs, drag-and-drop file upload
14. Full team page (was placeholder) — members grouped by role, last-active
15. Team messaging — direct messages between team members, two-panel chat UI, 5s polling, unread badges
16. Message notifications — toast + OS notification on new message, live badge on sidebar/bell, manager "View All" oversight mode
17. Notifications page (`/notifications`) — filter tabs, per-type icons, click-to-read, mark-all-read
18. Invoice file attachments — drag-and-drop upload per invoice row, `attachmentUrl` column, Open/Email/WhatsApp share
19. Document & certificate sharing — Open + Email/WhatsApp share on project documents and compliance insurance certs
20. Settings page (`/settings`) — Profile/Security/Notifications/Company tabs; `PATCH /auth/me`, `POST /auth/change-password`, `GET/PATCH /companies/mine`
21. Document supersedes selector — upload form dropdown of same-type docs; marks selected one superseded on save; `supersededDocumentId`
22. Document status/version editing — Edit dialog changes status/version; `PATCH /api/documents/:documentId`
23. Subscription billing — Stripe Checkout (Solo £29/Team £79/Pro £149, 14-day trial), webhook sync, Customer Portal, plan-based project limits
24. Read-only mode on cancellation — persistent red banner + write actions blocked app-wide; `SubscriptionContext.isCancelled`
25. Real user dashboard — greeting, quick-actions, 4-stat cards, "Needs Attention" panel, activity feed, site calendar
26. Invoice document viewer — full-screen panel, PDF/image view, open/share/mark-paid actions
27. Project detail report / PDF export — "Export Report" generates a print-ready HTML report, auto-triggers Save-as-PDF
28. Subcontractor "Add to Project" — dialog listing active projects, one-click add with per-project feedback
29. Enforced subcontractor directory-first workflow — contacts must be in the directory first, then linked into a project
30. Broadcast messaging — Individual/By Role/All-in-Project picker; `POST /api/messages/broadcast`
31. Landing page pricing section — smooth-scrolls to Solo/Team/Pro plan cards
32. Invoice sharing in messages — Receipt button picker; invoice card in thread; `invoiceId` nullable column on messages
33. Document/photo/permit sharing in messages — Paperclip tabbed picker; typed attachment cards in thread; `attachmentType`+`attachmentId` columns
34. Project channel group messaging — shared `#channel` thread per project, attachments, edit/delete own messages, 5s polling; `channel_messages`+`channel_reads` tables
35. Message enhancements — emoji reactions, reply-quote bubbles, debounced search, 18 quick-reply templates
36. Subcontractor invite links — unique link per sub, share modal, `?invite=<token>` tailored register form
37. Beta access flag — `companies.betaAccess` bypasses all Stripe checks
38. Project progress tracking — `milestones` table + CRUD; `progressPercent` computed; Progress tab w/ checklist + Gantt timeline
39. Onboarding checklist — dismissible dashboard card, 5 real-data-derived steps, `GET /api/onboarding/status`
40. DM read receipts — grey ✓/blue ✓✓ ticks; `?after=` poll includes `readUpdates` for live flip
41. Admin beta access UI — company table + toggle switch; `GET/PATCH /api/admin/companies[/:id/beta-access]`
42. Email notifications — `users.emailNotifications` toggle; Resend emails for DMs/channel messages/permit expiry
43. QR site board check-in with date-stamped photo — Canvas API stamps name/date/project onto photo; `site_checkins` table; `POST /api/site/:token/checkin`
44. QR board pin management — managers pin docs/photos/permits to the QR board; `qr_board_pins` table; "Board Contents"/"Pinned to this Board" panels
45. Subcontractor notes/reminders log — append-only `subcontractor_notes`, tenant-scoped, General or project-specific
46. Invoice project organisation — invoices link to a project after marking paid, unlinkable, reversible
47. Superseded document archiving — `archivedAt` on `insurance_records`+`permits`, auto-archives same-type on re-upload
48. Site Issues log — `status`+`resolvedAt` on `photos`; `GET /api/issues`; moved into each project by #53
49. Password visibility toggle — Eye/EyeOff on all password fields (login/register/invite flow)
50. Mobile/tablet UX hardening — check-in camera capture fix; overflow/scroll fixes across 6 pages
51. Site Check-Ins page (`/checkins`) — company-wide check-in log, search/filter, 3-stat header, detail modal
52. In House Team enhancements — contact action buttons, Notes & Reminders dialog, "Add Team Member" invite flow
53. Site Issues moved to each project — Site Issues tab on project detail; full share details via `additionalInfo` prop
54. Project overview daily notes Open/Share — ExternalLink detail dialog + Share2 ShareModal; `shareText` prop for text-only shares
55. Mobile/tablet responsive fixes — scrollable filter/nav tabs, breakpoint-tuned "View Site" button visibility
56. Site Calendar deep-links + custom events — `calendar_events` table + CRUD; QR site board returns `upcomingEvents`
58. Dashboard outstanding-invoices widget — top-5 unpaid/overdue card w/ Open/Share/Mark-Paid
59. Multi-threshold expiry email reminders — permits/insurance certs email at 30/21/14/7/1 days then daily post-expiry; `expiry_reminder_logs` de-dup table
60. Real email verification on registration — `emailVerified:false`+token, no JWT until verified; gated login
61. **Team Portal** — invite-based per-project member access + activity audit (restructured per-person → **#63**; gated visibility → **#65**). **DEPLOYED+prod-verified.** *(full detail in CLAUDE_ARCHIVE.md)*
62. **Daily Site Reports hub (F5)** — company-wide `/daily-reports` page + editable structured site diary (voice-to-text), immutable 18:00 auto snapshot + editable `manager_report` jsonb. **DEPLOYED+prod-verified.** *(full detail in CLAUDE_ARCHIVE.md)*
63. **Per-person Team Portal invites — portal-only for everyone** — new `people` table (one row/human); ONE invite path `POST /projects/:id/portal-invites {personId}`. **DEPLOYED+prod-verified.** *(full detail in CLAUDE_ARCHIVE.md)*
64. **Deep-links for actionable/to-do items** — shared `<LinkRow>`, controlled tabs, filtered `?param` deep-links across dashboard/compliance/invoices/issues/checkins/messages. Frontend-only. **DEPLOYED+prod-verified.** *(full detail in CLAUDE_ARCHIVE.md)*
65. **Team Portal sharing (all/trade/individual) + gated portal visibility** — PM shares Document/Photo/Permit via `ShareModal` (Everyone/trade(s)/individual(s)); `portal_shares` rule table gates all portal doc sections (safety stays open-to-all). **DEPLOYED+prod-verified** (16/16 e2e). *(full detail in git history)*
66. **Real invite emails (Resend) + existing-account portal join** — invites auto-send via Resend; cross-company invitee joins with existing login; `DELETE /subcontractors/:id` + orphan cleanup. **DEPLOYED+prod-verified** (9/9 e2e). *(full detail in git history)*
67. **Portal session policy + logo nav** — server-side `portal_sessions` (sliding-30d expiry + server-logout). **DEPLOYED+prod-verified** (12h-inactivity design superseded by #72's 30-day policy). *(full detail in CLAUDE_ARCHIVE.md)*
68. **Portal freshness + unseen badges + Web Push** — own RQ client w/ 60s poll; `GET /portal/unseen` nav badges; VAPID Web Push w/ iOS install-chaining. **DEPLOYED+prod-verified** (VAPID secrets confirmed 2026-07-17). *(full detail in CLAUDE_ARCHIVE.md)*
69. **F6 — subbie/merchant contact documents** — versioned docs on a subcontractor/merchant contact (`subcontractor_documents` table, company-wide or per-project, auto-supersede chain). **DEPLOYED+prod-verified** (2026-07-17). *(full detail in CLAUDE_ARCHIVE.md)*
70. **Notification alert-viewer (Next/Previous)** — clicking a notification opens a shared `<AlertViewer>` dialog instead of navigating away (Previous/Next, keyboard/swipe, marks-read-on-view). **DEPLOYED+prod-verified** (2026-07-17).
71. **Remove people from projects + archive/hard-delete contacts + first/last name split** — manager-gated remove-from-project (history intact); `archivedAt` soft-delete w/ hard-delete only if zero footprint; nullable `firstName`/`lastName` split. **DEPLOYED+prod-verified** (2026-07-17). *(full detail in CLAUDE_ARCHIVE.md)*
72. **Portal-audit fixes + contractor self-upload docs + mobile/PWA** — off-workflow commit reconciled 2026-07-19: 30-day portal session policy, drawing zip download-all, contractor "My documents" self-upload w/ manager approve/reject, upload-serving hardened against stored-XSS, PWA install card. **Confirmed live**. *(full detail in CLAUDE_ARCHIVE.md)*
73. **Plant & Materials tracking + site-issue closure reasons** — `plant_items` tables track on-site plant/equipment/materials w/ Allocate distribution flow; Site Issues gained closure reasons + `canLogIssues` permission. **DEPLOYED+prod-verified** (2026-07-19, `main → 5dc2e6e8`). *(full detail in CLAUDE_ARCHIVE.md)*
74. **Person-first contacts: self-employed + certifications + Team tab restructure** — every subcontractor has a real linked primary-contact `people` row; new `self_employed` contact type; person-level certifications; Team tab restructured person-first. **DEPLOYED+prod-verified** (2026-07-19, `main → 2f19a511`). *(full detail in CLAUDE_ARCHIVE.md)*
75. **Daily Report in the Team Portal + shared dictation button + plant attachment counts** — portal members see today's site diary, gated on `canEditDailyReport` (superseded by #77); dashboard/portal share `lib/daily-reports.ts`; `DictationButton` extracted for reuse. **DEPLOYED+prod-verified** (2026-07-19, `main → 395419ce`). *(full detail in CLAUDE_ARCHIVE.md)*
76. **Team Portal Messages — project-scoped DMs, channel access, PM oversight** — extends dashboard messaging into the portal; `messages.project_id` gives the same two people a separate thread per project; channel messages + project-scoped DMs made immutable (no edit/delete); PM oversight view gained a `?projectId=` filter. **DEPLOYED+prod-verified** (2026-07-19, `main → 0579fbb2`). *(full detail in CLAUDE_ARCHIVE.md)*
77. **Minimal-by-default Team Portal + retired doc tabs into a filtered Shared with me** — a brand-new portal member now sees ONLY Overview/Messages/Shared with me/Progress/Team/Site Board/My documents/Settings; Site Issues, Plant & Materials, and Daily Report are absent (not greyed) from nav until the PM grants the matching permission (`canLogIssues`/`canUpdatePlantMaterials`/`canEditDailyReport` — write-only before, `requirePortalPermission` now gates GET too, `canLogIssues` defaults `false`). H&S/Drawings/Method Statements/Permits/Safety/General retired as standalone nav tabs, folded into a filtered "Shared with me" (category-chip filter; #65's `portal_shares` gating unchanged underneath). **DEPLOYED+prod-verified** (2026-07-20, `main → 91d6d53c`). *(full detail in CLAUDE_ARCHIVE.md)*
78. **Site issue archive/restore + individual photo removal + admin hard delete** — closed a real gap (no way to remove a photo/site-issue at all): managers can `DELETE /photos/:photoId` to archive (soft-delete, restorable via `PATCH .../restore`, "Archived" toggle on Issues tab) or `DELETE /photos/:photoId/photo` to remove just the image (URL hidden, never erased); admin-allowlisted `DELETE /admin/photos/:photoId` hard-deletes via a new Admin Danger Zone widget for genuine test data. **DEPLOYED** (2026-07-20, `main → 63c2a744`). *(full detail in CLAUDE_ARCHIVE.md)*
79. **Fix stale mirrored contact name on Team tab + portal-invite surname gate** — `people.name/firstName/lastName` is a copy-on-write mirror of `subcontractors.contactName` synced only when `is_primary_contact` matches, which could silently drift stale (showed the company name instead of the person's, and blocked the portal-invite surname check despite a real surname on file). New `lib/person-name.ts` (`canonicalPersonName`) resolves display name from the canonical subcontractor fields at read time (Team tab, portal-invite gate, `/portal/team`); `ensure-schema.ts` gained a self-healing boot migration that re-syncs and logs any drifted rows. **DEPLOYED, user-confirmed fixed** (2026-07-20, `main → 63c2a744`). *(full detail in CLAUDE_ARCHIVE.md)*
80. **Fix uncaught chunk-load crash after a deploy (invite-accept set-password page)** — a stale-loaded bundle's lazy-route chunk 404'd after a Publish rotated the hashed filenames, crashing a brand-new portal member's post-signup redirect straight into the error boundary with no recovery. `lazyWithRetry()` in `App.tsx` wraps every lazy route with one automatic `sessionStorage`-guarded reload-and-self-heal; `error-boundary.tsx`'s "Try again" also force-reloads on a chunk-load-shaped error. **DEPLOYED** (2026-07-20, `main → cc5916b1`). *(full detail in CLAUDE_ARCHIVE.md)*
81. **Inline portal-permission toggles on Team tab cards** — moved the 3 permission checkboxes (Site Issues/Plant & Materials/Daily Report) from a dropdown onto the card as always-visible pills (`PermissionTogglePill` in `portal-people.tsx`); presentational only, no permission-model change. **DEPLOYED+prod-verified** (2026-07-21). *(full detail in CLAUDE_ARCHIVE.md)*
82. **Portal access controls follow-up: card layout, whole-login revoke, invite parity** — the "Portal member" pill IS the whole-login on/off (confirm dialog, kills sessions immediately, cancels invites); confirmed one invite-creation path so email/share-link invites can never drift out of parity. **DEPLOYED+prod-verified** (2026-07-21). *(full detail in CLAUDE_ARCHIVE.md)*
83. **Portal permission card row order + pre-accept permission parity + full functional verification** — fixed `portalStatusFor` not surfacing permission columns for pending "invited" status (root cause of #82's inconsistent toggles), plus 2 related edge cases (accept-endpoint duplicate-row risk, revoke-orphan risk). 18/18 functional verification locally + against `www.sitesort.co.uk`. **DEPLOYED+prod-verified** (2026-07-21). *(full detail in CLAUDE_ARCHIVE.md)*
84. **Platform Admin restriction (`users.platformAdmin`)** — SiteSort's own internal-staff flag, distinct from `role` (a customer's admin/pm/worker role within their own company); gates the whole `/admin` section server-side (`requireAdmin` re-checks the DB on every request, not the JWT) and in the sidebar nav. Seeded Dean/Amy once; an Admin-section "Platform Admins" table (search + toggle) now manages the list going forward — no more hardcoded email allowlist. Self-revoke blocked. **DEPLOYED** (committed under `898f8f0`'s checkpoint, confirmed 2026-07-23 — see session log): `typecheck` clean, `check:layout` 96/96. Not yet prod-verified live.
85. **Portal "Log a new item" for Plant & Materials** — members with `canUpdatePlantMaterials` can create a brand-new plant/equipment or materials entry directly from the portal (`POST /api/portal/plant-materials`), not just edit existing items; creates live immediately (no draft stage) and notifies the project's managers. **DEPLOYED** (committed under `898f8f0`'s checkpoint, confirmed 2026-07-23): `typecheck` clean, `check:layout` 96/96. Not yet prod-verified live.
86. **PIN-based document sign-off (Pending Sign-offs, dashboard + portal)** — every sign-off (all doc types, not just 3) now requires the signer's hashed 4-digit PIN; portal gained view/acknowledge/pin endpoints as twins of the dashboard's; new `pin_audit_log` table; shared `hooks/use-sign-off-flow.ts` state machine. `typecheck` clean, `check:layout` 96/96, full functional round-trip verified locally (dashboard + portal). **DEPLOYED** (committed under `898f8f0`'s checkpoint despite the prior session log saying "not yet committed" — confirmed 2026-07-23 by checking the schema/route files directly against git history). Not yet prod-verified live. *(full detail in CLAUDE_ARCHIVE.md)*

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- Express serves uploads at **both** `/uploads` (legacy) and `/api/uploads` (`artifacts/api-server/src/app.ts`)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use
- Vite proxy for `/uploads` was also added (`artifacts/sitesort/vite.config.ts`) as a belt-and-braces measure, but the `/api/uploads` path is the reliable one

## Key Architecture Notes

**⚠️ Schema changes → `ensure-schema.ts` (CRITICAL):** Prod DB is separate from workspace. `drizzle push` does NOT migrate prod. All new tables/columns MUST be added to **`lib/ensure-schema.ts`** (idempotent boot migration run from `index.ts` before `app.listen`) or prod will query a non-existent table and break login. **Pattern for ALL future schema changes.**

**`company_members` model (Feature #57):** `company_members` table (`id, userId, companyId, role`, unique(userId,companyId), cascade) is the source of truth for "who's in company X" and role in X". `users.companyId`/`role` = home company only. JWT `{id, companyId, role, email}` = ACTIVE company (shape unchanged). Switch via `POST /auth/switch-company` (403 if not a member). `POST /users` links an existing email instead of erroring. Helpers in `lib/memberships.ts`. `company_members` INSERTs need explicit `id` (`gen_random_uuid()`) — table has NO id default.

**Mobile responsive patterns:** `grid ... [&>*]:min-w-0` makes every grid cell flex/grid-safe (prevents iOS date input overflow). `hidden md:table-cell` for responsive table columns (not `table-cell` which is a no-op). `ui/input.tsx` + `ui/textarea.tsx` carry `min-w-0 max-w-full box-border` globally. `index.css` has global CSS `min-width:0; max-width:100%; width:100%; box-sizing:border-box` on `input[type="date/time/datetime-local"]` and `select`. Use `lg:grid-cols-N` (not `sm:`) for stat-card grids inside the app shell (sidebar takes 256px leaving ~512px at md, so sm/md breakpoints fire too early for 3-col layouts). Shared layout components: `ui/page-header.tsx` (`<PageHeader>` — title/description/actions, stacks below `sm`) and `ui/list-row.tsx` (`<ListRow>`/`<PillGroup>`/`<Pill>` — content+actions row, stacks below `sm`, pills wrap).

**⚠️ Layout gate (CRITICAL — responsive regression sweep #2, 2026-07-17):** Hand-rolled `flex items-center justify-between` headers/rows (no `flex-wrap`/`flex-col sm:flex-row`) caused action buttons to squash against titles and status pills to overlap text on mobile in H&S, Finances & Expiry, and Site Check-ins (all fixed). **After any UI change, run `pnpm run check:layout` (defaults to 360px+768px against a locally built `:8080`; add `LAYOUT_VIEWPORTS=360,390,768,1024` for a fuller pass) — all routes must pass before finishing.** It renders every page + project-detail tab + portal section and fails on horizontal overflow or a `data-ll="pill"`/`data-ll="actionbar"` element overlapping another. **New pages/rows use `<PageHeader>` and `<ListRow>`/`<Pill>` — never hand-roll a title+actions or content+actions layout.** Script never reads the shared `APP_URL` env var (it points at prod in this workspace) — it only targets `localhost` and refuses to run otherwise, since it writes test fixture data (a portal person + invite) through the API.

**Test accounts:** `paul@acme.com` / `password123` (demo, Acme Construction, Free Plan — project-capped). `annabelleparrish@icloud.com` / `password123` (site_worker, "Test SiteSort"). Tip: `beta_access=true` on demo company bypasses plan cap for testing gated UI.

## Session Log

Full session-by-session detail in CLAUDE_ARCHIVE.md. Recent sessions (newest first):
- **2026-07-21 (4) — resumed an in-progress session (#84/#85 already coded) and shipped #86:** verified #84 (Platform Admin restriction) and #85 (portal "Log a new item" for Plant & Materials), then built **#86** — PIN-based sign-off made universal (dashboard+portal, new `pin_audit_log` table, shared `useSignOffFlow` hook). `typecheck` clean, `check:layout` 96/96, full functional round-trip verified locally. Session ended believing this was "not yet committed" — **corrected 2026-07-23**: all three were in fact already committed and Published that same day, buried under generic checkpoint commit messages (`898f8f0`/`7aed31a`); confirmed by finding `platform_admin`, `pin_audit_log`, and the portal PIN routes already live in `git log`/`ensure-schema.ts` with a clean `typecheck`. **DEPLOYED, not yet prod-verified live.** *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-21 (3) — shipped #83, same-day root-cause fix on top of #82:** fixed pending-invitee permission-toggle parity (`portalStatusFor` wasn't surfacing permission columns for "invited" status) plus 2 related edge cases. 18/18 functional verification locally + against `www.sitesort.co.uk`. Committed `577c796`, Published `3e79327`. **DEPLOYED+prod-verified.** *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-21 (2) — shipped #82, a same-day follow-up to #81:** whole-login revoke via the "Portal member" pill (confirm dialog), badge/pill reordering, confirmed single invite-creation path. Committed `f6ec798`, Published `bb91e29`. **DEPLOYED+prod-verified**, but still had a parity gap fixed same-day by **#83**. *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-21 — shipped #81, the priority carried over from the previous wrap-up:** moved the 3 portal-permission checkboxes (Site Issues/Plant & Materials/Daily Report) from a dropdown onto the card as always-visible pills — presentational only, no permission-model change. Verified locally + against `www.sitesort.co.uk` (grant→200/revoke→403 round-trip). **DEPLOYED+prod-verified.** *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-20 (7) — end-of-session wrap-up:** flagged #81 above as top priority, with the investigation/constraints that guided this session's fix (full detail in CLAUDE_ARCHIVE.md).
- **2026-07-20 (2)–(6) + surname audit:** Shipped **#77** (minimal-by-default Team Portal, incl. a mid-task clarifying question that reconciled the spec with #65/#75), **#78** (site issue archive/restore + admin hard-delete, triggered by a prod cleanup that hit a missing-delete-endpoint gap), **#79** (fixed a stale copy-on-write mirror causing wrong contact names on the Team tab — user-confirmed live), **#80** (fixed a stale-chunk-load crash on the portal invite-accept page via `lazyWithRetry`), plus a bugfix (nullable `reliabilityRating` was silently failing the whole subcontractor-edit validation and misreporting as a name-length error) and a surname-data audit (found 3 legacy empty-surname records, reported not auto-fixed; closed the validation gap that let them get created). All deployed via Replit Publish (checkpoint commits sweeping in ahead of Claude's own `git commit` — now the established pattern) and pushed to GitHub (final push `main → 28468471`); #77 and #79 prod-verified against real data. *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-19:** Built and shipped **#73** (Plant & Materials tracking + issue closure reasons), **#74** (person-first contacts: self-employed + certifications + Team tab restructure), **#75** (Daily Report in Team Portal + shared dictation + plant attachment counts), **#76** (Team Portal Messages: project-scoped DMs, channel access, PM oversight). All committed, pushed, Published, and prod-verified same day; `check:layout` 96/96. *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-17:** Responsive sweep #2 (shared `<PageHeader>`/`<ListRow>` components + `pnpm run check:layout` Playwright audit, 176/176 passed, published+prod-verified); #70/#71 alert-viewer + remove-people/archive/name-split (published+prod-verified); F6 contact documents #69 (published+prod-verified); #68 Web Push follow-up closed out on prod (Android/iPhone push test still outstanding). *(full detail in CLAUDE_ARCHIVE.md)*
- **2026-07-15 and earlier:** see feature list above + CLAUDE_ARCHIVE.md.
- **PD test backlog**: **F7** Site Board on-site count, **F8** Timeline link, **F9/F10** spikes. **Opportunity:** uptime monitor on `GET /api/health`.
- **Infra facts:** GitHub push ≠ deploy; prod = Replit **Publish**. Apex+`www` → `34.111.179.208`. Workspace Stripe env is **LIVE** (`sk_live`). Verify via `.claude/skills/browser-check`; rollout lags ~1-3 min.
