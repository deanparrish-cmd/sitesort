---
name: Stale project-reference .d.ts after schema/openapi changes
description: Why tsc reports phantom "property does not exist" errors after editing db schema or regenerating the api client, and how to clear them.
---

# Stale project-reference dist breaks tsc (not runtime)

After editing a `lib/db` schema column or regenerating the API client, `tsc --noEmit`
in a consumer (api-server, sitesort) reports errors like "property X does not exist"
or "X does not exist in type" even though the source clearly has it.

**Why:** Workspace libs (`lib/db`, `lib/api-client-react`, `lib/api-zod`) are consumed
via TypeScript **project references** (`references` in the consumer tsconfig) with
`composite: true` + `emitDeclarationOnly`. tsc reads the library's built `dist/*.d.ts`,
NOT its source — so a freshly edited source column is invisible until the lib's
declarations are rebuilt. The dev servers (esbuild for api-server, Vite for sitesort)
read source directly via the package `exports` map, so **runtime works fine** while
tsc lies.

**How to apply:** After changing a schema column or running api-spec codegen, rebuild
the affected lib's declarations before trusting tsc:
- `pnpm --filter @workspace/db exec tsc -p tsconfig.json`
- `pnpm --filter @workspace/api-client-react exec tsc -p tsconfig.json`
Then re-run the consumer's `tsc --noEmit`.

**Also note:** This codebase has large pre-existing drizzle `TS2769` "No overload
matches this call" noise across documents.ts/auth.ts and unrelated errors in
`artifacts/api-server/src/routes/ai.ts` (broken OpenAI voice feature). These are NOT
caused by your edits — filter them out when checking your own changes.
