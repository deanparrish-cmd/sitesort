# Separate development Repl: scope

Written 2026-10-15. This replaces the "scoped 2026-10-09" line in CLAUDE.md,
which was never backed by a written scope.

## Why

Today the workspace and production are two halves of one Replit App. They
share one App Storage bucket, and until tonight one `JWT_SECRET`. The #128
guard (`lib/environment.ts`, `lib/gcs.ts`) stops the API server from emailing,
charging, pushing, running jobs or deleting files outside the deployed app,
but it only governs code that goes through those modules. On 2026-10-15
`scripts/src/restore-upload.ts` wrote to production's folder with its own
storage client, and nothing stopped it. Protection of production files is
therefore a rule people remember, not a lock.

## What Replit allows (checked 2026-10-15)

From Replit's App Storage docs
(https://docs.replit.com/cloud-services/storage-and-databases/object-storage):

- "Each bucket belongs to one project and cannot be shared across apps."
  "You cannot attach that bucket to another project, even if both projects
  belong to the same account."
- "Your app can upload, download, list, and delete objects in its own
  buckets. It can't read or change bucket settings."
- "App Storage doesn't support lifecycle rules, object versioning, or
  retention policies." "The delete action is irreversible."

Confirmed from this workspace: reading the bucket's settings returns 403
(`heimdall-production@replit-user-deployments...` has no
`storage.buckets.get`). The credential comes from Replit's sidecar
(`127.0.0.1:1106`) and is Replit's managed identity.

So:

1. **Scoped credentials inside this Repl are not available.** There is no
   setting that lets the workspace read production's folder but not delete
   from it. Every process in this Repl, the workspace shell included, can
   delete production files.
2. **A separate Repl is a physical boundary.** Its bucket is its own; it
   cannot reach this one.
3. **Soft delete is undocumented.** The 2026-10-15 restore worked, but Replit
   does not promise it, its retention or its continued existence. It is luck,
   not a backup.

## The lock, in three parts

| Part | What it stops | Kind |
|---|---|---|
| Dev Repl with its own bucket, DB and secrets | Any dev script, agent or session touching production data | Physical (Replit boundary) |
| Production Repl used only to pull and Publish | Day-to-day work happening where production files are deletable | Procedure, much smaller surface |
| Off-Replit append-only backup | Loss of a production file by any route, including inside the production Repl | Physical (object lock on another provider) |

The first and third parts are real locks. The second is still a rule, but it
reduces "never run a risky script in the workspace" to "only press Pull and
Publish in the production Repl".

## Phases

### 0. Make GitHub an exact copy of the code (prerequisite)

`scripts/src/push-delta.ts` is additive (`base_tree`): files deleted locally
stay on GitHub. On 2026-10-15 GitHub `main` held 1,601 files the repo does
not, including the removed invoices feature (`routes/invoices.ts`,
`pages/invoices/index.tsx`, `lib/db/src/schema/invoices.ts`) and
`.pythonlibs/` junk. A Repl created from GitHub today would bring those back.

- Add deletions to `push-delta.ts`: tree entries with `sha: null` for every
  path on GitHub `main` that is not in `git ls-files`.
- Verify: tree of GitHub `main` equals `git ls-files` (a new
  `verify-mirror.ts`, path-for-path and blob-for-blob).

### 1. Create the dev Repl

- Import from GitHub (`deanparrish-cmd/sitesort`) after phase 0.
- It gets its own PostgreSQL database and its own App Storage bucket
  automatically. Never copy production rows into it (the current workspace
  DB holds copies of real people's records; that ends here).
- Secrets for the dev Repl, all new values, none copied from production:

| Secret | Dev value |
|---|---|
| `JWT_SECRET` | new random value |
| `STRIPE_TEST_SECRET_KEY` | Stripe test key (`sk_test_`) |
| `STRIPE_SECRET_KEY` | not set |
| `STRIPE_WEBHOOK_SECRET` | test-mode webhook secret, if webhooks are tested |
| `STRIPE_PRICE_*` | test-mode price ids |
| `RESEND_API_KEY` | not set (email stays off) |
| `WORKSPACE_VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` | new key pair |
| `VAPID_*` | not set |
| `APP_URL` | the dev Repl's own URL, never `www.sitesort.co.uk` (the current workspace points it at production) |
| `OPENAI_API_KEY` / AI integration | own key or the Replit integration |

- Keep the #128 guard. It still matters in the dev Repl: it keeps a dev build
  from behaving like production even with the wrong secret set.

### 2. Seed data, not production data

- New `scripts/src/seed-dev.ts`: demo company (Acme Construction), Paul as
  admin, a portal-only site worker, two projects, documents with revisions,
  a permit, a QR code, a subcontractor with insurance. Idempotent.
- The layout checker and API tests already create their own fixtures, so
  they run against seed data unchanged.

### 3. Move the work

- All Claude Code and Replit Agent sessions run in the dev Repl. CLAUDE.md
  and its archive travel with the repo.
- Pushes go from the dev Repl to GitHub with `push-delta.ts` (now mirroring
  deletions).
- The production Repl's job becomes: pull GitHub `main`, Publish. Nothing
  else is run there: no scripts, no agents, no shell work.
- Production Repl workspace secrets: remove live Stripe, Resend and VAPID
  values, which only the deployment needs (Deployment secrets hold their own
  copies). If the workspace holds no live keys, a slip there cannot send or
  charge either.

- **BLOCKER before removing any secret from the production Repl
  workspace (Dean, 2026-10-15):** in the Deployment secrets pane,
  `JWT_SECRET`, `SESSION_SECRET`, `RESEND_API_KEY`, both Stripe keys and the
  object storage secrets carry a blue chain icon (`DATABASE_URL`/`PG*` a
  globe). Replit's docs only describe a chain for account secrets linked
  into a project ("Linked secrets stay in sync with your account secrets"),
  and say nothing on what Unlink leaves behind. If these are account-level
  or workspace-linked, deleting one in the workspace may delete it from
  production too. Resolve with the `LINK_TEST` dummy-secret test first.
- Proof they are shared today: a token signed with the workspace
  `JWT_SECRET` (2-minute expiry, demo admin Paul) returned **200** from
  production `/api/auth/me` on 2026-10-15. Rotation waits until the chain is
  understood. Rotating `JWT_SECRET` also resets: every login, upload link
  signatures (`lib/signed-uploads.ts`, 12 to 24h, refresh themselves), QR
  remembered devices (180 days, workers re-identify by mobile) and held
  check-in tokens (24h). `/s/<token>` share links are random tokens stored
  hashed, not affected.

### 4. Off-Replit append-only backup

- A scheduled job in the deployed app copies each new or changed upload to
  an external bucket with object lock: Cloudflare R2 with a bucket lock
  rule, or AWS S3 with Object Lock in compliance mode. Retention 90 days.
- Its credentials allow writing objects and nothing else: no delete, no
  overwrite of a locked object, no change to lock settings. A leaked key can
  add files but cannot remove one.
- Same job: a nightly `pg_dump` of the production database into the same
  locked bucket.
- Production database backups on Replit's side: **unknown, to confirm** in
  Replit's database tool before relying on them.
- Prove it by restoring one file and one table from the backup into the dev
  Repl, end to end, before calling this phase done.

## Verification (each one a test you can run, not a claim)

1. GitHub `main` tree equals `git ls-files` (phase 0 script, exit 0).
2. From the dev Repl, listing production's bucket id
   (`replit-objstore-8ff09467-...`) is refused.
3. From the dev Repl, `/api/health` shows `deployed: false`, `stripe: test`,
   `email: off`.
4. A dev-signed token is refused by production `/api/auth/me` (401).
5. A file deleted from production's folder (a test file uploaded for the
   purpose) is restored from the locked backup and opens.
6. An attempt to delete from the backup bucket with the job's credentials is
   refused.

## Decisions (Dean, 2026-10-15)

- Backup provider: **Cloudflare R2 with bucket lock rules.**
- Production Repl access: **Dean only.** Testers never need it.
- Workspace database copies of real records: **delete once the dev Repl
  works.** Identical ids in both databases are what let a workspace run
  delete a production file on 2026-10-09.
- Phases 0 to 3: go ahead in order after the 2026-10-15 publish settles.
- Interim, this week: one-off manual export of the production database and
  files to R2 (`scripts/src/export-uploads.ts`, steps in the session of
  2026-10-15). Phase 4 then builds the automated locked version.

## Rough effort

| Phase | Effort |
|---|---|
| 0 GitHub mirror | 1 to 2 hours |
| 1 Dev Repl + secrets | 1 to 2 hours, mostly in Replit's UI |
| 2 Seed script | half a day |
| 3 Move the work | 1 hour, plus habit |
| 4 Locked backup + restore drill | about a day |

## Not changing

The code, the #128 guard, the deploy path (Publish from the production
Repl), the production database and bucket.
