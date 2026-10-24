// Which documents require a 4-digit PIN to sign off.
//
// Default sign-off is a single deliberate confirm action — attributed and
// timestamped exactly like before, just without PIN entry. The PIN gate is
// reserved for safety-critical document types (method statements / RAMS,
// permits, and safety documents such as inductions), plus any document the
// PM explicitly flags with the per-document "require PIN sign-off" toggle.
// Drawings joined 2026-10-23 (Dean, option a): new drawings and new revisions
// need a PIN signature; existing drawings keep their own requires_acknowledgment
// (no data changed), and nothing already recorded is reset.
export const PIN_REQUIRED_DOC_TYPES = new Set(["drawing", "method_statement", "permit", "safety"]);

export function pinRequiredForDoc(doc: { type: string; requirePinSignoff: boolean }): boolean {
  return PIN_REQUIRED_DOC_TYPES.has(doc.type) || doc.requirePinSignoff;
}

// Shown when someone tries to sign off a revision that has been replaced.
export const SUPERSEDED_SIGNOFF_MESSAGE = "This revision has been replaced by a newer one, so it can't be signed off. Open the latest revision and sign off that.";
// Same, when the newer revision hasn't been shared with this portal member:
// telling them to open it would send them to something they can't open.
export const SUPERSEDED_NOT_SHARED_SIGNOFF_MESSAGE = "This revision has been replaced by a newer one, so it can't be signed off. The newer revision hasn't been shared with you yet. Ask your project manager to share it.";

// Open before sign-off (Dean, 2026-10-22): a signature means "I have read
// this and I accept it", and that record is what gets produced after an
// incident. Signing needs a recorded open of this revision by this person
// (opening it, or downloading the file in the portal). Before this, signing
// an unopened document wrote an open time anyway: the record claimed a read
// that never happened.
export const OPEN_FIRST_MESSAGE = "Open the document first. You can sign it off once you've opened it.";

// Reach the end before sign-off (Dean, 2026-10-24): a signature (PIN or
// acknowledgement, one rule) needs the phone to have reported that this
// person reached the end of this revision in the viewer, or, for a file
// SiteSort can't draw, that they opened it outside SiteSort. The record says
// "reached the end", never "read". Mostly seen by phones on code from before
// this rule; the portal's blue update bar (since 2026-10-21) and a fresh
// start both load the new code (the service worker fetches pages network-first).
export const REACH_END_FIRST_MESSAGE = "Your SiteSort app needs updating before you can sign this off. Tap Reload in the blue bar at the top of the screen, or close SiteSort completely and open it again. Then open the document and scroll to the end.";

// How the end was reached, as the phone reports it. Stored on the person's
// copy (document_distributions.reached_end_how) and on the audit row.
export const REACHED_END_HOWS = ["scrolled", "one_screen", "opened_outside_render_failed", "opened_outside"] as const;
export type ReachedEndHow = typeof REACHED_END_HOWS[number];

// The same split the viewer makes: PDFs and images are drawn in SiteSort,
// anything else opens outside it.
const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"];
export function fileKindOf(fileUrl: string | null | undefined): "pdf" | "image" | "other" | "none" {
  if (!fileUrl) return "none";
  const ext = (fileUrl.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  return ext === "pdf" ? "pdf" : IMAGE_EXTS.includes(ext) ? "image" : "other";
}
// A file SiteSort draws can only be reported as reached in the viewer, or as
// opened outside because it wouldn't draw; anything else only as opened outside.
export function reachedEndHowAllowed(fileUrl: string | null | undefined, how: unknown): how is ReachedEndHow {
  const kind = fileKindOf(fileUrl);
  if (kind === "none") return false;
  if (kind === "other") return how === "opened_outside";
  return how === "scrolled" || how === "one_screen" || how === "opened_outside_render_failed";
}

// Upload refusals (2026-10-21): replacing a document shared on the Team
// Portal needs an explicit answer about who gets the new revision.
export const SHARE_ANSWER_REQUIRED_MESSAGE = "This document is shared on the Team Portal, so the new revision needs a decision about who gets it. Reload the page and upload again.";
export const SHARE_LIST_CHANGED_MESSAGE = "Who this document is shared with changed while you were uploading. Check the list and upload again.";

// RAMS, permits and safety documents always require sign-off (Dean,
// 2026-10-21): a method statement nobody can sign let close-out report a
// project complete. Applied at upload; documents already stored keep their
// setting until Dean decides what to do with them.
export function signOffRequiredOnUpload(type: string, requested: unknown): boolean {
  return requested === true || requested === "true" || PIN_REQUIRED_DOC_TYPES.has(type);
}
