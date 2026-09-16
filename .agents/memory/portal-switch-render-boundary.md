---
name: Portal switch rendering boundary
description: Why a successful portal session switch also needs a full rendering reset
---
Treat a project/company switch as a rendering boundary, not just an API-session change.

**Why:** Browser verification showed correctly revoked sessions and a new token while mounted overview details still displayed the previous project. Clearing the query cache and navigating to the same route did not reliably reset subscribed views. A full reload was chosen deliberately for consistent presentation across companies.

**How to apply:** If replacing that reload with smoother navigation, verify every mounted project-dependent view resets together, including overview details, header and switcher. A passing token-isolation test alone does not prove the screen has changed context.