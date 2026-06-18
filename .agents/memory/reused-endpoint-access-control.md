---
name: Audit access control when reusing an existing endpoint in new UI
description: Reusing an existing API endpoint from a new feature requires re-checking its tenant-scoping and role gating
---

When a new feature surfaces or relies on an *existing* write endpoint, do NOT assume the endpoint is already secure — audit its tenant-scoping (companyId) and role gating before shipping.

**Why:** `POST /projects/:projectId/photos` had no company check and no role gating (cross-tenant write / IDOR). It was only caught during code review when the daily-report feature started driving it from a new Photos-tab upload form. The sibling `GET` on the same router *did* scope by company, so the gap was easy to miss.

**How to apply:** in this Express + Drizzle codebase the standard pattern is: `authenticate` middleware, then `select ... from projectsTable where id = :projectId AND companyId = req.user.companyId` → 404 if missing, plus an explicit role check (internal roles = admin/project_manager/site_worker) for write/internal-only routes.
