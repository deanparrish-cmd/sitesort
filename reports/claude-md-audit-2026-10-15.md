# CLAUDE.md audit, 2026-10-15

Every claim in CLAUDE.md that something is done, decided, verified or live,
checked for a commit, file or test that backs it. CLAUDE_ARCHIVE.md (about
268k characters) was not audited line by line.

## How it was checked

- All 46 files CLAUDE.md names exist in the repo.
- All 15 tests it names exist and passed in the full run on 2026-10-15
  (30 files, 186 tests, against a local copy of the server).
- Features #61 to #129: every number has a commit naming it, or a commit
  matching its subject, except #93 (below).
- "Deployed" for #61 to #125: their commits precede the last Publish
  (`469dde5`), and production answered as that build on 2026-10-15
  (`/api/fire-roll` 401, plain file link 410, health without `environment`).
- Prod probes were read-only and unauthenticated.

## Not backed by anything but CLAUDE.md

| # | Claim | Finding | Action |
|---|---|---|---|
| 1 | Separate dev Repl "scoped 2026-10-09" | No write-up anywhere | Scope now in `docs/dev-repl-scope.md` |
| 2 | "Restore from soft-delete TESTED 2026-10-09" | The 9 Oct record shows a soft-deleted copy existed; nothing shows a restore ran | Real restore done 2026-10-15, bytes read back |
| 3 | #92 User Guide "DEPLOYED+prod-verified" | Deployed is backed; no record of the prod verification | Treat as deployed, not verified |
| 4 | #93 Invoice Allocate "DEPLOYED+prod-verified" | Stale: invoices feature removed (`bebe715`), table dropped by #126 on next Publish; no commit names #93 | Marked removed in CLAUDE.md |
| 5 | #90 "verified submit→view already worked" | No test covers it | Unverified |
| 6 | 2026-10-09 (2) prod review "closed A2/B1, Dean 18 Sep, mobiles, C1 to C3" | Queries are in `reports/`; the results were pasted in chat and never saved | Results unrecorded |
| 7 | Console fixes (A1 delete, Amy merge) "user runs" | Not known to have run | Tonight's `reports/console-fixes-check.sql` |
| 8 | JWT_SECRET "CONFIRMED shared" (9 Oct) | Chat only; re-check blocked by permissions on 2026-10-15 | Tonight's 401 check |
| 9 | "Stripe LIVE" on production | Not observable until #128's health field is live | Tonight's health check |
| 10 | Storage "refuses deletes outside the deployed app" | True only for code using `lib/gcs.ts`; `restore-upload.ts` wrote to prod's folder on 2026-10-15 | Reworded in CLAUDE.md |
| 11 | #124 "Offline verified on a PRODUCTION build only" | Manual check, no test | Unverified |
| 12 | "Binding" decisions (10-08 PMs company-wide; 10-09 mobile match, no refusal, keep remembered device, no time-limited PM elevation; Dean's two setups stay) | Your decisions, recorded only in CLAUDE.md. Code matches those that are built (#124 tests cover hold-not-refuse) | Confirm they still stand |

## Backed, for the record

- #126 deleted a production file from the workspace: `reports/invoices-removed-2026-10-09.md`, soft-delete timestamp 2026-10-09 14:27 UTC.
- Test accounts: `annabelleparrish@icloud.com` is portal-only and Acme Construction is on the free tier (workspace DB).
- Workspace DB holds copies of production rows with the same ids: `reports/invoices-removed-2026-10-09.md`.
