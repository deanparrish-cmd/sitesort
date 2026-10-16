# Scheduled jobs that don't depend on the app being awake (scope, 2026-10-16)

Not built. Prod is an Autoscale deployment: no traffic, no instance, and every
job below is a `setInterval`/`setTimeout` inside the app (`index.ts`, deployed
only). A quiet day runs none of them.

## What depends on the app being awake today

| Job | Schedule now | Quiet day effect |
|---|---|---|
| Expiry reminders (permit, insurance, person cert) | 30 s after boot, then 24 h | **No warnings go.** Pre-expiry catches up on the next wake (the 7-day bucket covers 2 to 7 days left); daily "expired" emails for missed days are lost. |
| Daily site reports | 18:00 London, boot catch-up for yesterday + today | Two or more quiet days lose reports for the earlier days. |
| Check-in auto-close | every 5 min | People stay "on site" until something wakes the app; the first tick then closes them. |
| Share-link expiry reminders | hourly | Late, catches up on wake. |
| Batched push flush | every 30 s (90 s debounce) | Low risk: a push is queued by a request, so the app is awake for it. |
| Database watchdog | every 2 min | By design only while up. Outside uptime monitor is the cover. |

## Recommendation

1. **One protected endpoint** `POST /api/internal/run-jobs`, header
   `X-Jobs-Secret: <JOBS_SECRET>` (Deployment secret, constant-time compare,
   anything else 404). It runs, in order and awaited before responding:
   expiry reminders, daily-report catch-up (extend to the last 7 days),
   check-in auto-close, share-link reminders. Each job is already idempotent
   (reminder claims, report unique key), so calling it hourly is safe and two
   instances running it at once is safe.
2. **Called hourly by a scheduler whose only job is this**, not the uptime
   monitor. Options, in order of preference:
   - **Replit Scheduled Deployment** in the same Repl: a cron `0 * * * *` running
     `curl -fsS -X POST -H "X-Jobs-Secret: $JOBS_SECRET" https://www.sitesort.co.uk/api/internal/run-jobs`.
     First-party, same account as prod. Check its pricing first (unverified).
   - **cron-job.org** (free, emails you when a call fails). Separate account to keep.
   - Not GitHub Actions `schedule`: runs late and is switched off after 60 days
     without repo activity.
   - Alternative to all of this: move prod to a **Reserved VM** (always on). Fixes
     every job and the watchdog with no code change; monthly cost (unverified).
3. **Dead-man check, so a stopped scheduler is noticed.** New `job_runs` table
   (`job, last_started_at, last_ok_at, last_error`). `/api/health` reports each
   job's hours since `last_ok_at` and `"jobs": "stale"` when reminders are over
   26 h old. UptimeRobot gets a keyword alert on `stale`: it only ALERTS, it
   doesn't run anything, so pausing it doesn't stop reminders. The endpoint also
   emails OPS_ALERT_EMAIL if, when it runs, the previous OK run was over 26 h ago.
4. Keep the in-app timers as a second path (both are idempotent).

Size: about half a day including tests (endpoint auth, job_runs, health field,
stale alert). Needs from Dean: create `JOBS_SECRET`, set up the scheduler.
