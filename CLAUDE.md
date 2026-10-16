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
56. Site Calendar deep-links + custom events — `calendar_events` table + CRUD; (QR/portal boards NO LONGER show events, see #112)
58. Dashboard outstanding-invoices widget — top-5 unpaid/overdue card w/ Open/Share/Mark-Paid
59. Multi-threshold expiry email reminders — permits/insurance certs email at 30/21/14/7/1 days then daily post-expiry; `expiry_reminder_logs` de-dup table
60. Real email verification on registration — `emailVerified:false`+token, no JWT until verified; gated login
(61 to 113 deployed; detail in CLAUDE_ARCHIVE.md.)
61. **Team Portal**
62. **Daily Site Reports hub (F5)**
63. **Per-person Team Portal invites — portal-only for everyone**
64. **Deep-links for actionable/to-do items**
65. **Team Portal sharing (all/trade/individual) + gated portal visibility**
66. **Real invite emails (Resend) + existing-account portal join**
67. **Portal session policy + logo nav**
68. **Portal freshness + unseen badges + Web Push**
69. **F6 — subbie/merchant contact documents**
70. **Notification alert-viewer (Next/Previous)**
71. **Remove people from projects + archive/hard-delete contacts + first/last name split**
72. **Portal-audit fixes + contractor self-upload docs + mobile/PWA**
73. **Plant & Materials tracking + site-issue closure reasons**
74. **Person-first contacts: self-employed + certifications + Team tab restructure**
75. **Daily Report in the Team Portal + shared dictation button + plant attachment counts**
76. **Team Portal Messages — project-scoped DMs, channel access, PM oversight**
77. **Minimal-by-default Team Portal + retired doc tabs into filtered Shared with me**
78. **Site issue archive/restore + individual photo removal + admin hard delete**
79. **Fix stale mirrored contact name on Team tab + portal-invite surname gate**
80. **Fix uncaught chunk-load crash after a deploy**
81. **Inline portal-permission toggles on Team tab cards**
82. **Portal access controls follow-up: card layout, whole-login revoke, invite parity**
83. **Portal permission card row order + pre-accept permission parity + full functional verification**
84. **Platform Admin restriction (`users.platformAdmin`)**
85. **Portal "Log a new item" for Plant & Materials**
86. **PIN-based document sign-off (Pending Sign-offs, dashboard + portal)**
87. **Activity-entry deep-links + daily reports join Team Portal sharing**
88. **Configurable per-document PIN sign-off**
89. **Fix dead Overview-tab "Recent Activity" card**
90. **Three portal fixes: nav/GET permission gating, explicit site manager, verified submit→view already worked.**
91. **Document Allocate removed (folded into Share), project-level PM/approver authority added**
92. **In-app User Guide (dashboard, portal, invite email) + restyle** — single shared source `lib/user-guide/src/index.ts`, 3 surfaces. Deployed; prod verification unrecorded (audit 2026-10-15). *(archive)*
93. **Invoice Allocate + scoped Share** — REMOVED with the invoices feature (`bebe715`, #126). *(archive)*

94. **Team Portal visual redesign (big/colourful)**

95. **Check-in insurance gate vs contact card unified (`lib/insurance.ts`)**

96. **Portal navigation cleanup**

97. **Deep-link project/expiry/overdue-invoice alerts**

98. **Em-dash sweep + dead-badge audit**

99. **Construction Programme doc on the Progress tab**
100. **Multi-project Team Portal across companies**

101. **Portal project-switcher polish**
102. **On-hire plant on dashboard**
103. **QR site sign-out + live on-site register**
104. **Photos inside a daily site report**
105. **Portal report photos + public on-site count**
106. **QR sign-in/out: remembered device, name lookup, near-match**
107. **Permits-tab overdue pill deep-links**
108. **Check-in notification detail; identity-linked check-ins**
109. **Site QR restricted to admin/PM (server)**
110. **Public suggestions show initials only**

111. **/info pricing cards + plan carried to checkout**
112. **Calendar + ratings/payment holds PM/admin only**
113. **QR load failure shown as failure + honest photo hints**
114. **Insurance gate on every check-in path + manager override; end-of-day auto-close; per-site clock** — held check-ins (403 `check_in_held`, admin/PM `hold-decision`), `runCheckinAutoClose` sets `auto_closed_at` (NOT a sign-out). Test: `site-checkin-insurance-hold.test.ts`. *(archive)* (2026-10-07)
115. **Project edit/create role-gated on the server** — `PATCH /projects/:id` approver-only, "complete" only via PIN close-out (`use_closeout`); `POST /projects` admin/PM. Test: `project-edit-roles.test.ts`. *(archive)* (2026-10-07)
116. **Shared authz layer + 3 critical holes closed** — `lib/authz.ts` `allow(...policies)` (role re-read from company_members, 60s cache, `bustRoleCache`). Closed: user admin, insurance forging, check-in exposure. Tests: `authz-critical.test.ts`, `authz-coverage.test.ts`. *(archive)* (2026-10-07)
117. **Subcontractors portal-only** — old contact-card invite link 410; role "subcontractor" never a dashboard user (`use_portal`); `authenticate` sets `req.user.role` from company_members. Test: `subcontractor-portal-only.test.ts`. *(archive)* (2026-10-07)
118. **High batch on the authz layer** — pins/permits (approver), billing (admin), test-email (platform admin), contacts (manager), notes (internal staff), project people (approver). Test: `authz-high.test.ts`. *(archive)* (2026-10-07)
119. **Check-in photos: signed, expiring URLs** — `checkin-*` uploads 1 to 2h signed only; public QR responses drop photoUrl/lat/lng/personKey (`publicCheckin`). Test: `checkin-photo-signed.test.ts`. *(archive)* (2026-10-08)
120. **Declaration sweep complete; undeclared routes fail closed** — all 212 legacy routes declared; runtime `enforceDeclaredRoutes` in `routes/index.ts`. Holes closed: milestones, document upload, member avatar/schedule/permissions (had NO tenant check), DM reactions. Tests: `authz-sweep.test.ts`, `authz-coverage.test.ts`. *(archive)* (2026-10-08)
121. **Staff notes private** — `/users/:id/notes` admin/PM only, never the subject, scoped by `user_notes.company_id` (NULL = hidden). Retired invoice attachments answer 410 (`isRetiredUpload`). Test: `staff-notes-private.test.ts`. (2026-10-08)
122. **QR board sign-out needs proof** — `/checkout` needs remembered-device token or name+company+mobile on file (`phonesForKey`); `/site/:token/who`+`/status` removed. Test: `site-signout-matching.test.ts`. *(archive)* (2026-10-08)
123. **Site workers Team Portal only; dead admin rows** — dashboard = admin/PM only (`DASHBOARD_ROLES`, `use_portal`); `authenticate` refuses portal-only accounts; boot `company_members` backfill REMOVED. Test: `site-worker-portal-only.test.ts`. *(archive)* (2026-10-09)
124. **Phone-first QR sign-in + portal Site Register, offline** — `/identify` by mobile; unknown number or typed name = HELD `unverified`; portal `/portal/site-register` for site manager / PM cover (`canSeeSiteRegister`), cached offline; `PUT /portal/me/mobile`. *(archive)* (2026-10-09)
125. **Fire-roll readiness + daily alert** — red/amber/green per QR project; one `fire_roll_not_ready` alert per site-day. Test: `fire-roll-readiness.test.ts`. *(archive)* (2026-10-09)
126. **Fire-roll backup check + invoices removed** — `cover` check: one register holder = amber. `lib/invoice-removal.ts` at boot deletes files, then drops `invoices` (no-op once gone). Record: `reports/invoices-removed-2026-10-09.md`. *(archive)* (2026-10-09)

127. **Part A: uploaded files login-only** — `GET /uploads/:f` needs a valid `?exp=&sig=`; `signUploadsInResponses` (app.ts) signs every upload link in `/api` JSON, strips sigs from request bodies. ShareModal never sends a signed file. Test: `login-only-files.test.ts`. *(archive)* (2026-10-09)

128. **Workspace isolation guard** — `lib/environment.ts` `IS_DEPLOYED` (`REPLIT_DEPLOYMENT=1` or `NODE_ENV=production`; never `REPLIT_ENVIRONMENT`). Outside deployed: no email/jobs, Stripe test key only, own push keys, uploads to `.private/workspace-uploads/`, no deletes via `lib/gcs.ts`. `/api/health` reports `environment`. Test: `workspace-isolation.test.ts`. *(archive)* (2026-10-09)
129. **Part B: per-share links; bare file links cut** — drawings/project docs/permits leave SiteSort only via `/s/<token>` (`share_links`, SHA-256 of token stored; `lib/share-links.ts`, `routes/share-links.ts`): 30 days or until superseded (doc status / permit `archived_at`), Stop link, 3-day reminder to the sender (hourly job, deployed only; link counts as sent once `POST /share-logs` carries `shareLinkId`). Dead link → request access (`share_access_requests`, max 3 pending/10 a day per link) → sender or any approver decides at `/share-requests` (sidebar entry with live count + dashboard Needs Attention, `GET /share-requests/count`); approve emails a fresh link to the CURRENT revision. `GET /uploads` = signature only, no exceptions; `/documents/:id/open` needs a valid `?d=` (30 days, current revision) else lands in-app. Tests: `share-links.test.ts`, `login-only-files.test.ts`. (2026-10-15)

130. **Database-down visibility** — `probeDb()`/`classifyDbError()` (`lib/db`, unwraps Drizzle `cause`; kinds paused/timeout/auth/unreachable/error; "paused" wording is a GUESS, never seen live). `/api/health` logs the real error, returns `dbError {kind, code}`. Login + global error handler answer 503 `database_unavailable` with a plain message. `lib/db-watchdog.ts` (deployed only, every 2 min while an instance is up) emails `OPS_ALERT_EMAIL` after 2 failed probes and again on recovery; `OPS_ALERT_EMAIL` (Deployment secret; comma/semicolon/space-separated list, one email per address) must be set or it only logs. Confirm: prod `/api/health` `environment.dbAlerts` = on + `dbAlertRecipients` count; startup log "db watchdog: on, alerts go to OPS_ALERT_EMAIL" (masked addresses); Admin page "Database Alerts" card has "Send test alert" (`POST /api/admin/ops-alert-test`, platform admin, real alert path, 409 outside deployed). Test: `ops-alert-test-endpoint.test.ts`. VERIFIED in prod 2026-10-16: prod `/api/health` showed `dbAlerts":"on","dbAlertRecipients":1`, `db":"up"`, uptime 287s after the republish (curl); unauthenticated `POST /api/admin/ops-alert-test` = 401 (curl); Dean pressed Send test alert, email arrived in his inbox, not spam (Dean, observed). Not yet seen: a REAL outage alert (the paused-wording guess is still unproven). Autoscale = no instance, no check: an outside uptime monitor on `/api/health` is the real cover. Tests: `db-unavailable.test.ts` (4/4); dead-DB :8090 run gave health 503 `unreachable/ECONNREFUSED`, login 503. (2026-10-16)
131. **Share dialog: which card is on the portal** — one person can have two cards (Dean: Dean's Diggers card = portal member via dean.parrish@partnersand.com; mong.com card = never invited). `portal-audience` members and `portal-shares` rules carry `portalStatus` member/invited/none (`portalStatusByPerson`, invited = live pending invite); rules also carry `personCompany`. Dialog: green dot = on portal, "invite pending", "not on portal, sees nothing"; chips wrap (status was cut off at 360px); a share that reaches nobody shows an amber warning; a failed POST shows an error (before: success even on failure); stray "0" after names with no firm fixed. User Guide sharing step updated. Test: `portal-share-two-cards.test.ts` (3/3: person share to the no-portal card reaches nobody; an Everyone share reaches him regardless of card). 198/198 API, 198/198 layout, dialog driven at 360/768. NOT the proven cause of Dean's missing share: an Everyone or Demolition rule on that document would have reached him whichever card was picked. Prod query: `reports/dean-share-card-check.sql`. (2026-10-16)
132. **Portal visibility trace + view status in the log** — `buildPortalShared(userId, pid)` (routes/portal.ts) is now the single builder for `/portal/shared`. `GET /api/admin/portal-trace?email=&projectId=&itemId=&itemType=` (platform admin, read-only, writes no activity row) runs it for any portal login and reports memberships, resolveViewer, each rule + match, visibleShareMap, whether the item is in the full response, or the thrown error. Admin page "Portal Visibility Trace" card. Portal views now log `metadata.status` (HTTP status) in `activity_log`; before, a failed load and a successful one wrote identical rows. Tests: `portal-share-two-cards.test.ts` (6/6). 201/201 API, 198/198 layout, card driven at 360/768. Dean bug status (2026-10-16): T1 to T4 on prod show ONE membership row (card ab458bd2, Demolition), person+trade+all rules match, doc current on 09b3eb48, 11 logged loads after the share. No line in the list code drops it for those values; cause still open. Next: Deployment log statusCode at 15 Oct 18:24:31, or the trace after publish.
133. **Portal freshness: "Updated X ago", failed/stale bars, drawing revision check, new-build reload** — `pages/portal/freshness.tsx` reads React Query's cache, so every portal list is covered: pinned header shows "Updated X ago" + Refresh (icon-only Home on phones); bar under it: red "Couldn't load" (no data), amber "Couldn't update" (old copy on screen), amber stale (15+ min, `STALE_AFTER_MS`), blue "SiteSort has been updated" + Reload. `<Empty>` shows "Couldn't load this" instead of "nothing shared" when the load failed. Lists poll every 60s, one retry on 5xx/network. When the list isn't fresh, Shared with me POSTs on-screen drawing ids to `POST /portal/documents/revision-check` (portal guards; answers only for docs this member can see; says whether the newer rev is shared with them) and shows a red bar naming the drawing + new rev. Build id: `vite.config.ts` bakes `__SITESORT_BUILD__` and emits `/version.json` (checked on open, on return to the app, every 5 min; `sw.js` serves it network-first). Site register keeps its own age display, skips all of this. User Guide worker step "Check your list is up to date". Evidence (2026-10-16): `portal-revision-check.test.ts` 3/3; 204/204 API on :8090; typecheck clean; 198/198 layout; all four bars driven in a browser at 360 and 768 (long drawing name), overflow 0 in all 10 runs (stale, failed with data, failed no data, revision, new build), screenshots checked by eye. Harness note: block service workers in Playwright (`serviceWorkers: "block"`) or `page.route` never sees `/version.json`. NOT published: Dean publishes Monday 2026-10-19. Not yet seen on a real phone.
134. **"Shared with me" badge = the list; shared site issues fixed** — Dean saw badge 1 with the item missing from the list. Diff of the two paths: for DOCUMENTS the old badge (`computeUnseen`) and the list (`buildPortalShared`) used identical rules (same share match, `status in (current, superseded)`), so for a document the server could not disagree; for a document the likeliest cause stays a failed list reload kept silently on the phone (pre-#133, unverified in prod). Where they DID drift: badge counted archived permits the list hides, counted a shared safety doc twice, skipped daily reports the list shows. Now the badge counts `unseen` items of `buildPortalShared` itself. Also: `serializeIssue` is async and `annotate` spread its Promise, so EVERY shared site issue in `/portal/shared` came back as `{sharedAt, unseen}` with no id/description (now awaited). Test: `portal-shared-badge.test.ts` 2/2 (both failed against the old build). 206/206 API, 198/198 layout (2026-10-16). Not published.
135. **People picker hides cards with no portal access** — share dialog People tab no longer offers a `portalStatus: none` card (a share to it reaches nobody); invite-pending cards stay. Hidden cards are named under the chips ("Not listed, not on the portal: ... Invite them to the portal from the Team tab first."). User Guide sharing step updated. Driven at 360/768 with a long-named no-portal card: 3 real chips shown, the no-portal card not among them, line shown, overflow 0 (2026-10-16). Server still ACCEPTS a person share to a no-portal card (UI-only change). Not published.

## Uploads / File Serving

**Critical:** Replit's router only forwards `/api/*` to the Express server. Files must be served under `/api/uploads/` not `/uploads/` or they 404 in the frontend.

- **Workspace and prod share ONE object storage bucket:** a file deleted from the workspace is gone for prod too. `lib/gcs.ts` writes to `.private/workspace-uploads/` and refuses deletes outside the deployed app, but ONLY for code using it: any script with its own storage client can still delete prod files (proved 2026-10-15). Real fix: `docs/dev-repl-scope.md`.
- Uploads are login-only since #127 (signed links); drawings/project docs/permits go out only via `/s/<token>` share links (#129)
- Upload endpoint (`POST /api/upload`) returns `/api/uploads/<filename>` URLs
- All frontend file links rewrite legacy `/uploads/…` to `/api/uploads/…` before use

## Key Architecture Notes

**⚠️ Schema changes → `ensure-schema.ts` (CRITICAL):** Prod DB is separate from workspace. `drizzle push` does NOT migrate prod. All new tables/columns MUST be added to **`lib/ensure-schema.ts`** (idempotent boot migration run from `index.ts` before `app.listen`) or prod will query a non-existent table and break login. **Pattern for ALL future schema changes.**

**`company_members` model (Feature #57):** `company_members` table (`id, userId, companyId, role`, unique(userId,companyId), cascade) is the source of truth for "who's in company X" and role in X". `users.companyId`/`role` = home company only. JWT `{id, companyId, role, email}` = ACTIVE company (shape unchanged). Switch via `POST /auth/switch-company` (403 if not a member). `POST /users` links an existing email instead of erroring. Helpers in `lib/memberships.ts`. `company_members` INSERTs need explicit `id` (`gen_random_uuid()`) — table has NO id default.

**Mobile responsive patterns:** `grid ... [&>*]:min-w-0` makes every grid cell flex/grid-safe (prevents iOS date input overflow). `hidden md:table-cell` for responsive table columns (not `table-cell` which is a no-op). `ui/input.tsx` + `ui/textarea.tsx` carry `min-w-0 max-w-full box-border` globally. `index.css` has global CSS `min-width:0; max-width:100%; width:100%; box-sizing:border-box` on `input[type="date/time/datetime-local"]` and `select`. Use `lg:grid-cols-N` (not `sm:`) for stat-card grids inside the app shell (sidebar takes 256px leaving ~512px at md, so sm/md breakpoints fire too early for 3-col layouts). Shared layout components: `ui/page-header.tsx` (`<PageHeader>` — title/description/actions, stacks below `sm`) and `ui/list-row.tsx` (`<ListRow>`/`<PillGroup>`/`<Pill>` — content+actions row, stacks below `sm`, pills wrap).

**⚠️ Layout gate (CRITICAL — responsive regression sweep):** Hand-rolled `flex items-center justify-between` headers/rows (no `flex-wrap`/`flex-col sm:flex-row`) caused action buttons to squash against titles and status pills to overlap text on mobile in H&S, Finances & Expiry, and Site Check-ins (all fixed). **After any UI change, run `pnpm run validate` (or at minimum `pnpm run check:layout`) — all routes must pass before finishing.** The route checker discovers `<Route>` entries from `App.tsx`, project-detail tabs from `tab-config.ts`, and portal destinations from the frontend nav/rendering plus the server allowlist. It sweeps **360px, 390px, and 768px** by default (override with `LAYOUT_VIEWPORTS=...`) and fails closed if a dynamic fixture, portal session, or permission grant cannot be created. It fails on document/descendant horizontal overflow, marked pill/action-bar overlap, and stacking hit-test coverage of interactive controls. Every run writes a full per-route report to `reports/layout-check.json` (override with `LAYOUT_REPORT_PATH`). **New pages/rows use `<PageHeader>` and `<ListRow>`/`<Pill>` — never hand-roll a title+actions or content+actions layout.** The script never reads the shared `APP_URL` env var (it points at prod in this workspace) — it only targets `localhost` and refuses to run otherwise, since it writes test fixture data through the API.

**⚠️ Finishing rule (CRITICAL): all UI changes must be verified at 360px AND 768px with no horizontal overflow before finishing.** `pnpm run validate` sweeps routes at 360/390/768, but it does NOT open dialogs, panels that only appear after typing/clicking, or public pages in their interactive states. For any new dialog/panel/banner, also drive it in a browser at 360px and 768px (long names and long company names) and assert `document.documentElement.scrollWidth <= clientWidth`. Recipe: API login, `addInitScript` the token, `page.route('**/api/**')` to `localhost:8080` (Vite does NOT proxy `/api`), then measure.

**Every authenticated endpoint declares who may call it (CRITICAL, #116):** `router.METHOD(path, authenticate, allow(POLICY...), handler)` from `lib/authz.ts` (COMPANY_MANAGER, COMPANY_ADMIN, projectApprover(), projectSiteManager(), self(), ANY_MEMBER). Never rely on a hidden button. Team Portal routes are declared by the portal guards (`requirePortalSession`/`requirePortalMember`/`requirePortalPermission`, registered via `declarePolicy`). There is NO legacy allow-list any more (#120): `authz-coverage.test.ts` fails on any undeclared route, and at boot `enforceDeclaredRoutes` closes any undeclared logged-in route (403 for everyone, logged).

**Working style (2026-10-15):** build, don't scope, unless irreversible or data-changing; short chat answers, no status pages unless asked; small frequent releases.

**"Verified" needs evidence (CRITICAL, user rule 2026-10-15):** record something as done, verified, tested or live ONLY with the commit, test or command output that proves it, next to the claim. No evidence = write "unverified". Dean acts on these entries.

**No em-dashes or en-dashes in user-facing text (CRITICAL — reintroduced by new features at least once already):** Never use — or – in any user-facing copy: UI labels/badges/empty-states, toasts, emails (including the portal invite email), the in-app User Guide, notifications, validation/error messages shown to a user. Use a comma, a colon, a full stop (split into two sentences), or the word "to" for ranges (e.g. "9 to 5", not "9–5"). This does NOT apply to code comments, CLAUDE.md/CLAUDE_ARCHIVE.md, or dev-facing logs — only text an end user actually reads.

**Every badge/count/alert that names a specific record must deep-link to it (CRITICAL — recurring "dead badge" bug):** Any count, badge, alert, or "Needs Attention" item that refers to a specific record (a document, invoice, permit, issue, etc.) must be tappable and must navigate straight to that record, using the shared `itemDeepLink()` helper (`artifacts/sitesort/src/lib/deep-link.ts`) and/or the `<LinkRow>`/`ListRow` component (`ui/list-row.tsx`) — the same pattern used by the Close-out card and activity-feed entries. When a count spans multiple distinct records, landing on the correctly filtered list view is acceptable; when it's exactly one record, it must open that record directly. Never ship a badge that names a specific thing but isn't clickable. Pure aggregate KPI tiles (total revenue, headcount, % complete) that don't reference an inspectable record are exempt.

**Test accounts:** `paul@acme.com` / `password123` (demo, Acme Construction, Free Plan — project-capped). `annabelleparrish@icloud.com` (site_worker, "Test SiteSort"): portal-only since #123, Team Portal login only. Tip: `beta_access=true` on demo company bypasses plan cap for testing gated UI.

**In-app User Guide (single shared source):** copy lives in `lib/user-guide/src/index.ts` (`PM_GUIDE`/`WORKER_GUIDE`/`FAQ`) and is read by three surfaces — the dashboard `/user-guide` page (sidebar, under Settings), the portal `/portal/help` page (Help, under Settings — worker section + `workerFaq()` only), and the "Invite to Portal" email excerpt in `artifacts/api-server/src/lib/email.ts` (plus its public, no-login `/guide` page link). If you change a user-facing flow, update the in-app User Guide to match — edit the content module once and all three surfaces stay in sync.

## Session Log

Full session-by-session detail in CLAUDE_ARCHIVE.md. Recent sessions (newest first):
- **2026-10-16:** Prod DB was PAUSED by a zero Replit credit balance (Dean, confirmed by Replit): top-up does NOT resume it, the Unpause button does. Dean unpaused; prod `/api/health` 200 `db: up` (curl 2026-10-16). Auto-reload now $50 below $20 (Dean). #130 + documents-list fix PUBLISHED; #130 alerting verified end to end (see #130). Integrity query `reports/post-pause-integrity.sql` run on prod by Dean: clean, documents 16, portal_shares 22, projects 5, share_links 3, site_checkins 12, users 27, all as expected. Built #130. Silent-failure sweep (read-only, nothing fixed): `reports/silent-failures-2026-10-16.md`, about 80 places where a failed request shows empty/success. OPEN (scoped, not built): a new revision starts with ZERO portal shares (upload in `routes/documents.ts` copies nothing from the superseded doc), so the crew keeps the old rev and "Open latest" fails; Dean wants shares carried forward by default. Documents-list bug (open bug 1): cause still unverified in prod; most likely a failed list load that stayed blank (retry off, no refetch, no message). Fixed defensively: loading + "Couldn't load" with Try again, retries 5xx/network twice, refetches on return to the tab, list route 2 queries total instead of 2 per doc (output byte-identical on 3 projects, sigs stripped). Browser test at 360/768/1400: error shown, Try again recovers, refetch on return yes, overflow 0. 191/191 API tests, 198/198 layout.
- **OPEN BUG (2026-10-16, fire-roll risk): portal notifications switch themselves off.** Dean's turned off on their own; turning back on errored, then worked minutes later. Code findings (verified in code, NOT in prod): (1) any 401/403/404/410 on the portal context call auto-logs the phone out (`layout.tsx` authFailed -> `portalLogout`), which calls `disablePush()`: unsubscribes the phone, deletes its server row, and sets `sitesort_portal_push_disabled`, the "user turned it off" flag, so the self-heal `resyncPush` on every app open skips that phone FOREVER. Triggers: project switch revokes the old session (`claimPortalSession`), so an in-flight/second-copy request on the old token gets 401; member revoke/re-invite (`revokePortalSessionsForMember`, also deletes push rows); 30-day expiry. (2) `push_subscriptions.endpoint` is UNIQUE and subscribe overwrites `project_id`: one phone gets alerts for ONE project only, the last one opened; the toggle still shows ON. A site manager on two projects silently loses the first project's held-at-gate alerts. (3) DB outage alone should NOT cause it for portal tokens (guards answer 500 = "offline"), unless prod has REDIS_URL and Redis also failed (`authenticate` answers 401 on ANY error). (4) The "errored" re-enable: cause unknown. (5) Stale user text: "signed out after 12 hours of inactivity" but `INACTIVITY_MS` is 30 days. Prod query: `reports/dean-push-off-check.sql`. Nothing fixed yet. Proposed fix: automatic logout never sets the flag or unsubscribes; one subscription row per (phone, project).
- **2026-10-15 CLOSE (evening):** Prod verified by Dean after publish: `invoices` gone ("relation invoices does not exist"), `share_links` present, drawing + insurance cert open, `/s/` link served the file in incognito. Nothing rolled back. OPEN BUGS: (1) dashboard documents list renders empty after opening a drawing until refresh (cause unverified; local repro at 1400/390px did NOT reproduce, list is not refetched on return; the screen shows no message when the list request fails); (2) Dean doesn't see an "Everyone" portal share that Annabelle Rose does see. An `all` share points at no card; lookalike-project theory DISPROVED (Dean, 2026-10-15: only one "test 1 site sort", in Test SiteSort; earlier wrong-project theory also disproved). Cause unknown; Dean runs the query tomorrow. Fire-roll readiness alerts seen working on the Acme dashboard (Dean, observed in prod). Mobile capture gate (#124) seen working in prod: Annabelle, named site manager with no mobile on file, was asked for her number before continuing (Dean, observed). Query: `reports/two-cards-portal-check.sql`. Share dialog shows success even when the POST fails (no `res.ok` check). New test `portal-share-drawing.test.ts` (passes locally; first coverage of `/portal/shared`). NEXT, in order: settle Dean/portal cause, fix documents list, `console-fixes-check.sql`, LINK_TEST. R2 + dev Repl at the weekend. "One person across several companies" is no longer parked: scope it after the Dean result.
- **2026-10-15:** #129 Part B built + pushed (198/198 layout, 186 API tests). PUBLISHED evening 2026-10-15: prod `/api/health` `environment` = deployed true, stripe live, email/push/jobs/fileDeletion on; `/api/share-requests/count` 401 (was 404); `/api/uploads/x.pdf` unsigned 403; `/api/share/badtoken` 404 not_found JSON; `/s/badtoken` page 200. #126 invoice drop at boot: unverified (needs prod DB). Restore TESTED for real: `5e5d1f77...pdf` restored from soft-delete, bytes read back (only 1 of the 4 invoice files was ever deleted). Workspace secrets: live `sk_live_` Stripe + Resend + prod VAPID still present, no `STRIPE_TEST_SECRET_KEY`/`WORKSPACE_VAPID_*`. JWT secret PROVEN SHARED workspace=prod (workspace-signed token got 200 from prod `/api/auth/me`, 2026-10-15); rotation deferred until the Deployment-secrets chain icon is understood (`docs/dev-repl-scope.md` phase 3 blocker). Do NOT remove workspace keys before then. Dev Repl scope: `docs/dev-repl-scope.md`. Audit of CLAUDE.md claims: `reports/claude-md-audit-2026-10-15.md`. Still open from 10-08: ex-site-manager check-in detail, portal photo GPS, daily-report check-in exposure, `req.ip` proxy.
- **2026-10-09 (2):** prod review queries in `reports/`; results were never saved. Console fixes (A1, Amy) unconfirmed: `reports/console-fixes-check.sql`.
- **2026-10-09:** #123 to #125. Binding: mobile match enough; no mobile -> hold, never refuse; keep remembered device; no time-limited PM elevation. (archive)
- **2026-10-08 SESSION CLOSE:** binding: PMs company-wide ("assigned PM" parked). (full: archive)
- **Dev gotchas (full: archive):** rebuild+restart api-server after backend changes; test on a :8090 copy (`PORT=8090 node dist/index.mjs`, `API_BASE=http://localhost:8090/api npx vitest run`). `db push` hangs: use `psql` + `ensure-schema.ts`. Push via `push-delta.ts`, verify with `verify-push.ts`.
- **OPEN, TOP PRIORITY: workspace/prod isolation** (status 2026-10-15 above). Code guard #128. User actions: Publish; then the `LINK_TEST` chain test; rotating `JWT_SECRET` and removing live keys from workspace Secrets both WAIT on that result. After every publish check prod `/api/health` `environment` (deployed true, email/jobs on, stripe live). RULE: **no file deletions from the workspace, ever**. Restore: `scripts/src/restore-upload.ts`. Workspace DB = copies of prod rows (same ids).
- **Decisions 2026-10-15:** backups on Cloudflare R2 with bucket locks; prod Repl access Dean only; delete workspace DB copies of real records once the dev Repl works; dev Repl phases 0 to 3 after the publish settles (`docs/dev-repl-scope.md`). Prod files 649 / 175 MB (listed 2026-10-15). Prod DB point-in-time restore per Replit docs; plan window unconfirmed.
- **Dean (binding, 2026-10-09):** both setups stay; subbies work for more than one firm. Never merge his contacts or check-in rows.
- **Backlog (2026-10-09):** hold-queue flooding: someone hammering a board can bury a real worker's hold among fake ones (site manager reviews on a phone); later, something simple like grouping or flagging holds from a device already refused. SMS codes = later upgrade to phone sign-in. PD backlog: F7 to F10 (CLAUDE_ARCHIVE.md).
- **Infra:** GitHub push ≠ deploy; prod = Replit **Publish**. Stripe **LIVE**.
