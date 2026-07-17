---
name: SiteSort typecheck baseline errors
description: Status of pre-existing tsc errors in artifacts/sitesort — baseline is now clean.
---

As of July 2026 the sitesort typecheck baseline is CLEAN: `npx tsc --noEmit -p tsconfig.json`
in `artifacts/sitesort` exits 0. The ~10 old baseline errors (buttonVariants/DialogContent
exports, enum comparisons, orval queryKey mismatch) no longer reproduce after the detail-page
rebuild and earlier hardening passes.

**How to apply:** Treat ANY tsc error in sitesort as a real regression now — do not dismiss
errors as "baseline noise" anymore.
