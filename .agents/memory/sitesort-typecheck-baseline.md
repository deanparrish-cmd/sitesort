---
name: SiteSort typecheck baseline errors
description: Pre-existing tsc errors in artifacts/sitesort that are NOT regressions — don't chase them.
---

Running `pnpm run typecheck` in `artifacts/sitesort` reports ~10 errors that are
pre-existing baseline noise, unrelated to most feature work. The dev server
(Vite) compiles and runs fine regardless.

**The baseline errors:**
- `components/ui/{alert-dialog,calendar,pagination}.tsx` — `buttonVariants` not exported from `@/components/ui/button`.
- `components/ui/command.tsx` — `DialogContent` not exported from `@/components/ui/dialog`.
- `pages/dashboard/index.tsx` — `ProjectStatus` vs `"completed"` comparison has no overlap.
- `pages/site-board.tsx` — `"capturing"` vs `"uploading"` comparison has no overlap.
- `pages/projects/detail.tsx` (the `useListProjectMembers`/`useGetProjectDetail`/documents query hook calls) — `Property 'queryKey' is missing in type '{ enabled: boolean }'`. This one persists even after rebuilding `lib/api-client-react` declarations (`tsc -p lib/api-client-react/tsconfig.json`), so it's a genuine orval-generated-hook signature mismatch, not a stale-dist artifact.

**How to apply:** After editing sitesort, run typecheck and diff against this list.
Only treat *new* errors (ones mentioning your changed files/symbols) as yours.
The 10 above are not introduced by your change.
