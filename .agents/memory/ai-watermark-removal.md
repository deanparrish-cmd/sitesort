---
name: AI watermark removal from photos
description: Removing Gemini-style sparkle watermarks from marketing images without smudging
---
Rule: cv2.inpaint smears soft-glow watermarks on textured surfaces (wood grain) — the semi-transparent glow extends past any threshold mask and TELEA/NS fills look blotchy. Rectangular magick composite patches leave visible seams against shadow gradients.

**Why:** took 5+ attempts on the SiteSort landing hero (before/after desk image); every inpaint or hard patch drew user complaints (smudgy, broken grain, broken table seam line).

**How to apply:** use `cv2.seamlessClone(src, img, full_mask, center, cv2.NORMAL_CLONE)` with a clean texture sample from the SAME rows (horizontal grain) beside the watermark — it blends illumination at borders and keeps texture crisp. Cover the full glow extent (map it via pixel-value row scans, not eyeballing thumbnails). Never stack edits on edits; always restart from the pristine source crop. Avoid broad unsharp bands — they streak grain and break plank seam lines.
