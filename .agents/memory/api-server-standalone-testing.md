---
name: Running api-server lib code standalone for tests
description: How to execute api-server library functions (e.g. report generators) outside the HTTP server in this repo
---

The code_execution sandbox can NOT do auth-gated HTTP testing here:
- `process.env.JWT_SECRET` is NOT exposed in the sandbox, so you cannot mint a valid JWT there.
- Importing `jsonwebtoken` (or other api-server deps) from the workspace root fails with ERR_MODULE_NOT_FOUND (not hoisted to root node_modules).
- `npx tsx` cannot download (registry blocked).

To run an api-server lib function (e.g. `generateDailyReportForProject`) standalone, bundle it with esbuild mirroring `artifacts/api-server/build.mjs`:
- Use the `esbuild-plugin-pino` plugin (the logger imports pino) AND set `outdir` (NOT `outfile`) — the pino plugin emits worker files and silently fails the build with `outfile`.
- Include the same banner that shims `require`/`__dirname` for esm, `format: "esm"`, `outExtension { ".js": ".mjs" }`, `external: ["*.node","pg-native"]`.
- Then `node dist-tmp/<entry>.mjs`. Clean up temp files after.

**Why:** verifying collation/DB logic end-to-end needed the real function against the real DB; HTTP + JWT was a dead end in the sandbox. Counts/content can also just be spot-checked with `executeSql`.
