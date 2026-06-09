---
name: Auth email normalization
description: Why/where SiteSort must normalize user emails (trim+lowercase) and the iOS input gotcha behind "can't log in after registering".
---

# Auth email normalization (SiteSort)

**Rule:** Every code path that WRITES `users.email` must `String(x).trim().toLowerCase()`
in lockstep with every path that LOOKS UP by email. Lookups now lowercase the input,
so any write that stores mixed-case/whitespace produces an unloggable account.

Write paths to keep normalized:
- `/auth/register` (admin/company signup)
- `/auth/invite/:token/accept` — sources email from `subcontractors.contactEmail`; normalize
  before BOTH the duplicate check and the insert, or mixed-case invited accounts can't log in.
- (Cosmetic, not login-critical) subcontractor create/update store `contactEmail` raw — fine
  because invite-accept lowercases at user-creation time.

Read/normalize paths: `/auth/login`, `/auth/forgot-password`, `/auth/resend-verification`.

**Frontend:** auth email inputs (login.tsx, register.tsx) need
`inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}` — iOS/iPad
auto-capitalises the first letter, which otherwise stores `Foo@x.com` but logs in as `foo@x.com`.

**Why:** A real UK user couldn't log in after registering+paying. Two layered causes:
(1) exact, case-sensitive `eq(usersTable.email, email)` lookup; (2) the user typed an Apple
`@icloud.com` alias while the account was under `@me.com`.

**Important caveat:** Apple `@me.com` vs `@icloud.com` are DIFFERENT addresses to this app
(not aliases) — normalization does NOT fix a domain mismatch. That class of failure is a
user-data issue (use the correct address or password reset), not a code bug.
