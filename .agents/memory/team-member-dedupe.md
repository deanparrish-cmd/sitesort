---
name: Team tab member dedupe
description: Same human can have two project_members rows (legacy firm-only + person/user); which one is real and how the list dedupes.
---
The same person can appear on a project twice: a legacy firm-only membership row (subcontractorId only, no personId/userId) plus a person/user-backed row.

**Rule:** the person/user-backed row is the real one — portal permission enforcement and PM authority only read rows with userId+personId. Flags toggled on a firm-only row are never enforced (dead toggles).

**How it's handled:** GET project members reports each person card's firm via the person's subcontractorId (effectiveSubId) and drops firm-only rows when a person-backed row for the same firm exists. The insurance-cert (PLI) endpoint falls back to the person's firm when the membership row lacks subcontractorId.

**Why:** prod had a subcontractor primary contact who was also invited individually — two cards, and the PM had toggled portal permissions on the dead firm card.

Related: duplicate `people` rows for one human also exist; contact-card certs expand to siblings by userId/email (see contact page cert aggregation).
