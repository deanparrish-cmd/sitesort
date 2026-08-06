---
name: iPad Safari detection & web push
description: iPads masquerade as Macs in the UA; iPadOS web push needs Home Screen install.
---

**Rule:** iPad Safari runs in "desktop mode" and reports `Macintosh; Intel Mac OS X` in the UA. Detect iPads with UA-Mac + `navigator.maxTouchPoints > 1`. Any iOS/iPadOS-gated behavior (web push requires Add-to-Home-Screen, install prompts, PWA quirks) must use this detection or iPads slip through as desktops.

**Why:** A tablet user "turned notifications on", pushManager.subscribe stored an APNs endpoint, but Apple never delivered — the app thought it was a Mac and skipped the mandatory Home Screen install step. Server-side the subscription looks perfectly valid.

**How to apply:** Portal push helpers (`isIOS()` in portal-push.ts) already do this; reuse it for any new device-gated UX. When debugging "subscribed but no alerts" on Apple devices, check the stored user_agent — "Macintosh" + tablet report = iPad not installed to Home Screen.

## Foreground push suppression
iOS suppresses the system notification banner while the PWA is in the FOREGROUND, even when the server delivered to Apple successfully (web-push logs devices/delivered). Fix pattern: the service worker's push handler also postMessage()s the payload to all open window clients, and the portal shell listens on navigator.serviceWorker and shows an in-app toast + invalidates queries. Diagnose "no alert" reports by checking the server's `web-push: user send` log line first — delivered>0 means the problem is device-side (foreground, permission, or not installed to Home Screen).
