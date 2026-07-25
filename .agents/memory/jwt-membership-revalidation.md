---
name: JWT membership revalidation
description: Removing someone from a team/company must also kill their long-lived JWT access.
---

**Rule:** Dashboard JWTs carry companyId/role for up to 30 days, so any "remove member" feature must be paired with a live membership re-check in `authenticate` (60s per-(user,company) cache, busted on removal) — deleting the membership row alone leaves a broken-access-control window.

**Why:** Architect review failed the first version of team-member removal for exactly this: the token stayed valid until expiry. Portal tokens are separately governed by portal_sessions.

**How to apply:** Any new revoke/remove/deactivate flow: bust the membership cache after the delete, and confirm a token minted for the removed company gets 401. Before enabling such checks, verify no legacy users lack membership rows (dev AND prod) or you lock people out.
