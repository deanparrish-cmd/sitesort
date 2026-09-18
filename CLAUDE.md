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
pnpm run check:layout                            # Local-only responsive route sweep
pnpm run validate                                # Required pre-finish typecheck + layout gate
pnpm --filter @workspace/api-spec run codegen  # Regenerate API client + Zod schemas
pnpm --filter @workspace/db run push           # Push DB schema changes
```

## Pushing to GitHub

There is no git remote pointing to GitHub. Pushes go through the Replit GitHub connector (no token needed) to `deanparrish-cmd/sitesort` via the GitHub Git Data API. Run scripts with `pnpm --filter @workspace/scripts exec tsx ./src/<name>.ts` (plain `npx tsx` fails — tsx only lives in `scripts/node_modules`).

**PREFER `scripts/src/push-delta.ts [ref]`** (2026-09-18): uploads ONLY files whose blob SHA differs from GitHub `main` (10 to 30 files, seconds, tiny rate-limit footprint). Fall back to `push-robust.ts` (re-uploads the whole workspace, 1000+ blobs, aborts under rate limiting). **`github-push.ts` is BROKEN (never checks HTTP status, silently "succeeds" while pushing nothing).** `push-robust.ts` fixes it: bounded concurrency (6) + retries, status checks at every step, and it skips files whose base64 payload would exceed the proxy's **~1MB body limit** (nginx 413).

Gotchas push-robust handles (learned 2026-06-18, #5 2026-09-16):
1. **Empty repo** → the Git Data API (blobs/trees) returns 409 "Git Repository is empty". You must seed ONE commit via the **Contents API** first (`scripts/src/bootstrap-repo.ts` — `PUT ... *(full text in CLAUDE_ARCHIVE.md)*
2. **Proxy ~1MB limit** → files >~650KB raw (auth-bg.png, hero PNGs, attached_assets) get HTTP 413 and are **skipped** (logged). Large binary assets do NOT push — code/text all pushes fine.
3. **Junk dirs** → `.config/chromium` crash dumps (from the browser-check skill) choke blob creation; push-robust ignores `.config`/`.npm`/`tmp` etc.
4. Pushes use **`base_tree` (additive)** — files removed locally are NOT deleted from GitHub. After a push, verify with `scripts/src/verify-push.ts` (checks signature strings of changed files on `main`).
5. **Shared GitHub rate limit across concurrent sessions** → 2+ sessions active here share ONE GitHub connector identity/rate-limit budget; a push can outright 403 "API rate limit exceeded" ... *(full text in CLAUDE_ARCHIVE.md)*

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
61. **Team Portal** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
62. **Daily Site Reports hub (F5)** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
63. **Per-person Team Portal invites — portal-only for everyone** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
64. **Deep-links for actionable/to-do items** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
65. **Team Portal sharing (all/trade/individual) + gated portal visibility** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
66. **Real invite emails (Resend) + existing-account portal join** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
67. **Portal session policy + logo nav** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
68. **Portal freshness + unseen badges + Web Push** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
69. **F6 — subbie/merchant contact documents** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
70. **Notification alert-viewer (Next/Previous)** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
71. **Remove people from projects + archive/hard-delete contacts + first/last name split** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
72. **Portal-audit fixes + contractor self-upload docs + mobile/PWA** *(detail in CLAUDE_ARCHIVE.md / git history)*
73. **Plant & Materials tracking + site-issue closure reasons** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
74. **Person-first contacts: self-employed + certifications + Team tab restructure** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
75. **Daily Report in the Team Portal + shared dictation button + plant attachment counts** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
76. **Team Portal Messages — project-scoped DMs, channel access, PM oversight** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
77. **Minimal-by-default Team Portal + retired doc tabs into filtered Shared with me** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
78. **Site issue archive/restore + individual photo removal + admin hard delete** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
79. **Fix stale mirrored contact name on Team tab + portal-invite surname gate** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
80. **Fix uncaught chunk-load crash after a deploy** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
81. **Inline portal-permission toggles on Team tab cards** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
82. **Portal access controls follow-up: card layout, whole-login revoke, invite parity** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
83. **Portal permission card row order + pre-accept permission parity + full functional verification** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
84. **Platform Admin restriction (`users.platformAdmin`)** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
85. **Portal "Log a new item" for Plant & Materials** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
86. **PIN-based document sign-off (Pending Sign-offs, dashboard + portal)** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
87. **Activity-entry deep-links + daily reports join Team Portal sharing** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
88. **Configurable per-document PIN sign-off** *(detail in CLAUDE_ARCHIVE.md / git history)*
89. **Fix dead Overview-tab "Recent Activity" card** *(detail in CLAUDE_ARCHIVE.md / git history)*
90. **Three portal fixes: nav/GET permission gating, explicit site manager, verified submit→view already worked.** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
91. **Document Allocate removed (folded into Share), project-level PM/approver authority added** **DEPLOYED.** *(detail in CLAUDE_ARCHIVE.md / git history)*
92. **In-app User Guide (dashboard, portal, invite email) + restyle** — single shared source `lib/user-guide/src/index.ts`, 3 surfaces. **DEPLOYED+prod-verified** (2026-07-27). *(full detail in CLAUDE_ARCHIVE.md)*
93. **Invoice Allocate + scoped Share (financial-data-safe)** — closed a zero-role-gating gap on `PATCH /invoices/:id`/`POST /share-logs`. **DEPLOYED+prod-verified** (2026-07-27). *(full detail in CLAUDE_ARCHIVE.md)*

94. **Team Portal visual redesign — big/colourful for on-site workers** — portal-only visual redesign: shared `components/portal-ui.tsx` tile/button/pill system, solid-fill status colours, ≥56px tap targets, home quick-access tile grid, CURRENT/SUPERSEDED doc badges. **DEPLOYED+prod-verified** (2026-07-30). *(full detail in CLAUDE_ARCHIVE.md)*

95. **Fix check-in insurance gate vs contact card split-source, and pinned site-board docs not opening** — unified insurance-status logic (`lib/insurance.ts`) so a self-employed contact insured only via a person-level cert passes check-in like they do on the Contacts card; pinned site-board docs now use the same CAD-aware open helper as everywhere else. **DEPLOYED+prod-verified** (2026-07-30). *(full detail in CLAUDE_ARCHIVE.md)*

96. **Portal navigation cleanup — hamburger removed, no duplication** — removed the duplicate hamburger/sidebar nav; consolidated Site Issues/Plant & Materials/Daily Report into one conditional "Site Tasks" tile and Settings/Help/Log out onto a Settings tile. **DEPLOYED+prod-verified** (2026-07-30, `typecheck` clean, `check:layout` 104/104). *(full detail in CLAUDE_ARCHIVE.md)*

97. **Deep-link project alerts, expiry alerts, and overdue invoices to the specific record** — extends `itemDeepLink` to the projects-list "N Alerts" badge, dashboard expiry alerts, and the invoices/dashboard overdue-invoice tiles. **DEPLOYED+prod-verified** (2026-07-30, `main → 2fcca18a`). *(full detail in CLAUDE_ARCHIVE.md)*

98. **Em-dash/en-dash sweep + app-wide dead-badge deep-link audit** — 53 dash instances fixed across 15 user-facing files; audited every count/badge/alert app-wide and fixed 2 more dead badges (Issues status cards, Contacts Insurance Issues/Payment Hold cards). Added standing CLAUDE.md rules for both (see Key Architecture Notes) so neither regresses again. **DEPLOYED+prod-verified** (2026-07-30). *(full detail in CLAUDE_ARCHIVE.md)*

99. **Construction Programme document surfaced on the Progress tab** — "Construction Programme" card (Open/Download, Upload/Replace, link to Documents), reusing existing document upload plumbing; allowlist extended to accept ... *(full text in CLAUDE_ARCHIVE.md)*
100. **Multi-project Team Portal: one login across projects, incl. DIFFERENT companies** — `GET /api/portal/my-projects` + a Home switcher list every project a member belongs to across every company on ONE login; `switch-project` ... *(full text in CLAUDE_ARCHIVE.md)*

101. **Portal project-switcher polish + copy/layout refresh** — built by a concurrent session (`cd91563`..`9c76587`), **reviewed 2026-09-18**: company confirmation on ... *(full text in CLAUDE_ARCHIVE.md)*
102. **On-hire plant stays on dashboard, overdue in red** — new `GET /api/plant-items/on-hire` + dashboard "Plant on hire" card (no date filter; leaves only when marked ... *(full text in CLAUDE_ARCHIVE.md)*
103. **QR site sign-out + live on-site register** — one `site_checkins` row per in/out cycle (`checked_out_at/by`, `checkout_note/method`); public `GET /site/:token/status` + ... *(full text in CLAUDE_ARCHIVE.md)*
104. **Photos inside a daily site report** — `photos.daily_report_date`; `GET/POST /projects/:id/daily-reports/:date/photos`; `DailyReportPhotos` in the report dialog; ... *(full text in CLAUDE_ARCHIVE.md)*
105. **Portal report photos + public on-site count** — `DailyReportPhotos`/`FileDropZone` reused in the portal (today's report editable per the same lock/submitted/privacy ... *(full text in CLAUDE_ARCHIVE.md)*
106. **QR sign-in/out: remembered device, name lookup, near-match, company autocomplete** — `POST /site/:token/checkin` returns a signed per-project `deviceToken` (JWT, 180d, ... *(full text in CLAUDE_ARCHIVE.md)*
107. **Permits-tab "N overdue" pill now deep-links** (closes the standing dead-badge gap) — many overdue permits: filtered list w/ "Show all" banner (folders auto-open); ... *(full text in CLAUDE_ARCHIVE.md)*
108. **Check-in notifications open a detail; identity-linked check-ins; check-in near-match; sign-outs in the feed** — `CheckinNotificationDialog` (dashboard feed + ... *(full text in CLAUDE_ARCHIVE.md)*
109. **Site check-in QR / URL restricted to Admin + Project Manager (enforced server-side)** — `GET/POST/DELETE /projects/:id/qr-codes` now 403 for everyone but company ... *(full text in CLAUDE_ARCHIVE.md)*
110. **Public suggestions show initials only** — 'Did you mean' at check-in AND sign-out now show first name + surname initial + company (`publicLabel` in qr.ts, e.g. "Amy P, ... *(full text in CLAUDE_ARCHIVE.md)*

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

**⚠️ Layout gate (CRITICAL — responsive regression sweep):** Hand-rolled `flex items-center justify-between` headers/rows (no `flex-wrap`/`flex-col sm:flex-row`) caused action buttons to squash against titles and status pills to overlap text on mobile in H&S, Finances & Expiry, and Site Check-ins (all fixed). **After any UI change, run `pnpm run validate` (or at minimum `pnpm run check:layout`) — all routes must pass before finishing.** The route checker discovers `<Route>` entries from `App.tsx`, project-detail tabs from `tab-config.ts`, and portal destinations from the frontend nav/rendering plus the server allowlist. It sweeps **360px, 390px, and 768px** by default (override with `LAYOUT_VIEWPORTS=...`) and fails closed if a dynamic fixture, portal session, or permission grant cannot be created. It fails on document/descendant horizontal overflow, marked pill/action-bar overlap, and stacking hit-test coverage of interactive controls. Every run writes a full per-route report to `reports/layout-check.json` (override with `LAYOUT_REPORT_PATH`). **New pages/rows use `<PageHeader>` and `<ListRow>`/`<Pill>` — never hand-roll a title+actions or content+actions layout.** The script never reads the shared `APP_URL` env var (it points at prod in this workspace) — it only targets `localhost` and refuses to run otherwise, since it writes test fixture data through the API.

**⚠️ Finishing rule (CRITICAL): all UI changes must be verified at 360px AND 768px with no horizontal overflow before finishing.** `pnpm run validate` sweeps routes at 360/390/768, but it does NOT open dialogs, panels that only appear after typing/clicking, or public pages in their interactive states. For any new dialog/panel/banner, also drive it in a browser at 360px and 768px (long names and long company names) and assert `document.documentElement.scrollWidth <= clientWidth`. Recipe: API login, `addInitScript` the token, `page.route('**/api/**')` to `localhost:8080` (Vite does NOT proxy `/api`), then measure.

**No em-dashes or en-dashes in user-facing text (CRITICAL — reintroduced by new features at least once already):** Never use — or – in any user-facing copy: UI labels/badges/empty-states, toasts, emails (including the portal invite email), the in-app User Guide, notifications, validation/error messages shown to a user. Use a comma, a colon, a full stop (split into two sentences), or the word "to" for ranges (e.g. "9 to 5", not "9–5"). This does NOT apply to code comments, CLAUDE.md/CLAUDE_ARCHIVE.md, or dev-facing logs — only text an end user actually reads.

**Every badge/count/alert that names a specific record must deep-link to it (CRITICAL — recurring "dead badge" bug):** Any count, badge, alert, or "Needs Attention" item that refers to a specific record (a document, invoice, permit, issue, etc.) must be tappable and must navigate straight to that record, using the shared `itemDeepLink()` helper (`artifacts/sitesort/src/lib/deep-link.ts`) and/or the `<LinkRow>`/`ListRow` component (`ui/list-row.tsx`) — the same pattern used by the Close-out card and activity-feed entries. When a count spans multiple distinct records, landing on the correctly filtered list view is acceptable; when it's exactly one record, it must open that record directly. Never ship a badge that names a specific thing but isn't clickable. Pure aggregate KPI tiles (total revenue, headcount, % complete) that don't reference an inspectable record are exempt.

**Test accounts:** `paul@acme.com` / `password123` (demo, Acme Construction, Free Plan — project-capped). `annabelleparrish@icloud.com` / `password123` (site_worker, "Test SiteSort"). Tip: `beta_access=true` on demo company bypasses plan cap for testing gated UI.

**In-app User Guide (single shared source):** copy lives in `lib/user-guide/src/index.ts` (`PM_GUIDE`/`WORKER_GUIDE`/`FAQ`) and is read by three surfaces — the dashboard `/user-guide` page (sidebar, under Settings), the portal `/portal/help` page (Help, under Settings — worker section + `workerFaq()` only), and the "Invite to Portal" email excerpt in `artifacts/api-server/src/lib/email.ts` (plus its public, no-login `/guide` page link). If you change a user-facing flow, update the in-app User Guide to match — edit the content module once and all three surfaces stay in sync.

## Session Log

Full session-by-session detail in CLAUDE_ARCHIVE.md. Recent sessions (newest first):
- **2026-09-18 SESSION CLOSE (`main → a0c5d874`, Published `28c2ab5`, tree clean, no WIP branch; all UI verified at 360/768, 22 checks pass):**
  - **Completed:** #101 to #110 (see feature list; #101 = review of 6 unreviewed commits, clean) + new `scripts/src/push-delta.ts`.
  - **Fixes:** overdue plant dropped from weekly report; check-in notifications did nothing on click; QR sign-out mismatch failed silently; one person could show twice on the roll-call; drizzle `sql` template eats `\s` (use `[[:space:]]`); app blank when localStorage blocked; public suggestions leaked full names. Details in CLAUDE_ARCHIVE.md.
  - **New issues discovered / still open:**
    1. **Prod double check-in (Dean Parrish 18:52 and 18:54) NOT confirmed.** I cannot query prod. Most likely a sign-out in between (sign-outs had no feed item, now they do). To confirm: that row's "Out HH:MM" in the Check-Ins tab. If empty, the 409 guard failed on prod and needs that row.
    2. **Prod cause of "Amy" vs "Amy Parrish" not confirmed** (mechanism: contact card name vs its primary-contact person name drift). Rows from before `person_key` have no identity link, so an old duplicate pair stays two until signed out.
    3. **User reported "the QR code has gone" while logged in as admin** (2026-09-18, last message). Unresolved: was it only the portal (intended) or also the admin dashboard Site Board tab / `/qr` page? Locally an admin still sees it with Print/Download. **First thing next session: ask which page, and check `requireQrManager` against the prod admin's JWT role.**
    4. Public "Did you mean" at sign-in exposes registered contacts' first name + initial + company to anyone with the QR (3+ letters, max 3). Deliberate trade-off.
    5. Portal Site Board still shows non-pinned board content (project, manager, permits, documents, trades, events); user confirmed to leave it.
    6. Portal daily-report photos only tested at 400px (drop, save); 360/768 covered by `check:layout` route sweep only, not the Add Photos panel.
  - **Notes for next session:** (a) after ANY backend change rebuild + restart the local api-server (`cd artifacts/api-server && NODE_ENV=development node ./build.mjs && PORT=8080 node dist/index.mjs`); vitest hits the LIVE :8080 server, so tests run against stale code otherwise. (b) `pnpm --filter @workspace/db run push` hangs interactively; apply the same SQL via `psql "$DATABASE_URL"` AND add it to `ensure-schema.ts`. (c) After a schema change run `pnpm run typecheck` (rebuilds lib declarations) before trusting api-server type errors. (d) Headless Chromium hangs the QR check-in unless geolocation permission is granted in the context. (e) Push with `push-delta.ts`; if GitHub returns 403 rate limit wait ~4 min and retry; verify with `verify-push.ts <ref>`. (f) Fire-and-forget notification inserts can race test teardown; wait ~500ms before deleting fixtures. (g) delete any `tmp-*` dev rows.
- **2026-09-16 SESSION CLOSE:** documented **#100**; fixed em-dashes in `index.html`. **Open:** a separate session made 6 unreviewed commits (`cd91563`/`e49a8a1`/`3e49ec7`/`1c22838`/`27dd5ef`/`9c76587`: portal `section.tsx`+API-schema, dashboard/documents pages, user-guide, 2 Publishes). Read them, confirm `typecheck`/`check:layout` pass, log properly. Later `3e8ea66` fixed push-robust dropping files under rate limits.
- **2026-09-15 and 2026-09-11:** see CLAUDE_ARCHIVE.md (`4c355d5` shipped #99).
- **2026-07-30 and earlier:** see feature list + CLAUDE_ARCHIVE.md. **Gotcha:** local api-server on `:8080` isn't auto-restarted. `git pull` fails; use `push-robust.ts`.
- **PD backlog**: **F7** Site Board on-site count, **F8** Timeline link, **F9/F10** spikes.
- **Infra:** GitHub push ≠ deploy; prod = Replit **Publish** (~1-3min lag). Stripe **LIVE**. Verify via browser-check skill.
