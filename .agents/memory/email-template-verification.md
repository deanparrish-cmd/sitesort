---
name: Email template verification without sending
description: How to render/verify SiteSort transactional emails offline, and a Resend SDK serialization gotcha
---

# Verifying transactional emails without sending real mail

The api-server email lib (`artifacts/api-server/src/lib/email.ts`) sends via Resend, which uses `fetch` under the hood.

**To inspect rendered HTML/text without sending:** override `globalThis.fetch` to capture the request body BEFORE importing the email module, then call each `send*` function. The captured JSON body contains `from`, `to`, `subject`, `html`, `text`, `reply_to`.

**Gotcha — Resend serializes `replyTo` → `reply_to` over the wire.** You set `replyTo` in the SDK call, but the outgoing request body field is `reply_to`. Check both when asserting reply-to is configured.

**Running the check:** `tsx` is not installed in the api-server package. Bundle the throwaway entry with esbuild (`packages: "external"`) and write the `outfile` INTO `artifacts/api-server/` (not `/tmp`) so Node can resolve `resend` from the package's `node_modules`. Then `node` the bundle.

**Why:** lets you confirm branding, fallbacks, and reply-to for every template offline instead of spamming a live inbox.
