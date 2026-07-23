# SiteSort – Session Log Archive

## Features #77–80 full detail (condensed to summaries in CLAUDE.md, 2026-07-21)

77. **Minimal-by-default Team Portal + retired doc tabs into a filtered Shared with me** — a brand-new portal member now sees ONLY Overview/Messages/Shared with me/Progress/Team/Site Board/My documents/Settings; Site Issues, Plant & Materials, and Daily Report are absent (not greyed) from nav until the PM grants the matching permission. The three `project_members` flags (`canLogIssues`/`canUpdatePlantMaterials`/`canEditDailyReport`, added in #73/#75) **already existed as write-only grants with a working Team-tab UI** — this closed the visibility half: `requirePortalPermission` now also gates the GET list/detail endpoints (not just POST/PATCH), `canLogIssues` defaults to `false` (was `true`; existing rows untouched, only the column default + fresh inserts changed), and `computeUnseen`/`/portal/shared`/`/portal/overview` all stop counting or returning gated content so a badge or aggregate view can never tip off a section a member can't open. **H&S/Drawings/Method Statements/Permits/Safety/General retired as standalone nav tabs** (deliberate reversal of #65's per-type tabs) — that content, plus the full site-notes history that used to live only on General, now surfaces inside "Shared with me" behind an All/Drawings/H&S/Permits/Method Statements/Safety/General category-chip filter; the underlying `portal_shares` gating + always-open safety-doc rule from #65 are unchanged, only the nav presentation collapsed. Verified end-to-end against a rebuilt local `:8080`: fresh portal member's nav confirmed as exactly the 8 minimal items; granting each of the 3 permissions unlocked its section (a real site issue logged via the portal reached the PM's issues list); revoking one both removed it from nav and 403'd the endpoint directly. `pnpm run typecheck` clean, `pnpm run check:layout` 96/96 at 360px/768px. **DEPLOYED+prod-verified** (2026-07-20, user Published via Replit UI, health-checked OK post-restart — `uptime` reset to 225s; pushed to GitHub via `push-robust.ts`, verified against `main → 91d6d53c` with a bespoke signature check since `verify-push.ts`'s hardcoded checklist predates this feature; live prod write-path test via `paul@acme.com` on a real project repeated the full local e2e — fresh throwaway portal member defaulted to all-false/403 on all 3 gated endpoints, `/portal/shared` correctly returned a real always-open safety doc while keeping `photos: []`, granting `canLogIssues` unlocked the endpoint and a real issue was logged and reached the PM's issues list, revoking re-403'd it; throwaway person hard-deleted after, throwaway issue marked resolved (no delete endpoint exists for site issues) rather than removed).

78. **Site issue archive/restore + individual photo removal + admin hard delete** — closes a real gap found while cleaning up leftover prod test data: there was previously NO way to remove a photo/site-issue at all. Managers (`admin`/`project_manager`) can now `DELETE /photos/:photoId` to archive (soft-delete) an issue — `archivedAt`/`archivedBy`/`archiveReason`, excluded from normal list/count reads by default, viewable + restorable (`PATCH /photos/:photoId/restore`) via `?archived=true` and a new "Archived" toggle on the project's Issues tab (who/when/reason shown, matches the same soft-delete-not-erase convention as `subcontractors`/`people`.archivedAt). Separately, `DELETE /photos/:photoId/photo` lets a manager remove just the attached image (`photoRemovedAt`, `photoUrl` hidden from reads but never erased from the DB) without touching the issue record — new buttons on the Issues tab row + photo detail overlay. For genuine test/mistake data with no audit value, `DELETE /admin/photos/:photoId` (admin-email-allowlisted via the existing `requireAdmin`, same gate as the rest of `admin.ts`) actually removes the row — a small "Danger Zone" widget (paste a photo id, confirm) added to the admin dashboard, since this needs an admin login to exercise and Claude doesn't have one. No other table has a foreign key onto `photos.id`, confirmed via schema search, so the hard delete needed no cascade handling. OpenAPI + codegen (`ArchivePhotoRequest`, `Photo.archivedAt/archivedByName/archiveReason/photoRemovedAt`, `photoUrl` now correctly `nullable`), migration for the 5 new `photos` columns. Verified end-to-end against a rebuilt local `:8080`: archive excludes from the active list + appears under Archived with reason; restore un-archives; photo removal hides the URL and is idempotent (400 on a second attempt); the admin route correctly 403s a non-admin token. `pnpm run typecheck` clean, `pnpm run check:layout` 96/96 at 360px/768px (incl. the new Admin Danger Zone + Issues tab controls). **DEPLOYED** (2026-07-20, user Published via Replit UI; GitHub push initially rate-limited, retried successfully — `main → 63c2a744`). The two rows that started all this (the leftover `"PROD PERMISSION TEST snag"` photo and the orphaned `prodperm-test-user@example.com` portal account it was blocking) are still on prod, waiting on the user to run the Danger Zone delete themselves (Claude has no admin-allowlisted login).

79. **Fix stale mirrored contact name on Team tab + portal-invite surname gate** — a contact correctly edited in the Contacts directory (which reads/writes `subcontractors.contactFirstName/contactLastName/contactName` directly) could still show wrong on the project Team tab — in the reported case, literally the *company* name repeated as the person's name ("Amy I Cloud" instead of "Amy Parrish") — and fail the portal-invite "add a surname" check with a real surname on file. Root cause: `people.name/firstName/lastName` is a **copy-on-write mirror** of the subcontractor's contact fields, synced on every edit in `subcontractors.ts`/`people.ts` but only when `people.is_primary_contact = true` matches — a conditional write that can silently miss, leaving the mirror frozen at a stale value forever while the canonical `subcontractors` row (and the Contacts UI reading it) is completely correct. New `lib/person-name.ts` (`canonicalPersonName`) resolves the display name by preferring the subcontractor's own fields over the mirror, wired into `GET /projects/:id/members` (Team tab), the portal-invite surname gate (`POST /projects/:id/portal-invites`), and the Team **Portal**'s own `/portal/team` list (identical bug, same fix). `ensure-schema.ts` gained a self-healing boot migration that re-syncs any drifted primary-contact row from its subcontractor **and logs exactly which records it corrected** (company/old-name/new-name) on every server start — the only way to audit affected prod records without DB/log access. Reproduced end-to-end against a rebuilt local `:8080`: created a contact, corrupted its mirror row directly via SQL, confirmed both the Team tab and invite-surname bugs fired exactly as reported, then verified the read-time fix corrects the display/invite immediately (before any restart) and the boot migration corrects the underlying row on restart (logged `correcting 1 drifted primary-contact name(s)` with before/after). `pnpm run typecheck` clean, `check:layout` 96/96. **DEPLOYED** — swept into a Replit "Published your App" checkpoint the user triggered mid-session (commit `1c0f8a3`, tied to a real `Deployment-Build-Id`) before Claude's own `git commit` ran; content was identical either way. Pushed to GitHub same batch as #78 (`main → 63c2a744`). **User confirmed fixed** (2026-07-20) against the real Amy Parrish record after Claude flagged it couldn't verify directly (no login for her company).

80. **Fix uncaught chunk-load crash after a deploy (invite-accept set-password page)** — a brand-new portal member's account/password saved successfully, but the client-side redirect into `/portal/overview` right after crashed into the error boundary, unrecoverable by either "Try again" or "Reload page". Root cause: the browser tab had an older bundle loaded (this session did several Publishes back-to-back while the user tested on their phone); a lazy route's chunk is fetched by an exact hashed filename baked into the already-loaded bundle, and Vite doesn't keep old-hash files around after a rebuild — the dynamic `import()` for `/portal/:section` 404'd with `TypeError: Failed to fetch dynamically imported module`, uncaught past any component `try`/`catch`, straight into the top-level `ErrorBoundary`. Investigated as **two separate bug reports that turned out to be one**: an initial "invite creates but crashes" report (tested 8+ ways — in-house/subcontractor, fresh/re-invite, prompting flow, mobile viewport/UA — all clean, no repro) was superseded by the user's follow-up precisely isolating it to the **set-password page specifically**, which reproduced immediately once targeted. Fixed with the standard pattern for this exact class of bug: `App.tsx`'s new `lazyWithRetry()` wraps every lazy route — a failed chunk load triggers exactly one automatic `window.location.reload()` (fresh `index.html` → current chunk hashes → self-heals), guarded by a `sessionStorage` flag so a genuinely broken chunk doesn't reload-loop forever and clearing on the next successful load so a later real deploy can still trigger one more auto-reload. `error-boundary.tsx` is a second line of defense: `"Try again"` now detects a chunk-load-error-shaped message and force-reloads instead of just clearing React state (which can't fix a broken module reference). The portal-invite-accept token/session was already being saved to `localStorage` *before* the crash in the old code, so no auth/redirect fix was needed once the chunk-load itself was handled — confirmed a fresh member lands logged into the portal with no crash. Confirmed the already-used-invite-link case was already handled correctly (clean "already used, log in" message, no crash) — no change needed there. Reproduced precisely via Playwright request interception (fail only the *first* fetch of the section chunk with a 404, let retries through) both before and after the fix — before: error boundary, uncaught `TypeError`, full stack captured; after: one silent auto-reload, clean landing in the portal, zero console/page errors. `pnpm run typecheck` clean, `check:layout` 96/96 at 360/768px (this page is mobile-first). Also cleaned up an FK-chain gap surfaced while clearing session test fixtures: an *archived* (not hard-deleted) `people` row still holding `user_id` blocked the orphaned-portal-user purge tool the same way `photos.uploaded_by` did in #78 — same root pattern (a soft-deleted record's FK survives it), fixed ad hoc via direct SQL on the workspace dev DB (test data only, not a prod-facing gap since prod's `hasAnyHistoricalFootprint` archive-not-delete behavior is itself correct; only test cleanup hit it repeatedly). **DEPLOYED** — swept into a Replit "Published your App" checkpoint (`main → 7a4248f`) before Claude's own `git commit` ran, same pattern as #77/#79; pushed to GitHub (`main → cc5916b1`).

## Session Log full detail, 2026-07-17 through 2026-07-20 (condensed to summaries in CLAUDE.md, 2026-07-21)

- **2026-07-20 (6) — stale-chunk crash on invite-accept (#80), end of session:** User's first report ("invite crashes into an error boundary") did not reproduce despite 8+ real-flow attempts (in-house, subcontractor, re-invite, prompting/lazy-create, mobile viewport+UA — all via a rebuilt local `:8080`). User's precise follow-up ("confirmed invites succeed; it's the SET-PASSWORD page that crashes, right after account activation") immediately pointed at `/portal/accept/:token`'s redirect into `/portal/:section` — reproduced on the first targeted attempt via Playwright request interception. Root cause was environmental, not a data/logic bug: this session ran several Publishes back-to-back while the user tested on their phone, and a stale-loaded bundle's lazy-chunk reference 404s once a deploy replaces the hashed filename. Fixed generally (`lazyWithRetry` in `App.tsx`, applies to every lazy route, not just portal ones) rather than special-cased to this one page. Also fixed a same-shape orphaned-record FK gap found while cleaning up test fixtures (`people.user_id` this time, not `photos.uploaded_by` like #78) — direct SQL on the workspace dev DB only, not a prod-facing issue. Committed via the user's Publish sweeping it into a Replit checkpoint commit before Claude's own `git commit` ran (now the established pattern this session — Claude checks `git log`/`git show --stat` after being told "published" rather than assuming its own commit is what landed). Pushed to GitHub (`main → cc5916b1`). Session wrap-up: #77 (minimal-portal), #78 (site-issue archive/delete), #79 (stale-name fix), and #80 (chunk-load crash) all shipped, deployed, and pushed same session; #77 and #79 user-confirmed live-working.
- **2026-07-20 (5) — stale mirrored contact name bug (#79) + wrap-up:** User reported a real display/data-source split (not bad data, their words) — "Amy Parrish" correct in Contacts, showing as "Amy I Cloud" (the company name) on the project Team tab, with portal invite failing "add a surname" despite a real surname on file. Diagnosed and fixed as **#79** (see above) — root cause was a conditional copy-on-write mirror (`people.name` synced from `subcontractors.contactName` only when `is_primary_contact` matches) that had silently drifted stale. While this was being built, the user Published via the Replit UI mid-session; Replit's own checkpoint commit (`1c0f8a3`) swept in the already-written fix files before Claude's own `git commit` ran — same content either way, confirmed via `git show --stat`. The earlier GitHub push for #78 had failed on a GitHub API rate limit (403s cascading into a failed tree creation); retried later in the session and succeeded (`main → 63c2a744`, carries both #78 and #79). Could not personally verify the fix against the real "Amy Parrish" record — she's under a company Claude has no login for — left for the user to confirm directly.
- **2026-07-20 (4) — site issue archive/delete (#78), triggered by a prod cleanup request:** User asked to fully clean up a throwaway test person on prod (left over from #77's verification). Person + membership deleted cleanly, but the underlying portalOnly `users` row was orphaned and the sanctioned purge tool (`DELETE /portal-users/:userId`) failed — root-caused to a `photos.uploaded_by` foreign key from the test site-issue logged during verification, and there was genuinely no delete endpoint for photos/site-issues anywhere in the app. Reported the exact blocker rather than improvising a raw DB connection to prod (no established access path, and it would've bypassed the app's own safety rails). User chose to build the capability properly rather than a one-off fix, with an explicit design constraint: soft-delete (archive) for the manager-facing path since site issues are audit trail, genuine hard-delete reserved for a separate admin-only action. Built as **#78** (see above). Realized mid-build that finishing the ORIGINAL cleanup requires logging in as an admin-allowlisted account (`dean.parrish@me.com`/`amy-parrish@hotmail.co.uk`) — Claude doesn't have those credentials (correctly, by design) — so the leftover prod photo `a8822ff0-2225-4a3a-86cc-d84921d55f72` and the orphaned `prodperm-test-user@example.com` account are still there, left for the user to clear via the new Admin → Danger Zone once deployed. Committed (`main → 6e6f11d`) at explicit request; push/Publish pending same conversation.
- **2026-07-20 (3) — Minimal-by-default Team Portal (#77):** User directed a two-part portal permissions redesign, given via the "Other" free-text option on a clarifying question rather than open prose. **Step 0 investigation first (as instructed) before building**: found the write-permission backend AND a Team-tab UI already existed (`project_members.canLogIssues/canUpdatePlantMaterials/canEditDailyReport`, `requirePortalPermission` middleware, `PATCH .../permissions`, a dropdown on each portal-member pill) — only visibility gating was missing, GET endpoints were ungated. Reported this before writing any code, per the user's explicit ask. A second clarifying question was needed mid-task: the user's literal 5-section "minimal default" spec conflicted with #65's confirmed/deployed per-type nav tabs (H&S/Drawings/Method Statements/Permits/Safety/General) and #75's deliberate "Daily Report visible to everyone" decision — asked whether minimal-default meant only the 3 write-permission sections or literally everything else too; user's answer (retire the 6 doc tabs into a filtered "Shared with me", keep Progress/My documents/Settings always-on, gate the 3 write-permission sections) is what got built. See **#77** above for the full technical description. Caught two scope gaps during implementation that weren't in the user's spec but would have been silent regressions: (1) site notes (`dailyNotesTable`) lived on the same now-retired "General" tab as general documents — folded a full notes history into "Shared with me" so it wasn't lost, not just the latest-5 already shown on Overview; (2) the "Shared with me" aggregate and `computeUnseen` badge counts would have kept surfacing site-issue/plant-item existence to members without the matching grant even with the section itself hidden — gated those server-side too. Full e2e verified against a rebuilt local `:8080` (see #77); test fixtures cleaned up after. `pnpm --filter @workspace/db run push` applied the new column default to the workspace dev DB. Committed (`main → 1ad4675`), CLAUDE.md updated (`main → 08ebe28`) — both at the user's explicit request. **Later same session**: user Published via Replit UI and asked to push to GitHub; pushed via `push-robust.ts` (`main → 91d6d53c`, 679 files, 7 oversized assets skipped as usual) and independently re-verified since `verify-push.ts`'s hardcoded checklist is stale (predates this feature). Repeated the full e2e test live against prod (`paul@acme.com`, a real project) — same result as local: minimal default, all-false/403, grant→unlock→log→PM-visible→revoke→re-403 cycle confirmed; test fixtures cleaned up on prod.
- **2026-07-20 (2) — BUGFIX: valid 2-letter names ("Jo Ng") rejected on subcontractor edit:** Root cause confirmed by direct reproduction against a rebuilt local `:8080` (a live PATCH with `contactFirstName:"Jo", contactLastName:"Ng"` failed; the exact same request succeeded once one unrelated field was omitted): `UpdateSubcontractorRequest.reliabilityRating` (`openapi.yaml`) was `type: number` with no `nullable: true`, but the edit form (`subcontractors/index.tsx`'s `onEdit`) always sends `reliabilityRating: null` when the rating field is empty (the common case — none of the demo subcontractors have one set) — Zod's `.optional()` doesn't accept `null`, so the WHOLE `safeParse()` failed on an unrelated field, and `subcontractors.ts`'s catch-all error message ("a first name and surname must be at least 2 characters each") misdiagnosed it as a name-length problem even though the names were perfectly valid. **None of the 3 hypotheses the user asked to check (off-by-one `>2` vs `>=2`, missing trim-before-check, mismatched client/server thresholds) were the actual cause** — every existing `.min(2)`/`length >= 2` site already used correct `>=2` semantics, and client/server thresholds already matched. Fixed the real bug: added `nullable: true` to `reliabilityRating` in `openapi.yaml` + reran codegen. Also implemented the explicitly-requested defensive hardening regardless (closes a real but different latent gap — whitespace-only input like `"  "` has raw length 2 and was passing `.min(2)` before being trimmed to empty for storage): every create/edit route for `people`/`subcontractors` (`people.ts` ×3, `subcontractors.ts` ×2) now trims first, THEN re-checks length, with a clear "whitespace doesn't count" message on failure. Client-side `subcontractors/index.tsx`: replaced raw RHF `minLength: 2` (which only validates the untrimmed value) with a shared `validateContactName()` matching the server rule; trimmed values before submit; and fixed a real silent-failure bug — the **edit** dialog's `useForm` never destructured `formState: { errors }`, so a client validation failure (e.g. editing a legacy empty-surname record like "test"/Test SiteSort without touching the surname field) produced NO visible feedback at all, just a Save button that silently did nothing. Verified end-to-end against the fresh local build: "Jo Ng" now saves; `"  Amy  Parrish  "` saves and stores trimmed as "Amy"/"Parrish"; whitespace-only surname correctly rejected with the new clear message. `pnpm run typecheck` clean, `pnpm run check:layout` 96/96. **Caught and fixed a testing mistake mid-session**: an early reproduction accidentally live-PATCHed the real "Terry Pipes"/PlumbRight demo record to "Jo Ng" — caught immediately and reverted (name + trades + company restored exactly; the contact email couldn't be recovered exactly since it wasn't logged anywhere beforehand, so it was reset to `terry@plumbright.co.uk` to match this workspace's established `firstname@companyslug.co.uk` demo-email convention — flagged here in case the original differed). **DEPLOYED+prod-verified** (2026-07-20, user Published via Replit UI; health-checked OK post-restart — `uptime` reset to 49s; live prod write-path test via `paul@acme.com` confirmed the fix: a throwaway "Jo Ng" contact PATCHed with `reliabilityRating:null` — the exact previously-broken shape — now succeeds, and a whitespace-only surname is still correctly rejected; throwaway record hard-deleted after).
- **2026-07-20 — surname-data audit + validation hardening:** Feature #74's backfill (naive `split_part(name, ' ', 1)`) left some legacy `people`/`subcontractors`/`users` rows with an empty surname or a company name typed into a person-name field. Audited workspace DB directly via SQL: found 3 empty-surname records needing manual correction ("test"/Test SiteSort person+subcontractor mirror, and dashboard users "Amy" `amy-parrish@hotmail.co.uk` / "Bob" `bob@betabuilds.com`, both created via the unvalidated `/users` route) — listed for Dean, none auto-fixed. Assessed 2 near-matches (ActiveLink Ltd/"Active Link", Connie Contractor Ltd/"Connie Contractor" ×2) as ambiguous — plausible eponymous demo names, not confirmed corruption — left for manual judgment rather than force-fixed. Fixed the doubled-name-line display bug unconditionally (`team-tab.tsx`'s `companySubline()`, `subcontractors/index.tsx`'s `showCompanySubline()`) — a lone primary-contact card no longer repeats the person's name as a fake "company" subheading when the two strings match. Closed the real validation gap: `people.ts`/`subcontractors.ts` already Zod-enforced first+surname (min 2 chars each) on every create/edit path, but `POST/PATCH /users` (dashboard "Add Team Member"), `POST /auth/register` (`adminName`), and the legacy `POST /auth/invite/:token/accept` had zero name validation — exactly how "Amy"/"Bob" were created. Added `artifacts/api-server/src/lib/name-validation.ts` (`parseFullPersonName`, plain regex — no new `zod` dependency needed in `api-server`) and wired it into all three; `companyName`/`adminName` split so only the person field is held to the rule. Mirrored client-side in `register.tsx` (already had `zodResolver`, tightened the schema) and `team/index.tsx` (`isFullName()` gate on the Add Team Member submit button). Documented the real contract in `openapi.yaml` (`InviteUserRequest`/`UpdateUserRequest`/`RegisterRequest` descriptions) without touching orval-generated Zod (untested pattern→regex codegen path in this repo; kept enforcement in hand-written validators instead, consistent with how these routes already worked). Confirmed the portal-invite gate (`people.ts:454`, blocks a portal invite when `!person.lastName?.trim()`) can now only ever fire against pre-existing legacy data — every live path that creates a `people` or `users` row is validated. Smoke-tested against a rebuilt local `:8080` (single-word name → 400 on `/users` and `/auth/register`; full name → 201, then cleaned up). `pnpm run typecheck` clean, `pnpm run check:layout` 96/96 at 360px+768px. No DB writes made to any flagged record — audit is report-only per the user's explicit instruction not to auto-guess surnames. **DEPLOYED+prod-verified** (2026-07-20, same Publish cycle as the bugfix above — see that entry for the health-check/prod-verification detail; both commits shipped together).
- **2026-07-19 — end-of-session wrap-up:** **#75** and **#76** (above) shipped and fully prod-verified. `check:layout` 94/94 then 96/96 at 360px+768px, zero failures. Working tree clean, nothing outstanding — PD test backlog below is the only known open work.
- **2026-07-19 (2)–(5):** Built **#73** (Plant & Materials + issue closure reasons), **#74** (person-first contacts: self-employed + certifications + Team tab restructure), **#75** (Daily Report in Team Portal + shared dictation + plant attachment counts), **#76** (Team Portal Messages: project-scoped DMs, channel access, PM oversight). All committed, pushed, Published, and prod-verified same day.
- **2026-07-17:** Responsive sweep #2 (shared `<PageHeader>`/`<ListRow>` components + `pnpm run check:layout` Playwright audit, 176/176 passed, published+prod-verified); #70/#71 alert-viewer + remove-people/archive/name-split (published+prod-verified); F6 contact documents #69 (published+prod-verified); #68 Web Push follow-up closed out on prod (Android/iPhone push test still outstanding).

## Archived session one-liners (moved from CLAUDE.md)
- **2026-07-15 (DEPLOYED+prod-verified):** **Team Portal sharing (all/trade/individual) + gated portal visibility** = Feature **#65** (`portal_shares` rule table; safety-open exception; clean-slate migration; 6 bespoke share dropdowns unified; Site Board QR-persist + pinned-docs fix). 16/16 API e2e + UI checks passed live.
- **2026-07-15 (DEPLOYED+prod-verified):** **Deep-links for actionable/to-do items** = Feature **#64**. Shared `<LinkRow>` (`components/ui/link-row.tsx`); controlled tabs in `projects/detail.tsx` (`openTab()` + `?tab=&…` + section anchors); dashboard/close-out/finances rows retargeted to filtered `?param` deep-links; destination readers on compliance/invoices/projects/issues/checkins/messages. Verified headless 360/1024px.
- **2026-07-14 (both DEPLOYED+prod-verified):** (1) **Per-person Team Portal invites** = Feature **#63** — restructured #61's invite to per-**person**: new **`people`** table (one row/human; `subcontractor_id` set = works for that firm, NULL = in-house; every portal member is portal-only, no dashboard) + `person_id` FK on `project_invites`/`project_members`. ONE invite path `POST /projects/:id/portal-invites {personId}` → `portalOnly` user + membership; `/portal/login` 403s dashboard accounts. Team tab **People** section per sub card + **In-House Portal Access** panel (invite/copy-link/status/revoke); CRUD `/subcontractors/:id/people`, `/projects/:id/in-house-people`, `DELETE /people/:id`; shared `portalStatusFor`. Manager-gated; OpenAPI+codegen. (2) **Messages badge/list mismatch** — badge counted DMs across ALL companies vs company-scoped list (#57) → shared `unreadDmFilter`/`isUnreadDmRow` (`routes/messages.ts`) + `sitesort:messages-read` refresh (badge = DMs only).
- **Feature #61 full detail — Team Portal (DEPLOYED+prod-verified; invite model since restructured per-person → #63):** invite-based per-project member access + activity audit. Single-use sha256-hashed 7-day `project_invites` token as copyable link; accept (`/portal/accept/:token`) sets password → `users.portalOnly=true` account + `project_members` row (partial-unique `(project_id,user_id)`). **Containment (server-side):** separate `/portal/login` → portal-scoped JWT `{scope:"portal",projectId}`; `authenticate` 403s+audits any portal token on a non-`/api/portal/*` route; main `/auth/login` 403s `portalOnly` (`use_portal`); `requirePortalMember` re-checks membership each request (revoke = delete row → instant 403). **Portal UI** (`pages/portal/`, mobile-first `PortalLayout`, token in `sitesort_portal_token`): read-only sections (Overview/Progress/Team/Site Issues/Site Board/H&S/Drawings/Method Statements/Permits/Safety/General; docs by `type`, issues by `photos.category`, H&S = method-statements+safety+permits hub). **Audit:** every section-open/doc-view (+blocked) auto-logged to `activity_log` by `autoLogPortalActivity` middleware; PM gets live feed + per-member summary + filters + Overview glance strip. Routes: `routes/portal.ts`, `routes/team-activity.ts`. Schema (`ensure-schema.ts`): `project_invites`, `activity_log`, `users.portal_only`, `project_members` partial-unique.
- **2026-07-11 — PROD 502 FIX (DEPLOYED):** pg `Pool` lacked an `'error'` listener → restart loop → 502; fixed + `GET /api/health`.
- **Feature #62 full detail — Daily Site Reports hub (F5), DEPLOYED+prod-verified:** company-wide `/daily-reports` page + editable structured **site diary** with voice-to-text. **Model:** one report/project/day = immutable auto snapshot (18:00 job) **plus** editable `manager_report` jsonb (7 optional fields: weather/labourOnSite/plantEquipment/workCompleted/delaysIssues/deliveries/hsNotes) + `authored_by`/`authored_at`/`auto_generated`. Authoring early **creates the row** (`data` empty, `auto_generated=false`); the generator fills auto data **once** via `onConflictDoUpdate … setWhere(auto_generated=false)` (notifies once), narrative preserved; catch-up re-runs no-op → snapshot immutable. **Endpoints** (raw `fetch`, `isInternal`+tenant-scoped, `routes/reports.ts`): `GET /api/daily-reports` (all projects; `?projectId/from/to`; `hasManagerReport` flag); `PATCH /api/projects/:id/daily-reports/:date` (upsert diary; caps 5k/drops unknown keys; all-blank clears an existing row, never creates a hollow one); `GET /daily-reports/:id` adds `managerReport`+`authorName`+`authoredAt`. **Shared UI** `components/daily-report-detail.tsx` (view+edit+`DictationButton`=Web Speech API, mic on the 4 free-text fields only, auto-hides where unsupported) reused by the hub AND the project-detail Daily Reports tab. `daily_reports`+`daily_notes` base tables `CREATE TABLE IF NOT EXISTS` in `ensure-schema.ts` + F5 cols.
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
- **2026-07-15 (committed/deployed via Publish):** Feature **#67** portal session policy (sliding-30d/12h-inactivity/server-revoke, `portal_sessions`) + logo→home. Sharing "bug" NOT reproducible (engine verified working live).
- **2026-07-15 (DEPLOYED via Publish — code-verified):** Feature **#68** portal freshness (RQ refetch/60s poll/superseded-at-open) + unseen nav badges + "Shared" NEW pills + **Web Push** (VAPID, `push_subscriptions`/`pending_pushes`, batched triggers, in-context permission card w/ iOS install-chaining, Settings toggle). Deploy confirmed live (new routes 401 not 404; SW push handlers present; ensure-schema created tables). **UI verified zero-overflow @360px+768px** (7 portal sections, no console errors). No new issues found. Full technical detail: **(P1)** own RQ client (`pages/portal/query-client.ts`: refetchOnMount/Focus, staleTime 0) + `visibilitychange` invalidate (PWA-safe); Drawings/Site-Issues/Overview/General/Shared poll 60s; opening a doc re-checks live status (`fetchFreshDoc`→superseded/removed toast); SW excludes `/api`. **(P2a)** `GET /portal/unseen` per-section counts vs `activity_log` last-view (`autoLogPortalActivity` logs on `res.finish` → visit compares vs PRIOR view) → nav badges; "Shared" annotates `unseen`/`sharedAt`, newest-first, sticky NEW pill/visit. **(P2b)** `web-push` VAPID (`lib/web-push.ts`; secrets `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`, graceful-off if unset); `push_subscriptions`(per device)+`pending_pushes`(batch) in `ensure-schema`; SW `push`+`notificationclick` deep-link (login-return via `?next`); subs deleted on logout+revoke. **(P2c)** never prompts on load — `PortalNotifyPrompt` from 2nd session, prompt only on Enable tap; denied→Settings, no nag; iOS-not-installed→install-first + "Maybe later" (≤1/wk); portal Settings toggle. **(P2d)** doc-shared→member, daily-note/safety→all members; batched (`PUSH_DEBOUNCE_MS` 90s→one "N new documents"). iOS push needs installed PWA 16.4+.
- **2026-07-17 (VERIFIED live on prod):** Feature #68 Web Push follow-up closed out — `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` confirmed present in Replit Secrets, app republished, then verified end-to-end on prod via a real portal login: `GET /api/portal/push/public-key` returns the real key (non-null) and portal Settings shows the push-enable toggle. Verification created real test data (an in-house test person/portal account under Acme Construction) which was fully cleaned up after — project membership removed, portal test user deleted; one leftover dashboard-only test user (`pushverify-check@example.com`) had its project membership stripped but can't be fully deleted (no delete endpoint exists for non-portal-only users — noted as a gap, not urgent). Real Android + installed-PWA iPhone push test (app-closed delivery, 3-doc batch, revoke=no-push) still outstanding — headless verification can't substitute for this.

## 2026-07-19 session archive (moved from CLAUDE.md)

- **2026-07-17 (responsive sweep #2):** Fixed 3 confirmed mobile squash/overlap bugs in `projects/detail.tsx` (H&S tab header, Finances & Expiry permit/document rows, Check-ins tab header — all were hand-rolled `flex items-center justify-between` without `flex-wrap`/`flex-col sm:flex-row`). Built shared `ui/page-header.tsx` (`<PageHeader>`) + `ui/list-row.tsx` (`<ListRow>`/`<PillGroup>`/`<Pill>`) and migrated every page's header to `<PageHeader>` (dashboard, projects, contacts, team, invoices, compliance, messages, notifications, settings, qr, daily-reports, issues, checkins + all fixed detail.tsx tab headers). Built `scripts/src/check-layout.ts` (`pnpm run check:layout`) — Playwright audit rendering every route + project-detail tab + portal section at 360/390/768/1024px, failing on horizontal overflow or `data-ll="pill"`/`data-ll="actionbar"` overlap; **176/176 passed** on the full 4-breakpoint sweep against a locally built `:8080`. Typecheck ✅. Added the permanent CLAUDE.md rule above. *(One hazard found and fixed: the shared `APP_URL` env var in this workspace points at prod — the script deliberately ignores it and refuses to run against anything but localhost, since it writes test fixture data via the API. An early run before that guard existed created + was cleaned up off prod.)* Committed `8754883`, pushed to GitHub `main → fb4edb9d`. **Published + prod-verified**: H&S, Finances & Expiry, and Check-ins tabs all confirmed stacking correctly at 360px on www.sitesort.co.uk.
- **2026-07-17 (later):** **#70/#71** alert-viewer + remove-people/archive/name-split, 4 phases (see feature list), each verified before the next. Published to prod; live-verified via headless browser on www.sitesort.co.uk (AlertViewer dialog, Team-tab Remove button, Contacts Archived filter all confirmed working).
- **2026-07-17:** **F6** contact documents (#69) — built, dev-verified, published, and confirmed live on prod (read-only GET check). Feature #68 Web Push follow-up closed out on prod (VAPID secrets confirmed, verified via real portal login); Android/iPhone push test still outstanding.

## Feature list full detail moved from CLAUDE.md (2026-07-19)

- **Feature #67 full detail — Portal session policy + logo nav:** (a) **Server-side portal sessions**: `portal_sessions` table (`ensure-schema.ts`); portal JWT carries only `sid`. `lib/portal-sessions.ts` + `requirePortalSession` (in `portalGuards`, before `requirePortalMember`) enforce **sliding-30d** (active request bumps `expires_at`, throttled 1/min), **12h-inactivity** (idle→`revoked_at`+401 `reason:inactive`), **`POST /api/portal/logout`** (server-revoke; `portalLogout` calls pre-clear). Sessions made at login + invite-accept. **Dashboard revoke** (`team-activity.ts`) also `revokePortalSessionsForMember` (membership re-check = backstop). Browser/PWA close does NOT end a session (localStorage + server session); pre-policy tokens w/o `sid`→401→one-time re-login. (b) **Portal logo** (`portal/layout.tsx`) → `<Link href="/portal/overview">`. **Sharing "bug" NOT reproducible** (verified live: 3 audiences × sub+in-house, invite→accept→share→view, safety exception all work) → operational or stale deploy. Typecheck ✅; session 7/7 e2e ✅. **NOT deployed.**
- **Feature #69 full detail — F6 subbie/merchant contact documents:** versioned docs on a subcontractor/merchant contact (`subcontractor_documents`: `subcontractorId` NOT NULL, `projectId` nullable — null = company-wide base doc, set = per-project extra; mirrors #45's notes shape). Types: `terms | tax_form | certification | id_verification | other` (insurance stays in its own feature). `routes/subcontractor-documents.ts`: `GET/POST /subcontractors/:id/documents` (`?projectId=` optional; upload auto-supersedes same-name+same-scope current doc, chain mirrors the project document hub), `PATCH .../:id`, `GET .../:id/revisions`. Upload/edit manager-gated. Documents dialog on the Contacts directory (general docs) + a matching dialog on project Team tab (defaults project scope, shows general+project docs together). OpenAPI+codegen. Typecheck ✅; 8/8 browser-verified steps, zero console errors. **DEPLOYED+prod-verified** (2026-07-17, read-only GET check on live prod).
- **Feature #71 full detail — Remove people from projects + archive/hard-delete contacts + first/last name split:** `activity_log`/`document_distributions`/`acknowledgment_audit_log` hold LIVE FKs to `users.id` (no name snapshot except audit log) → removal must never touch those rows. **(a) Remove from project**: `DELETE /projects/:id/members/:memberId` (now manager-gated, was wide open) + new `.../members/company/:subcontractorId` hard-delete only the `project_members` link (reusing `revokePortalSessionsForMember`+invite-cancel from invite-revoke); `people`/`users` untouched → history survives. "(removed from project)" marker = read-time `NOT EXISTS` on `project_members` (no new table), on activity feed/distribution list/sign-off log. New Remove+confirm UI on project Team tab. **(b) Archive/hard-delete**: `archivedAt` on `subcontractors`+`people`. Delete blocked (400, names project) if on an active project; zero-footprint-anywhere → hard-delete; any footprint → archive. Lists default `archivedAt IS NULL`, `?archived=true` for new Contacts "Archived" filter+Restore. **(c) Name split**: nullable `firstName`/`lastName` (people) + `contactFirstName`/`contactLastName` (subcontractors); idempotent backfill splits on first space (empty surname → badge). Zod `min(2)` on every write; portal invite blocked if surname empty. Computed `name`/`contactName` kept for compat; sorts by surname. Manager-gated, no portal exposure. OpenAPI+codegen. All verified end-to-end via API + real browser. **DEPLOYED+prod-verified** (2026-07-17, Remove button on project Team tab + Archived filter on Contacts confirmed live on www.sitesort.co.uk).

## Feature #72 full detail (reconciled into CLAUDE.md 2026-07-19)

- **Feature #72 full detail — Portal-audit fixes + contractor self-upload docs + mobile/PWA:** shipped via commit `1a49a54` (2026-07-17 18:59, an off-workflow "Replit Agent" session, not previously logged in CLAUDE.md — found + reconciled 2026-07-19). Portal session inactivity policy changed from #67's original 12h idle-revoke to 30-day (== sliding window, so idle workers over a weekend aren't booted). Drawing single-doc + zip download-all (`archiver`, streamed from GCS); `supersededBy` resolution shown on doc detail so a member viewing a superseded doc is pointed at its live replacement; blocked-checkin alerts to managers (not-registered / no-valid-insurance reasons); tradesperson-add tenant-scope check (project must belong to caller's company) + 409 dedupe on duplicate contact (same company+contact name already on project). New contractor **"My documents"** self-upload: `portal_member_documents` table (id/projectId/userId/personId/name/fileUrl/fileSize/kind/status/reviewNote/reviewedAt), multer→GCS upload with strict MIME+extension allowlist (PDF/PNG/JPG/WebP/HEIC/Word/Excel only, 15MB cap — no HTML/SVG to avoid stored-XSS), manager list + approve/reject endpoints + notification on upload, surfaced as a "Documents for review" card in the project Team Portal tab with pending badge. Upload-serving hardened in `routes/upload.ts`: HTML/SVG/XML/JS content-types forced to `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` regardless of upload source (stored-XSS guard on `/api/uploads/:filename`). Portal frontend: authed download buttons, download-all button, "Open latest" toast for superseded docs, What's-new card on Overview, My documents view with upload form, touch-friendly sizing, Add-to-Home-Screen install card in Settings (iOS instructions / Android install prompt). Commit message claimed "clean typecheck" but shipped a real gap — fixed 2026-07-19: `lib/api-zod/tsconfig.json` was missing `"dom"` in its `lib` array (broke on generated `File`/`Blob` refs in `UploadPortalMyDocumentBody`'s zod schema) and that same type was ambiguously double-exported from `lib/api-zod/src/index.ts` via the `export *` wildcard colliding with the explicit-export list (same pattern already used to resolve `ListDocumentsParams` etc. — just needed adding to that list). Fix matched the existing pattern in `lib/api-client-react/tsconfig.json` which already had `"lib": ["dom", "es2022"]`. `pnpm run typecheck` clean across all workspaces after the fix. **Confirmed live** on `www.sitesort.co.uk`: `GET /api/portal/my-documents` and `POST /api/portal/logout` both return 401 (not 404), proving the routes exist in the deployed build.

## 2026-07-19 detailed session log (#72–#76 build sessions, moved from CLAUDE.md 2026-07-20)

- **2026-07-19 (5):** Built **#76** (Team Portal Messages) from a long, precise 4-part user spec covering scoping, enforcement, unread/push, and PM conduct/oversight. Given the scale, ran a full research → plan-mode → implement cycle: two parallel Explore agents mapped the existing messaging system and the portal's shared infrastructure (middleware, `computeUnseen`, push, activity log, `removedFromProjectUserIds`), then a Plan agent produced a detailed file-level plan which was cross-checked by reading the actual route files myself before finalizing. Surfaced two real product trade-offs to the user via `AskUserQuestion` before writing code rather than guessing: (1) whether immutability should lock all project messaging including today's dashboard channel edit/delete, or only newly-portal-visible conversations — user picked the simpler/stricter "lock everywhere"; (2) portal composer v1 scope (text+reactions+read-receipts vs full dashboard parity) — user picked the minimal option. Caught and fixed a real regression risk mid-implementation: the shared `lib/messaging.ts` send functions were initially text-only, which would have silently dropped the dashboard's existing invoice/attachment-sharing support (#32/#33) had `POST /messages`/`POST /channels/:id/messages` delegated to them as originally planned — added the optional invoice/attachment/reply-to fields back so dashboard callers get full parity while portal callers just omit them. Also caught two response-ordering bugs (marking messages read *after* `res.json()` had already been sent, risking a "headers already sent" crash on a subsequent DB error) before they shipped, and a preview-text regression (channel messages with no text content losing their attachment-type fallback like "📄 Document" in notifications). Hit the known orval codegen ambiguous-export footgun again (`GetPortalDmThreadParams`, same shape as #72's) — fixed via the established explicit-re-export pattern in `lib/api-zod/src/index.ts`. `pnpm run typecheck` clean throughout, `pnpm run check:layout` 96/96. Extensive verification: direct API calls proved cross-project isolation (created a real two-project person, sent DMs from each project's portal, confirmed total isolation both in-portal and on the PM's dashboard), non-participant/revoked-session denial, immutability 404s, the oversight audit-log row landing in `activity_log`, and the shared unread counter incrementing/clearing correctly — plus a real-browser pass on both the portal Messages section and the new dashboard oversight tab, zero console errors. All test data (a throwaway two-project person, test messages/reactions, audit rows) cleaned up via direct SQL afterward, since project-scoped messages have no delete API by design now. Committed `727f029`, pushed `main → 0579fbb2` (verified against GitHub raw content). User Published via Replit UI; ran the full production write-path test (throwaway two-project test person, dummy-domain portal invites accepted via direct API) confirming cross-project isolation, oversight, and immutability all hold on live prod, plus a real-browser pass with zero console errors. Health-checked OK post-restart. Two harmless "PROD TEST" DM rows are permanently stuck in Paul's live Messages list as an intentional consequence of the immutability feature (no delete path exists by design) — user confirmed leaving them.
- **2026-07-19 (4):** Resumed session found a large, coherent, already-implemented-but-uncommitted feature (Daily Report in the portal + shared dictation button + plant attachment counts) sitting in the working tree with no CLAUDE.md entry — likely an interrupted prior session rather than off-workflow, but treated with the same reconcile discipline. Reviewed every diff file-by-file before touching anything. `pnpm run typecheck` was already clean; ran it anyway to confirm. Found one real gap during review (not just verification): `routes/team.ts`'s `GET /members` + the `ProjectMember` OpenAPI schema didn't serialize the new `canEditDailyReport` field though the PATCH route already accepted it — fixed both, reran codegen + typecheck clean. Full local rebuild+restart (`PORT=8080` explicit — the env var isn't set outside the Replit-managed workflow shell, unlike prior sessions where it was inherited), `pnpm run check:layout` 94/94, then real end-to-end browser verification of the actual write/read/lock paths (not just page-loads) using the persistent `layout-checker@sitesort.test` portal fixture and direct API calls (via paul's JWT) to toggle the permission — confirmed add→save→contributor-attribution, history, and the permission-denied read-only state all work with zero console errors. Added **#75**. Committed `13b89a8`, pushed `main → 395419ce` (verified). User Published via Replit UI; health-checked OK post-restart (`uptime` reset, new/changed routes return 401 not 404).
- **2026-07-19 (3):** Built **#74** (person-first contacts: self-employed + certifications + Team tab restructure) from a detailed two-part user spec, planned via plan mode first (two AskUserQuestion clarifications: Notes/Docs stay company-scoped launched from the person card; and — the pivotal one — the "Add from Contacts Directory" flow itself had to flip to person-first so every added person gets a real, independently-removable project link immediately, not just portal-accepted ones). Schema: `people.is_primary_contact` + backfill, `person_certifications` table, `self_employed` added to the `contactType` enum (openapi.yaml + codegen). Backend: `POST /projects/:id/members/person`, `GET /api/people`, `/people/:id/certifications` CRUD, `runPersonCertReminders`, Compliance Centre `expiringCertifications`. Frontend: Contacts directory self-employed form + cert repeater, flipped directory picker, full Team tab card restructure (company strip + person cards + inline add-person/add-cert), portal share picker labels. `pnpm run typecheck` clean throughout (fixed as introduced: stale `@workspace/db`/`@workspace/api-zod` builds needing `typecheck:libs` first, a `zod.date()` vs plain string OpenAPI footgun for date fields, JSX type-narrowing false positive). `pnpm run check:layout` 92/92. Extensive real-browser verification against a local single-origin `:8080` build (rebuilt + restarted manually mid-session — `pnpm --filter @workspace/api-server run dev` is a one-shot build+start, not a watcher, so it doesn't pick up changes on its own): flipped picker, two-person company add/remove flows (confirmed independent removal + confirmation naming both people), self-employed contact + cert (Compliance Centre + amber badge), person cert on an employed contact. Cleaned up all test data afterward. Committed `7dc5a5e`, pushed `main → 2f19a511` (verified against GitHub's raw content directly). User Published via Replit UI; health-checked OK post-restart (`uptime` reset, `GET /api/people` + certifications endpoint live, primary-contact backfill confirmed correct on real prod subcontructor rows). **Lesson:** the local dev API server needs an explicit rebuild+restart after backend changes — it is not a file watcher.
- **2026-07-19 (2):** Found commits `dbc9c00`+`2fd0f7c` (off-workflow "Replit Agent" session, same day) shipped Plant & Materials tracking + site-issue closure reasons, undocumented. Reconciled: added **#73**. `pnpm run typecheck` was already clean (no fix needed this time). Verified in a real browser against a local single-origin build (`:8080` — the Vite dev server on `:18299` doesn't proxy `/api`, so the full login round-trip only works there): created a plant item + a materials item end-to-end, confirmed Site Issues tab still loads, zero console errors; cleaned up the test records afterward. `pnpm run check:layout` 92/92 (covers the new `project-detail:plant` + `portal:plant-materials` routes). Committed `20e5db2`, pushed `main → 5dc2e6e8` (verified against GitHub's raw content directly — `verify-push.ts`'s hardcoded signature list is stale from a prior feature and doesn't check new pushes, worth fixing or retiring). User Published via Replit UI (this session has no deploy capability — the `replit` CLI here has no deploy command); health-checked OK post-restart (`uptime` reset, `plant-items` endpoint live, HTTP 200).
- **2026-07-19:** Found commit `1a49a54` (off-workflow "Replit Agent" session, 2026-07-17) shipped an undocumented feature set an hour before that day's Publish. Reconciled: added **#72**, corrected **#67** to DEPLOYED (superseded by #72's 30-day inactivity policy). Fixed a real typecheck break the commit left behind (`lib/api-zod` tsconfig missing `"dom"` lib; `UploadPortalMyDocumentBody` ambiguous duplicate export) — `pnpm run typecheck` now clean. No deploy needed for #72/#67 (already live). Committed `e1482a1`, pushed `main → a74ba4d2` (verified), Published — health-checked OK post-restart. **Lesson: cross-check `git log` against this file periodically — it can drift behind off-workflow work.**

## Feature #73–#76 full detail (reconciled into CLAUDE.md 2026-07-19, moved to archive 2026-07-20)

- **Feature #73 full detail — Plant & Materials tracking + site-issue closure reasons:** commits `dbc9c00`+`2fd0f7c` (2026-07-19, off-workflow "Replit Agent" session, found + reconciled same day). New `plant_items`/`plant_item_attachments`/`plant_item_distributions` tables track what's on site (plant/equipment or materials: name, category, qty/unit, supplier — free-text or picked from the subcontractor directory, location, status on_site/on_order/off_hired/depleted, on-site/expected-off-hire dates); attachments (delivery ticket/certificate/test cert/photo/other) and an "Allocate" distribution flow mirroring document distributions (pending/viewed/acknowledged). New **"Plant & Materials"** tab on project detail (`plant-tab.tsx`, `plant-dialogs.tsx`) and portal section (gated by new per-project `project_members.canUpdatePlantMaterials` boolean, default false, enforced server-side via `requirePortalPermission`) — `routes/plant-items.ts`, `GET/POST/PATCH/DELETE /api/projects/:id/plant-items[/:itemId]`. Site Issues: photos gained `closureReason`/`closureNote`/`updatedAt`; closing an issue as invalid/duplicate is PM-only and requires a note (new `close-issue-dialog.tsx`); portal-submitted "Work Completed" reports now flow into issue lists via `issueCategoryFilter()` (status IS NOT NULL gate, so historical progress photos aren't swept in); activity log gained a `metadata` jsonb column for structured diffs (e.g. status/assignee changes). Also added a second per-project write-permission grant, `canLogIssues` (default true). Typecheck clean, `pnpm run check:layout` 92/92, and end-to-end verified locally (create plant + materials item, confirm list/attachment/Allocate UI, Site Issues tab) — no prior browser verification existed for this commit before now. **DEPLOYED+prod-verified** (2026-07-19, pushed `main → 5dc2e6e8`, Published, `/api/projects/:id/plant-items` confirmed 200 live post-restart).
- **Feature #74 full detail — Person-first contacts: self-employed + certifications + Team tab restructure:** every `subcontractors` row now has a real linked primary-contact `people` row (new `people.is_primary_contact`, auto-created on `POST /subcontractors` + one-time backfill in `ensure-schema.ts`, kept in sync bidirectionally with the legacy `subcontructors.contactFirstName/contactLastName/contactEmail` fields), so every card is a real addressable person instead of a UI-only pseudo-person. New `self_employed` contact type — the person IS the entity, Add Contact form hides Company Name, "Self-employed" shown in its place everywhere, amber "No insurance on record" badge (vs the quiet grey for companies) since a self-employed contact has no firm to fall back on. New **person-level certifications** (`person_certifications` table, FK → `people.id`; `GET/POST/DELETE /people/:id/certifications`) — free-text name + expiry + optional file, on ANY person regardless of employment shape; auto-archive-on-renew like insurance/permits; feeds the existing 30/21/14/7/1-day + expired-grace reminder job (`runPersonCertReminders`) and a new "Expiring Certifications" section on Compliance Centre. **Team tab is now person-first**: `POST /projects/:id/members/person` adds a specific person to a project immediately (no portal acceptance required — inviting them to the portal is a separate follow-on action via the existing pill); `GET /projects/:id/members` restructured with a `personId`-first branch; new flat `GET /api/people` directory powers the flipped "Add from Contacts Directory" picker (search by name, company shown as reference) and the portal share/allocate picker (`Name · Company · Trade`). One card per person (heading = name, subheading = company/"Self-employed" + job title); a firm with 2+ people on a project gets a shared strip (company name, trades, PLI badge, explicit **"Remove company from project"** naming every person it removes) above independent person cards, each with its own Invite/Notes/Docs (company-scoped, launched from the card)/Share/Remove; a lone primary contact renders as one self-sufficient card (no redundant strip). Fixed a real correctness bug this surfaced: `portalStatusFor` previously treated "has a `project_members` row" as "is a portal member" — no longer true once team-adds don't require portal acceptance, so it now keys off `userId` instead. Typecheck clean, `pnpm run check:layout` 92/92, and end-to-end browser-verified: self-employed contact + CSCS cert (shows on card + Compliance Centre, amber insurance badge), employed person's own cert alongside "Covered by [Company] PLI", two-person company → two independent cards with independent Remove (confirmed one removed leaves the other + company intact), "Remove company from project" confirmation names both people. **DEPLOYED+prod-verified** (2026-07-19, pushed `main → 2f19a511`, Published, `GET /api/people` + `/people/:id/certifications` confirmed 200 live post-restart, primary-contact backfill ran correctly on prod data).
- **Feature #75 full detail — Daily Report in the Team Portal + shared dictation button + plant attachment counts:** off-workflow work found already implemented and uncommitted at session start (2026-07-19), reconciled: reviewed, fixed a gap, verified, committed, pushed. Portal members see today's structured site diary (weather/labour/plant/work completed/delays/deliveries/H&S — the same `ManagerReportFields` the dashboard Daily Reports hub uses) as a **structural section** (visible to everyone, like Team/Progress — not `portal_shares`-gated); a new per-project `canEditDailyReport` permission (`project_members.can_edit_daily_report`, same convention as `canLogIssues`/`canUpdatePlantMaterials`) lets a granted member amend it, gated server-side via `requirePortalPermission` AND a lock window (`isReportLocked`: reportDate + 2 days midnight Europe/London — day-end + 24h grace). Dashboard and portal write through the exact same `upsertManagerReport`/`sanitizeManagerReport`/`hasManagerContent` helpers (moved from `routes/reports.ts` into `lib/daily-reports.ts`) so there is one record and one diff/attribution path — every save writes an `activity_log` row and `contributorsForReport()` derives distinct contributor names from it for both today's report and the dashboard detail view. `GET/GET history/PATCH /portal/daily-report[/history|/:date]`. Extracted the dashboard's Web Speech API `DictationButton` (mic icon, en-GB, renders nothing if unsupported) out of `daily-report-detail.tsx` into a shared `components/ui/dictation-button.tsx`, now also used on the portal daily report fields, site-issue description, and plant-item notes. Plant items gained an `attachmentCount` (one grouped query, not N+1) shown on the project-detail list row. **Found and fixed while verifying:** `GET /projects/:id/members` (`routes/team.ts`) and the `ProjectMember` OpenAPI schema serialized `canLogIssues`/`canUpdatePlantMaterials` but omitted the new `canEditDailyReport`, even though the same file's PATCH permissions route already accepted it — a real (if currently low-impact, since the Team tab UI reads permissions via the `/people`-based endpoints in `people.ts`, which were correctly wired) inconsistency; added the field to both. `pnpm run typecheck` clean, `pnpm run check:layout` 94/94 (new `portal:daily-report` route both viewports). End-to-end browser-verified against a local single-origin `:8080` build using the persistent `layout-checker@sitesort.test` / `LayoutCheck123!` portal fixture: granted the permission via API, added+saved today's report from the portal (contributor name appeared correctly), confirmed history showed a genuine pre-existing past entry, revoked the permission and confirmed the same content now renders read-only with no Edit control — zero console/page errors throughout. Cleared the test report content and permission grant afterward. Committed `13b89a8`, pushed `main → 395419ce` (spot-verified against GitHub raw content directly — `verify-push.ts`'s checklist is still the same stale prior-feature list noted in #73, did not add today's files to it). **DEPLOYED+prod-verified** (2026-07-19, user Published via Replit UI; health-checked OK post-restart — `uptime` reset, `GET /api/portal/daily-report` and `GET /api/projects/:id/members` both return 401 not 404, confirming the new route and the field fix are live). Followed up with a **full real-browser write-path test on production itself** (not just local): created a throwaway in-house person + portal invite via API on prod (dummy `@example.com` address — Resend delivery failed as expected, no real inbox touched, but the API response returns the accept URL directly so the email isn't needed anyway), accepted it in a real browser, granted `canEditDailyReport`, added+saved today's report as that portal user (contributor attribution correct, zero console errors), confirmed the read-only state after revoking the permission, then fully cleaned up on prod (cleared the report content, revoked the invite, deleted the person — archived rather than hard-deleted per #71's footprint rule, out of active lists). Confirms the feature genuinely works end-to-end on live production, not just against the local build.
- **Feature #76 full detail — Team Portal Messages — project-scoped DMs, channel access, PM oversight:** extends the EXISTING dashboard messaging system (`messages`/`channel_messages` tables) into the portal rather than building a parallel one, per an explicit detailed user spec (planned via plan mode, two confirmed scope decisions: project-scoped messaging becomes fully immutable everywhere including today's dashboard channel edit/delete, not just the new portal surface; v1 portal composer is text+reactions+read-receipts only, no attachments/reply-quote/quick-replies). **Portal**: any member can DM any other current project member (portal or dashboard-side, e.g. the PM) and post in the project's existing channel; picker shows "Name · Company · Role" with **no email/phone ever**. New `messages.project_id` (nullable — null = today's legacy company-wide DM, unaffected; set = a Team Portal conversation) makes conversation identity `(otherUserId, projectId)` instead of just `otherUserId`, so the SAME two people get a genuinely separate thread per project — verified for a person on two projects: separate portal threads AND two separately-tagged rows on the PM's existing dashboard Messages page (which picks these up for free since the send path writes into the same table). New `lib/messaging.ts` (`sendDirectMessage`/`sendChannelMessage`/`toggleMessageReaction`/`toggleChannelMessageReaction`) is the ONE send/react path, called by both the dashboard routes (`routes/messages.ts`, `routes/channels.ts`, refactored) and new portal-guarded routes (`routes/portal-messages.ts`, exports `portalGuards` from `portal.ts`) — participant-only enforced server-side (the DM target must be a *current* member of the caller's project, checked on every read/send, not just filtered in the UI). Revoked members lose access immediately for free (existing session-death-on-revoke already covers any route using `portalGuards`); their past messages remain, flagged `senderRemoved`/`removedFromProject` via the existing `removedFromProjectUserIds` helper → "(removed from project)" in the UI. **Immutability**: channel messages lose `PATCH`/`DELETE` entirely (route + UI removed — a deliberate behavior change to the pre-existing dashboard channel feature, confirmed with the user); a DM with `projectId` set 404s on edit/delete; legacy company-wide DMs keep working exactly as before. **Unread**: new `"messages"` branch inside the existing single `computeUnseen` helper (not a second counter) — DMs received + channel posts not authored by me, compared against `lastViewedBySection`. **Push**: portal-member recipients get `enqueuePushForMembers` (deep-links into the conversation); non-portal recipients (e.g. the PM) get the existing `notifications` row, so the dashboard bell/Messages page picks it up unchanged. **PM oversight**: the pre-existing dashboard "View All" toggle (feature #16, previously company-wide only) gained a project selector — `GET /messages/conversations`/`GET /messages/thread/:id` both took a `?projectId=` filter (small, surgical change to existing endpoints, not new ones); opening a conversation the PM IS a participant in (detected client-side from the "senderId:recipientId" pair) switches to the normal thread endpoint with a working compose bar — "reading is universal, joining is explicit"; every oversight view of a conversation the PM is NOT part of writes an `activity_log` row (`itemType: "conversation_oversight"`) — verified present in the DB. Transparency: dismissible per-project banner on first Messages visit + a permanent non-dismissable line on the new-conversation picker screen. `pnpm run typecheck` clean, `pnpm run check:layout` 96/96 (new `portal:messages` route). Extensively verified via direct API calls (cross-project isolation, non-participant 404, revoked-session 401, immutability 404s on both DM and channel routes, legacy DM edit still works, reactions, oversight audit-log row, unread counter increment/clear) plus a real-browser pass on both the portal Messages section and the dashboard oversight tab — zero console errors either side. All test fixtures (temporary people, test messages, activity-log rows) cleaned up afterward via SQL (project-scoped messages have no delete API by design now). Committed `727f029`, pushed `main → 0579fbb2` (spot-verified against GitHub raw content). **DEPLOYED+prod-verified** (2026-07-19, user Published via Replit UI; health-checked OK post-restart — new routes 401 not 404, retired `/channel-messages/:id` PATCH/DELETE 404 as expected). Followed the #75 precedent for a **full production write-path test**: two throwaway `@example.com` in-house people (one added to two real projects for the cross-project-isolation check), portal-invited and accepted via direct API (Resend delivery failed as expected against dummy addresses — the invite response's `inviteUrl` supplies the accept token directly, so no real inbox involved). Confirmed on live prod: total cross-project DM isolation (separate portal threads AND two correctly-tagged rows on Paul's real dashboard Messages page) for the same two-project person; a genuine PM-oversight case (a conversation between two other members Paul never touched, fetched via `?all=true&projectId=`) rendered correctly; immutability 404s on both PATCH and DELETE for a project-scoped DM; a non-member DM target 404s. Real-browser pass (token injected via `localStorage`, bypassing the two-project login picker) showed the portal Messages list, unread badge, channel post, and DM thread all rendering correctly with zero console errors. Cleanup: both test people archived (out of active directories) and their portal access revoked — but since project-scoped messages are now genuinely immutable by design and this session has no direct prod DB access, two clearly-labeled "PROD TEST" DM rows remain permanently in Paul's live Messages list (user confirmed leaving them is fine — they're harmless and are, in fact, direct proof the permanence guarantee is real).

## 2026-07-20 (7) end-of-session wrap-up full detail (moved to archive 2026-07-21)

- **The ask**: the PM-authorisation control for portal section access (grant an individual member Site Issues/Plant & Materials/Daily Reports) had been asked for multiple times across sessions and was still not usable — the user wanted it visible **inline on each person's Team tab card**, no menu click required, matching how Invite to Portal/Notes/Docs/Share/Remove already render inline. Explicit instruction ending that session: "next time i need to complete this first."
- **Step 0 finding, confirmed at the time**: the permission fields and enforcement were NOT missing — `project_members.canLogIssues/canUpdatePlantMaterials/canEditDailyReport` existed, `requirePortalPermission` already gated both read and write endpoints (#77), and `PATCH /projects/:id/members/:id/permissions` already worked. A UI control ALSO already existed — `portal-people.tsx`'s `PortalInvitePill`, 3 `DropdownMenuCheckboxItem`s under the "Portal member" pill's dropdown (`portal.status === "member"` branch) — but it was **behind a click-to-open menu**, which is exactly what the user rejected as "not visible."
- **The fix scoped as presentational, not architectural**: move those same 3 toggles (same state, same `togglePermission` handler, same defaults) out of `DropdownMenuContent` and render them inline in the pill's own output whenever `portal.status === "member"`, gated the same way the rest of the card's action row already is (`caps.canManageTeam`). Explicit constraint: do not redesign the permission model — reuse everything from #77 as-is, just relocate the 3 checkboxes. **This is exactly what #81 (2026-07-21) shipped.**
- **Session totals at that wrap-up**: #77/#78/#79/#80 all shipped, deployed (Publish swept each into its own checkpoint commit ahead of Claude's `git commit`, now the established pattern — always `git log`/`git show --stat` after being told "published" rather than assuming), and pushed to GitHub (final push `main → 28468471`). Working tree clean at that session's end.

## Feature #88 full detail (moved to archive 2026-07-23)

- **Feature #88 full detail — Configurable per-document PIN sign-off, built by a concurrent session, investigated and prod-verified by this one:** while wrapping up #87, `git status` surfaced modified files this session never touched (`documents.ts`, `portal.ts`, `lib/db/src/schema/documents.ts`, new `signoff.ts`) — a **separate Replit Agent session** (session id `aed5a22b-...`, own `.agents/memory/` files, distinct from this Claude Code session) was actively building in the same workspace. Its feature relaxes #86's "every sign-off needs a PIN" rule back to conditional: new `lib/signoff.ts#pinRequiredForDoc({type, requirePinSignoff})` returns true for safety-critical types (`method_statement`/`permit`/`safety`) or when a new per-document `requirePinSignoff` boolean is set; everything else defaults to a single deliberate confirm ("I confirm I have read and understood this document," name+timestamp recorded, no PIN). User asked first to be told what the other session's diff actually was (reported: new schema column, `signoff.ts` resolver, updated `documents.ts`/`portal.ts` acknowledge endpoints, `use-sign-off-flow.ts` hook, `use-project-detail.tsx`'s parallel dashboard sign-off state, `compliance.ts`/`compliance/index.tsx` Pending Sign-offs, `documents-tab.tsx`, OpenAPI spec + regenerated client), then asked explicitly to confirm it doesn't break #86. Investigated call-site-by-call-site: `useSignOffFlow.open()` and `use-project-detail.tsx`'s equivalent both default `pinRequired` to `true` when a caller omits it (safe fallback, nothing silently downgrades); every real call site (dashboard Documents tab, Compliance page, portal `DocRow`) was updated to pass the real per-doc value; both dashboard (`/documents/:id/acknowledge`) and portal (`/portal/documents/:id/acknowledge`) endpoints got symmetric treatment; `signedOffWithPin` in `acknowledgment_audit_log`/`document_distributions` now correctly reflects `pinRequired` per sign-off instead of being hardcoded `true` — an accuracy improvement, not a regression, since a non-PIN confirm claiming "signed off with PIN" would have been the actual bug. Verified live (not just static review): created a `general`-type doc and a `permit`-type doc locally, confirmed `pinRequired: false`/`true` respectively on creation, then round-tripped both sign-offs — general doc acknowledges with an empty body (200, `signedOffWithPin:false` in the audit row), permit doc rejects an empty body (400 "PIN is required") and a wrong PIN (401), then succeeds with the correct PIN (200, `signedOffWithPin:true`). `pnpm run typecheck` clean across the whole monorepo with both sessions' changes merged in the working tree. **One real bug found and fixed before Publish**: the new `documents.require_pin_signoff` column had **no `ensure-schema.ts` entry** — it existed in the local dev DB only because a `drizzle push` (or equivalent) had been run directly against it; production's schema is exclusively updated through `ensure-schema.ts`'s boot migration (per this repo's own critical rule), so every `documents.*` read/write in prod would have started 500ing the moment this reached a real deploy — not a PIN-specific bug, a whole-Documents-feature outage risk. Added the missing idempotent `ALTER TABLE documents ADD COLUMN IF NOT EXISTS require_pin_signoff boolean NOT NULL DEFAULT false` (commit `404e19b`), confirmed idempotent by running the exact statement directly against the local DB via `psql` (correctly no-op'd, "column already exists, skipping"). Pushed to GitHub (`main → cad30677`). The user then Published via the Replit UI — confirmed this was a genuine **Deployment** (commit `df372dd`, `Replit-Commit-Author: Deployment` + a `Replit-Commit-Deployment-Build-Id`, distinct from the `full_checkpoint`-only commits seen earlier this session) rather than assuming from the commit message alone. Post-deploy prod verification: `/api/health` healthy on a fresh boot (uptime reset), `GET /projects/:id/documents` returns 200 with live `requirePinSignoff`/`pinRequired` fields (confirming the migration ran cleanly in production), `GET /compliance`'s `pendingAcknowledgments` correctly carries `pinRequired` per item, and #87's new `/portal/daily-reports/:id/view` endpoint responds (403 under a dashboard token, i.e. reachable and gated correctly, not a 404).

## Feature #81 full detail (moved to archive 2026-07-23)

- **Feature #81 full detail — Inline portal-permission toggles on Team tab cards:** the Site Issues/Plant & Materials/Daily Report grants from #77 existed and worked (`requirePortalPermission`, `PATCH .../members/:id/permissions`) but were buried behind a click-to-open dropdown, which the user flagged as not visible across multiple sessions (see the #77 wrap-up note archived above — explicit instruction was "next time i need to complete this first"). Step 0 confirmed the permission fields/enforcement and a UI control already existed (`portal-people.tsx`'s `PortalInvitePill`, 3 `DropdownMenuCheckboxItem`s under the "Portal member" pill's dropdown) — just hidden behind a menu. Fix scoped as presentational only, not architectural: moved the same 3 `togglePermission` checkboxes (same state, same handler, same defaults) out of `DropdownMenuContent` and rendered them as always-visible pills directly on the card (`PermissionTogglePill` in `portal-people.tsx`), matching how Invite/Notes/Docs/Share/Remove already render inline; only "Revoke access" stayed in a small "⋯" menu. No permission-model changes. **DEPLOYED+prod-verified** (2026-07-21): `typecheck` clean, `check:layout` 96/96, and the grant→200/revoke→403 `GET /api/portal/site-issues` round-trip plus inline-rendering screenshot confirmed both locally and directly against `www.sitesort.co.uk` with a throwaway `@example.com` test person (archived after cleanup). Deployed via Replit Publish (checkpoint commit `04045dd` swept in the workspace changes, the established pattern).

## Feature #86 full detail (moved to archive 2026-07-23)

- **Feature #86 full detail — PIN-based document sign-off (Pending Sign-offs, dashboard + portal):** large spec — every document sign-off (not just drawings/method statements/safety as before) now requires the signer's own hashed 4-digit PIN, making it an attributable signature: viewing a doc never needs a PIN and is logged separately from signing it off. Investigated first — most of the backend (hashed PIN storage, rate-limited PIN verification, append-only `acknowledgment_audit_log`, the dashboard sign-off dialog) already existed from an earlier feature, but PIN was only enforced for 3 doc types, the portal had NO sign-off endpoint at all (view-tracking only), and the Compliance page's "Pending Sign-offs" showed a bare count with no way to actually sign off or see who was pending. Made PIN universal for every sign-off (dropped the type gate). New portal-side twins of the existing dashboard flow: `POST /portal/documents/:id/view`, `POST /portal/documents/:id/acknowledge` (both gated on `portal_shares` visibility, safety docs always open), `POST /portal/pin` (set/reset, password-reverified — doubles as "forgot PIN"). New `pin_audit_log` table logs every PIN set/reset (who, when, set vs reset — never the PIN itself); shared `lib/pin.ts#setUserPin` backs both `/auth/pin` and `/portal/pin`. Dashboard Compliance page's "Pending Sign-offs" now shows a **named** per-recipient breakdown (not just a count) with a "Sign off" action when the viewer themself is a pending recipient; new `hooks/use-sign-off-flow.ts` is the shared PIN-entry state machine behind both the dashboard's dialog and the portal's inline (mobile-first) card. Signing off a new revision (a supersede) is a separate sign-off, since each revision is its own document row with fresh distributions. Verified with a full functional round-trip on a running local server (not just render checks) for both a dashboard user and a real portal-member login: correct PIN records the full audit shape `{userId, userName, userRole, documentId, documentVersion, action:"acknowledged", signedOffWithPin:true, ipAddress, userAgent, createdAt}` in `acknowledgment_audit_log` and clears the doc from Pending Sign-offs; wrong PIN rejected without recording anything and locks out after 5 attempts (429, 15 min, Redis-backed); superseding a signed-off doc correctly re-opens a fresh separate sign-off; PIN confirmed stored as a bcrypt hash (`$2b$10$…`) in `users.pin_hash`, never returned by any endpoint (`/auth/me` only exposes a `hasPin` boolean) and not selected by the admin user-list endpoint. `typecheck` clean, `check:layout` 96/96 at 360px+768px. Test fixtures (a throwaway portal user + 4 test documents) created and cleaned up directly against the local DB. **Not yet committed or deployed as of 2026-07-21** — awaiting the user's go-ahead.

## Feature #87 full detail (moved to archive 2026-07-23)

- **Feature #87 full detail — Activity-entry deep-links + daily reports join Team Portal sharing:** two explicit user asks, both audited before touching code, findings reported back before implementing. **Audit 1 (deep-links)** found 3 real gaps: (1) `daily-report-detail.tsx`'s "Document activity" rows (uploaded/amended/signed off/viewed) — shared by both the Daily Reports hub `/daily-reports` and the project-detail Daily Reports tab — rendered as plain unclickable `<div>`s despite carrying a `documentId`; (2) `team-activity.tsx`'s `ProjectTeamActivity` (PM oversight "Activity feed", used in the project-detail Overview tab) printed the literal string `"(opened an item)"` instead of linking to the item even though `en.itemId`/`en.itemType` were already returned by the API; (3) the dashboard's `handleActivityClick` and the Notifications page's `handleClick` each independently duplicated near-identical per-notification-type navigation logic, and `document_uploaded` only navigated to `?tab=documents` instead of opening the file — closing that gap required touching both, so extracted a shared `lib/deep-link.ts` (`itemDeepLink()` for the tab-scoped cases, `navigateToNotification()` for the cross-project notification-resolution cases) rather than fixing the bug twice. While consolidating, caught a real pre-existing bug: the `safety_concern` notification handler navigated to `?tab=photos`, a tab key that has never existed (real key is `issues`) — a silent dead link. Fixed all of it: `use-project-detail.tsx` gained `?document=`/`?permit=` deep-link query-param handlers (fetch-from-already-loaded-state, switch tab, auto-open the file via `openDocument`, clean the URL) mirroring the pre-existing `?photo=`/`?report=` pattern exactly; `daily-report-detail.tsx` and `team-activity.tsx` now render via the shared `LinkRow` component (same one used by the Close-out readiness card, per the user's explicit "don't invent a new one" instruction) with a chevron affordance. Confirmed with the user up front: document/permit deep-links navigate to the tab AND auto-open the file (matching the existing "Open" button behavior), rather than just scrolling to/highlighting the row. **Audit 2 (Share dialogs)** found the app already fully consolidated on one `<ShareModal>` — documents, photos/site-issues, permits, plant & materials, invoices, insurance certs, person certifications, contacts (team/subcontractor cards), and daily notes all already route through it; no duplicate dialog existed anywhere to delete. The actual gap: `ShareModal` gates its "Team Portal" section behind a hardcoded `PORTAL_ENTITY_TYPES` set (`document`/`photo`/`permit`/`plant_item`) that never included `daily_report`, and the same gap existed server-side in `portal-shares.ts`'s `ITEM_TYPES` validation set and `/portal/shared`'s aggregation query. Extended `daily_report` through the whole pipeline end to end: added it to both allowlists; extended `GET /portal/shared` to also compute `visibleShareMap(pid, "daily_report", viewer)`, fetch matching `daily_reports` rows filtered to ones with real content (`hasManagerContent`), and return a new `dailyReports` array; added `POST /portal/daily-reports/:reportId/view` (mirrors the existing document view-log endpoint) which writes through the existing `logActivity()` audit trail (`section: "shared", action: "view", itemType: "daily_report"`) — no new table needed, and it automatically feeds the now-fixed PM Activity feed with a working deep-link back to the full dashboard report. Added the OpenAPI spec entries (`PortalSharedDailyReport` schema, the new path) and regenerated `api-client-react`/`api-zod`. Frontend: `portal/section.tsx`'s `SharedView` gained a "Daily reports" card list (button rows, "New" badge, same visual language as the existing document/permit/photo rows) and a view dialog. **Scope decision, confirmed with the user before building:** a shared report shows ONLY the authored site diary (weather/labour/plant/work completed/delays/deliveries/H&S notes) — reused the file's own pre-existing local `DIARY_FIELDS`/`ManagerReportFields` (portal/section.tsx already had its own copy for the existing today's-report feature; deliberately did NOT introduce a second import from `daily-report-detail.tsx`, which has a same-named `DIARY_FIELDS` for a different data shape). It deliberately does NOT show the auto-collated internal activity (subcontractor check-ins, document upload/view/sign-off activity, site photos) that the dashboard's full report/`DailyReportDetail` component renders — that's operational/audit data, kept separate from what a PM explicitly chooses to distribute externally, and distinct from the existing pre-existing privacy rule (a portal member normally only sees a day's report if they contributed to it) which this new explicit-share path deliberately bypasses by design (the PM is knowingly granting visibility, same as sharing any other item). **Verification:** `pnpm run typecheck` clean across the whole monorepo (hit and fixed two real TS issues along the way: a stale `tsc --build` project-reference cache meant the freshly-regenerated `api-client-react` types weren't visible until `typecheck:libs` was rerun; a `Promise.resolve([])`-in-a-ternary inference edge case inside the new `/portal/shared` query resolved to `never[]`, fixed with an explicit type assertion). `check:layout` 96/96 — but the FIRST run was against a stale long-running Replit dev-server process (started hours earlier, same "stale build trap" #82 hit before: rebuilding `dist/index.mjs` doesn't restart an already-running `node` process) — caught it, killed the stale process (was listening on :8080 since 06:04), restarted with `PORT=8080`, reran `check:layout` clean against the corrected fresh server. Then ran a full functional round-trip directly against the local server (not just render checks), using a throwaway in-house test person on Acme Construction's "Commercial Unit" project: shared a real daily report (2026-07-21, had genuine site-diary content) via `POST /portal-shares` with `audienceType: "all"` → `GET /portal/shared` returned it correctly scoped to just `managerReport.workCompleted` (no check-ins/docs/photos) → `POST /portal/daily-reports/:id/view` logged the view → `GET /projects/:id/activity` showed the PM-facing entry with correct `itemType: "daily_report"`/`itemId`/`memberName` attribution. Cleaned up all fixtures (share rule, project membership, portal invite/session, test person — archived since real activity-log footprint blocked hard-delete). Finished with two browser screenshots (`browser-check` skill, logged in as `paul@acme.com` against the locally built `:8080`) confirming visually: the Daily Report Share dialog now renders the Team Portal picker (Everyone/Trades/People + "Share to portal" button) identically to the document dialog, and the project-detail Daily Reports tab's "Document activity" rows render as clickable `LinkRow`s with a chevron, not plain text. **Not yet pushed to GitHub or Published** — mid-session, Replit's own checkpoint mechanism auto-committed all the working-tree changes under a descriptive but non-Claude-authored message (`460737c "Add daily reports to portal sharing and improve notification handling"`, tagged `full_checkpoint` in the commit trailers) — distinct from a "Published your App" commit, so very likely NOT deployed to production; flagged this distinction explicitly to the user rather than assuming either way.

## #84/#85/#86 prod-verification session detail (moved to archive 2026-07-23)

- **2026-07-23 (1) — resumed session opener, corrected stale status, and prod-verified #84/#85/#86:** session started with routine housekeeping (CLAUDE.md was over the 30k trim threshold — moved old detail to this archive; `git pull` correctly left alone since this repo's GitHub sync is a one-way snapshot push via `push-robust.ts`, not a collaborative branch). While reviewing #84/#85/#86 the prior session's "not yet committed" note turned out to be wrong: `git log`/`ensure-schema.ts` showed all three were already committed and Published the same day (2026-07-21), just buried under an unrelated generic checkpoint commit message (`898f8f0`) — corrected CLAUDE.md rather than re-committing anything. Then ran a full production round-trip for all three against `www.sitesort.co.uk` using `paul@acme.com` (Acme Construction) plus one throwaway `@example.com` test person, cleaned up after: **#84** confirmed the block half (non-platform-admin → 403 on `/api/admin/*`, unauthenticated → 401; the positive "admin can access" path wasn't independently tested since no platform-admin login was available this session). **#85** full grant→create→attribution→revoke→403 chain passed (item created live with correct `createdBy`/`lastUpdatedByName`, visible to the PM instantly, blocked after revoke). **#86** both dashboard and portal PIN sign-off flows passed (wrong PIN → 401 with `attemptsRemaining`, correct PIN → 200, distribution flips `pending → acknowledged`, PM's `distributionSummary` reflects it). Test fixtures: one in-house test person + project membership + portal invite/session (archived, not hard-deleted — real footprint from the created plant item/documents blocked hard-delete, the correct/expected behavior) and two throwaway documents (marked superseded — no document hard-delete endpoint exists, matching prior sessions' pattern). Then committed the CLAUDE.md changes normally (`82b7a77`, `518549d`) and pushed to GitHub via `push-robust.ts` (`main → 9997d803`), verified with `verify-push.ts`.

## Feature #82 full detail (moved to archive 2026-07-21)

- **Feature #82 full detail — Portal access controls follow-up: card layout, whole-login revoke, invite parity:** 3 fixes to #81's card. (a) The "Portal member" status pill rendered on its own row above the role/type badge (`PortalStatusPill`), with the 3 section toggles (`PortalPermissionToggles`) staying in the row below — both share one `usePortalMembership` hook/query so there's no duplicate fetch. (b) The "Portal member" pill became the whole-portal-login on/off: click opens a confirm dialog ("Remove {name}'s portal access completely?") that explicitly distinguishes it from the per-section toggles, then calls the same `POST /invites/:inviteId/revoke` that already killed active sessions immediately and cancelled pending invites (that endpoint was already correct — no backend change needed, just wiring + a proper confirm). Removed the standalone dropdown "Revoke access" menu everywhere, including the Team Portal tab's invite list (`team-activity.tsx`), which previously had **no confirmation at all** on revoke — now shares the same status-aware confirm dialog. (c) Confirmed there is only ONE invite-creation endpoint (`POST /projects/:id/portal-invites`) for both "email invite" and "share-link invite" — the zod schema only ever carries `personId`+`role`, never permissions, and `project_members`'s 3 permission columns are `NOT NULL DEFAULT false` at the DB level — so a member's section permissions are always uniformly manageable via the card regardless of how they were invited or which code path created their `project_members` row (recommended and confirmed this is already the architecture — no separate invite-time permission form needed). **DEPLOYED+prod-verified** (2026-07-21): `typecheck` clean, `check:layout` 96/96 (against a freshly rebuilt local `:8080` — caught and fixed a stale-build trap where the running local server was serving pre-edit code), and a full round-trip directly against `www.sitesort.co.uk`: untick-one-section-only leaves the other section + membership intact, whole-access revoke kills all sections and the active session immediately (same token, no re-login) and cancels the invite, restore/re-invite works and permissions are manageable again, and a person accepted via the raw copied link is indistinguishable from any other member — plus screenshots confirming the live layout and confirm-dialog wording. Superseded within the same day by **#83**, which found #82's invite-route "parity" claim was still visibly broken (pending invitees showed no toggles at all) and root-caused + fixed the real gap.

## Feature #83 full detail (2026-07-21)

- **Feature #83 full detail — Portal permission card row order + pre-accept permission parity + full functional verification:** User reported #82 was still broken in practice: email-invited Amy showed NO toggles while pending, link-invited Annabelle showed them greyed — inconsistent, and pending invitees couldn't have permissions pre-set at all. **Root cause**: a pending invitee is already a project team member by construction — that's literally how their card exists on the Team tab to invite from at all (the person-first add flow, `POST /projects/:id/members/person`, always creates the `project_members` row up front, independent of any portal invite). So the row already existed with `userId = null`; `portalStatusFor` (people.ts) simply wasn't copying its `canLogIssues`/`canUpdatePlantMaterials`/`canEditDailyReport` columns onto the "invited" status object the way it already did for "member" — a one-line-per-field omission, not a missing architecture. Fixed by exposing those fields for "invited" too, sourced from the same `memberByPerson` map already used for `memberId`. **Two real edge cases this surfaced and fixed**: (1) `POST /portal/invite/:token/accept` (portal.ts) matched the existing membership row only by the BRAND-NEW `userId` it had just generated — which can never match a pre-existing row keyed by `personId` with `userId = null` — so accepting would have silently INSERTED A DUPLICATE row and dropped any permissions a PM pre-set while the invite was pending; fixed to match by `personId` OR `userId` and update in place. (2) The pending-invite revoke handler (`team-activity.ts`) treated a `userId`-null member row the same as an accepted dashboard account's row on revoke — `UPDATE SET personId = null` — which, with no `userId` either, orphans the row entirely (a ghost project_members row belonging to no one) instead of the intended "keep their team membership, just drop the portal grant" behavior; fixed to reset the 3 permission flags to `false` and leave the row (and the person's plain team membership) intact when `userId` is null. **Layout**: restructured the card into 3 explicit rows — row 1 (`Badge` then `PortalStatusPill`, badge first per this session's explicit spec, reversing #82's badge-second order), row 2 (the 3 `PortalPermissionToggles` grouped in their own flex container so they wrap together rather than intermixing with row 1/3 content), row 3 (Notes/Docs/Share/Remove) — each its own `flex flex-wrap` container so mobile wrapping stays graceful without merging the three logical groups. `PortalPermissionToggles` now renders for `status === "invited"` as well as `"member"`, with a small tooltip suffix ("applies as soon as they accept") on pending toggles. **Full end-to-end functional verification** (not just render checks) — for EACH of Site Issues / Plant & Materials / Daily Reports, proved the whole chain against a real fresh portal member: (a) PM ticks the toggle → `PATCH .../permissions` 200, re-fetched twice (simulated reload) still true; (b) `GET /api/portal/me`'s `member.<flag>` (which client-side drives `SECTION_NAV` filtering in `portal/layout.tsx`) flips true; (c) `GET /api/portal/<section>` 200; (d) member creates/edits via the section's write endpoint (`POST /portal/site-issues` multipart with `type`+`description`, no photo required; `PATCH /portal/plant-materials/:itemId` with `status`/`notes` on a PM-created-and-shared item; `PATCH /portal/daily-report/:date` with `workCompleted`, date resolved from the server's own `GET` response to avoid a UTC-vs-Europe/London date mismatch) and a re-fetch confirms it saved; (e) the submission reaches the PM correctly with attribution — site issues appear in `GET /api/issues` with `status: "new"` (the portal-origin marker, vs dashboard's `"open"`) and correct `uploaderName`; plant items show `lastUpdatedByName`+`lastUpdatedAt` on `GET /projects/:id/plant-items`; daily reports show the member in `contributors` (from `contributorsForReport()`) on `GET /daily-reports/:id`, with `managerReport.workCompleted` matching; (f) unticking flips the nav flag back to false AND 403s both the write endpoint and the read endpoint (not just a hidden nav item) — all 18 steps (3 sections × 6 steps) passed both locally (against a freshly rebuilt `:8080`) and directly against `www.sitesort.co.uk`, plus screenshots of the live card row layout and the live portal nav drawer gaining/losing "Site Issues"/"Plant & Materials"/"Daily Report" links. All test fixtures (throwaway `@example.com`/`.test` people, a plant item, portal-share rows) cleaned up after each run.
