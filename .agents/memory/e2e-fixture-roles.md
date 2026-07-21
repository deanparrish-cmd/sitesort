---
name: e2e fixture roles
description: Role values that dev/e2e fixture accounts must use so dashboard authz works like real users
---
Dashboard JWT role comes from company_members.role (active membership), NOT users.role. Many routes gate on INTERNAL_ROLES = ["admin","project_manager","site_worker"].
**Why:** fixture accounts created with role 'manager'/'member' got 403 on /api/daily-reports etc. and produced false bug reproductions.
**How to apply:** when seeding test users, set BOTH users.role and company_members.role to admin/project_manager/site_worker.
