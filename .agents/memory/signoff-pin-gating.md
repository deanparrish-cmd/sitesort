---
name: Document sign-off PIN gating
description: When a 4-digit PIN is required to sign off a document, and how the policy must be enforced
---
Rule: sign-off defaults to a single deliberate confirmation (attributed, timestamped, audited with signedOffWithPin=false). A 4-digit PIN is required only for safety-critical document types (method_statement, permit, safety — inductions live under "safety") or when the per-document requirePinSignoff toggle is on. The policy lives server-side (shared helper computes pinRequired from type + toggle); clients only receive a `pinRequired` boolean and must never be trusted to decide.

**Why:** the user wanted routine drawings/reports signable with one tap while keeping RAMS/permits/safety docs PIN-protected; an unguarded PATCH toggle would have let any company member weaken the policy (architect flagged it — now admin/PM only).

**How to apply:** any new sign-off surface (dashboard, portal, compliance) must branch on `pinRequired` from the API, send `{}` for confirm-only, and keep the frontend safety-critical type list in sync with the server helper. Any route that can change requirePinSignoff (or doc status/version) must be role-gated server-side, not just hidden in the UI.
