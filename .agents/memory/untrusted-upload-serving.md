---
name: Untrusted upload serving
description: Rules for accepting and serving user-uploaded files without stored-XSS risk
---
Any endpoint that accepts uploads from low-trust users (e.g. portal members) must enforce an extension + MIME allowlist in the multer fileFilter (docs/images only — never HTML/SVG/XML/JS).
The generic /api/uploads/:filename server forces `application/octet-stream` + `Content-Disposition: attachment` + `nosniff` for any active content type, as defense in depth.
**Why:** architect review found portal self-uploads could store HTML/SVG that would render inline on first-party origin when a manager reviewed it (stored XSS).
**How to apply:** when adding any new upload route, copy the memberUpload allowlist pattern in portal.ts; don't rely on the serving layer alone.
