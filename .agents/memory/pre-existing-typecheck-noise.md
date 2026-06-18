---
name: Pre-existing typecheck noise (api-server & api-zod)
description: Which tsc errors in this repo are pre-existing and runtime-safe, so you don't chase phantom failures.
---

`tsc --noEmit` in this repo surfaces errors that predate your changes and do NOT
break runtime (Vite/esbuild transpile fine). Do not try to "fix" them as part of
an unrelated task.

- **api-server `TS2769: No overload matches this call`** — appears on essentially
  every drizzle `.update()` / `.insert()` / some `.select()` call across
  `routes/*.ts` (documents.ts, channels.ts, auth.ts, ai.ts, etc.). It's a
  drizzle-orm ↔ pg type-overload mismatch, not a real bug.
- **api-zod `TS2308: ... already exported a member named 'ListDocumentsParams' / 'ListPhotosParams'`**
  — `lib/api-zod/src/index.ts` does `export * from "./generated/api"` AND
  `export * from "./generated/types"`, which both export the same param names.
  Pre-existing ambiguity from orval codegen.
- **api-server `ai.ts` Buffer/BlobPart** errors — also pre-existing.

**How to apply:** when you typecheck after a change, filter tsc output to the
file/line ranges you actually touched. If an error sits on a line you didn't
write and matches the patterns above, it's noise. Also note `head -N` can
truncate alphabetically-later files (e.g. documents.ts after channels.ts) out of
view — don't conclude "clean" from a truncated list.
