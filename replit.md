# SiteSort Workspace

## Overview

pnpm workspace monorepo using TypeScript. Full-stack construction site information management platform.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, React Query, react-hook-form, Recharts

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080, served at /api)
│   └── sitesort/           # React + Vite frontend (port 18299, served at /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package
```

## Application: SiteSort

Construction site information management platform for SME construction companies.

### Key Features
1. **Version-Controlled Document Hub** - Auto version tracking, SUPERSEDED badges, cascade control
2. **Targeted Team Distribution** - Distribute to specific teams, track pending/viewed/acknowledged
3. **Digital Sign-Off Tracking** - Timestamped acknowledgments with PIN confirmation for critical docs
4. **Real-Time Notifications** - In-app notifications for documents, permits, insurance
5. **Compliance Photo Log** - Timestamped photos with reference numbers, GPS metadata
6. **Subcontractor Insurance Monitor** - Auto status tracking (valid/expiring_soon/expired)
7. **QR Code Site Board Integration** - Generate QR codes for physical site boards
8. **Permit Management** - Track active/expiring/expired permits with responsible persons
9. **Compliance Center** - Aggregate view of all compliance issues across projects
10. **Team Management** - Invite users, assign roles (admin/project_manager/site_worker/subcontractor)

### Authentication
JWT tokens, stored as `sitesort_token` in localStorage. Header: `Authorization: Bearer <token>`.

### Demo credentials
- Email: paul@acme.com
- Password: password123
- Company: Acme Construction

### Database Schema Tables
- companies, users, subcontractors
- projects, project_members
- documents, document_distributions
- insurance_records, permits, photos
- notifications, qr_codes

## Backend Routes

All under `/api` prefix:
- `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- `/projects` (CRUD), `/projects/:id/documents`, `/projects/:id/members`, `/projects/:id/permits`, `/projects/:id/photos`, `/projects/:id/qr-codes`
- `/documents/:id`, `/documents/:id/acknowledge`, `/documents/:id/distribute`, `/documents/:id/distributions`
- `/subcontractors` (CRUD), `/subcontractors/:id/insurance`
- `/permits/:id`
- `/compliance`
- `/notifications`, `/notifications/:id/read`, `/notifications/read-all`
- `/users` (CRUD)
- `/qr/:token`

## TypeScript & Composite Projects

- Always typecheck from root: `pnpm run typecheck`
- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Push DB schema: `pnpm --filter @workspace/db run push`
