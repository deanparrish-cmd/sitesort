---
name: Tenant (company) hard-delete cascade
description: Design rules for the admin delete-company route and the drizzle ANY(array) pitfall
---

Rule: the admin delete-company route must cover the FULL current FK graph — it broke in prod when newer tables (photos assignment cols, people, portal_*, plant_items…) were added without updating the cascade.
**Why:** hand-maintained cascades silently fall behind schema growth; the failure is a prod-only 500 on FK violation.
**How to apply:** when adding a table referencing users/companies/projects/subcontractors/people, extend the delete-company cascade in admin.ts. To audit, dump FKs from information_schema (children of those parents) and diff against the route.

Cross-tenant users: accounts homed in the deleted company may have footprints in other tenants. Delete purely-personal rows anywhere; NULL nullable content refs; if non-nullable content refs remain in another tenant, don't delete — scrub instead (tombstone email `deleted-<id>@removed.invalid`, random password, portal_only, re-home company_id to a surviving membership captured BEFORE company_members deletion). Per-user savepoints keep one stubborn account from aborting the transaction.

Drizzle/node-pg pitfall: `sql`… = any(${jsArray})`` fails with "malformed array literal" — drizzle doesn't serialize JS arrays for ANY(). Pass an explicit Postgres array literal string: `` any(${`{${ids.join(",")}}`}::text[]) `` (safe for UUID ids only).
