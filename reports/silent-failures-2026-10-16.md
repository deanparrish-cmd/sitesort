# Silent failures sweep (2026-10-16)

Read-only sweep, nothing fixed. "Silent failure" = a request fails and the screen shows
an empty state, a stale list, or a success message instead of saying it failed.

Method (reproducible):
- `r.ok ? r.json() : <empty>` in the frontend: 56 places
- `.catch(() => {})`: 39; empty `catch {}`: 29
- POST/PATCH/PUT/DELETE fetches with no `res.ok`/status check in the next 25 lines: 19
- Screens using generated data hooks with no `isError` anywhere in the file: 10 files,
  plus `pages/portal/section.tsx` (about 20 hooks, none checked)

Already fixed this week: documents list (`1fe84f4`), portal share POST (`ecd9996`).

## A. Shows "nothing" when the load failed (highest risk first)

| Where | What the user sees on failure |
|---|---|
| `pages/portal/section.tsx` (every section: shared, drawings, permits, issues, team, site board, daily report, plant) | "Nothing shared with you here yet." The phantom Dean chased. |
| `pages/compliance/index.tsx:124` | Expiring insurance/permits/sign-offs all empty, reads as "all clear" |
| `pages/dashboard/index.tsx:467-474` | Notifications, fire roll, plant on hire, access requests, onboarding: panels empty or missing |
| `pages/projects/detail/use-project-detail.tsx:447-453` | Permits, photos, milestones, check-ins, daily reports, daily notes, QR pins: tabs empty |
| `pages/projects/detail/use-project-detail.tsx:215,220,269,331,336` | Milestones, reports, today's notes empty |
| `pages/qr.tsx` (`useListProjects`, no error check) | QR page with no projects (the Generate button bug) |
| `pages/projects/index.tsx` (`useListProjects`) | "No projects" |
| `pages/projects/detail/tabs/checkins-tab.tsx:63`, `pages/checkins/index.tsx:52` | Empty check-in log |
| `pages/projects/detail/tabs/plant-tab.tsx` (`useListPlantItems`) | Empty plant list |
| `pages/share-requests.tsx:52` | No access requests |
| `pages/daily-reports/index.tsx:81`, `dialogs/report-dialog.tsx:58` | No reports |
| `pages/team/index.tsx:233`, `pages/subcontractors/index.tsx:355,439` | Empty team / directory |
| `pages/messages/index.tsx:439,597,607,633,645,736`, `pages/portal/messages-view.tsx` | Empty threads |
| `pages/projects/team-activity.tsx`, `pages/projects/portal-people.tsx`, `tabs/team-tab.tsx` (certifications), `dialogs/plant-*.tsx` | Empty lists |
| `components/share-modal.tsx:179-246` | Share dialog: no members, no current rules, no history |
| `components/daily-report-photos.tsx:41`, `components/fire-roll-card.tsx:45`, `pages/site-board.tsx:136,153,639` | Empty photos / no fire roll / blank board |
| `pages/settings/index.tsx:351,459,636` | Settings fields blank |

## B. Says it worked, or updates the screen, when the save failed

| Where | Action |
|---|---|
| `pages/admin/index.tsx:415` | Delete company: dialog closes as if deleted |
| `pages/projects/detail/use-project-detail.tsx:890` | Delete permit: removed from the list even if the server refused |
| `pages/projects/detail/use-project-detail.tsx:1218` | Edit document status/version/revision: dialog closes as saved |
| `components/share-modal.tsx:338` | Remove a portal share rule: disappears from the list either way |
| `pages/team/index.tsx:309` | Add team member: "added" even if linking to the chosen projects failed |
| `pages/projects/detail/tabs/progress-tab.tsx:145,161,192` | Milestone tick / delete / add |
| `pages/projects/detail/use-project-detail.tsx:787` | Add trade |
| `pages/projects/detail/tabs/team-tab.tsx:217` | Change member photo |
| `pages/admin/index.tsx:402,475` | Beta access toggle; resolve Stripe cancellation |
| `pages/portal/section.tsx:293-301` | "Open latest" on a superseded doc says "Couldn't open replacement, try again" when the new revision simply isn't shared |

## C. Acceptable as is (best effort, user loses nothing)

`share-modal.tsx:252` share log, `lib/portal-push.ts:157,211` push subscribe,
`portal/layout.tsx:55` logout, `dashboard/index.tsx:654` mark notification read,
`auth/login.tsx:57` + `auth/register.tsx:152` resend verification (deliberately
always "sent", stops email enumeration), `components/company-switcher.tsx:29`.

## D. Server: notifications that fail without a log line

`routes/qr.ts:147` "Waiting at the gate" push to the site manager,
`routes/people.ts:635,695` portal invite push, `lib/messaging.ts:76,127` message emails.
The request succeeds; if the push/email fails nobody, including the logs, knows.

## E. Email that fails or bounces with nobody told (added 2026-10-16)

Resend's SDK (v6.12) does NOT throw when it refuses an email: it returns
`{ data, error }`. A `.catch()` alone never sees a refusal.

| Where | What happens on failure |
|---|---|
| `lib/permit-reminders.ts` (permit, insurance, person-cert expiry) | `claimMilestone` records the reminder as sent BEFORE sending, and the result's `error` is ignored. A refused reminder is never retried and nothing shows it. |
| `lib/messaging.ts:76,127` message emails, `routes/auth.ts` verification/welcome, `routes/users.ts` invitation, `routes/photos.ts` safety alert, `lib/document-distribution.ts` | `.catch()` only: a Resend refusal is silent, not even logged. |
| Portal invite (`lib/invite-email.ts`) | Checks `error`: the card shows "failed" with Resend. OK for refusals. |
| Ops alert (`lib/email.ts:789`) | Checks `error`, throws. OK. |
| ALL email | A bounce happens AFTER Resend accepts it. The app has no Resend webhook (`email.bounced` / `email.complained`), so a bounced portal invite still shows "sent" on the card. Only the Resend dashboard knows. |

Test-domain block (checked): two layers. (1) Outside the deployed app nothing is
sent at all (`IS_DEPLOYED`, #128), whatever the domain. (2) In the deployed app,
`isReservedTestAddress` blocks by PATTERN (any `*.test`, `*.invalid`, `*.example`,
`*.local`, `*.localhost`, `example.com/.net/.org`), so a new test domain of that kind
is caught. Gaps: `paul@acme.com` (demo login, a REAL domain: anything the prod app
sends Acme's admin goes to acme.com and likely bounces); bare `x@test` / `x@localhost`
(no dot) pass the pattern. Tests and scripts send only through `lib/email.ts`.

## Suggested fix shape (not started)

One shared pattern rather than 80 one-offs: a small fetch helper that throws on
non-2xx, plus an `<ErrorState onRetry>` component (the documents tab one), and a
portal-wide rule that a failed section load shows "Couldn't load" + Try again,
never the empty-state copy. Then the B list one by one.
