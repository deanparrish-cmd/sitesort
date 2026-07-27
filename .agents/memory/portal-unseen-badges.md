---
name: Portal unseen badges
description: Rules for the portal's shared unseen/badge system (aggregate, clearing, privacy)
---
One unseen definition: `computeUnseen` (api-server portal routes) is the single source for all badge counts. The frontend aggregate (hamburger dot + PWA `setAppBadge`) is the SUM of the same per-section counts restricted to nav sections the member can see — never a separately computed total.

**Why:** duplicate count mechanisms caused disagreeing numbers before; the user explicitly bans parallel unseen tracking.

**How to apply:** any new portal section content must be added inside `computeUnseen` (permission-gated, submission-privacy-aware — e.g. daily-report notes only count on reports the member contributed to per activity_log) and cleared via the existing view-logging middleware; badges clear client-side by invalidating the unseen query shortly after section open (view is logged on response finish, so the section's own request still sees old counts).
