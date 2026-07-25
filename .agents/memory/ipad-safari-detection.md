---
name: iPad Safari detection & web push
description: iPads masquerade as Macs in the UA; iPadOS web push needs Home Screen install.
---

**Rule:** iPad Safari runs in "desktop mode" and reports `Macintosh; Intel Mac OS X` in the UA. Detect iPads with UA-Mac + `navigator.maxTouchPoints > 1`. Any iOS/iPadOS-gated behavior (web push requires Add-to-Home-Screen, install prompts, PWA quirks) must use this detection or iPads slip through as desktops.

**Why:** A tablet user "turned notifications on", pushManager.subscribe stored an APNs endpoint, but Apple never delivered — the app thought it was a Mac and skipped the mandatory Home Screen install step. Server-side the subscription looks perfectly valid.

**How to apply:** Portal push helpers (`isIOS()` in portal-push.ts) already do this; reuse it for any new device-gated UX. When debugging "subscribed but no alerts" on Apple devices, check the stored user_agent — "Macintosh" + tablet report = iPad not installed to Home Screen.
