// Which documents require a 4-digit PIN to sign off.
//
// Default sign-off is a single deliberate confirm action — attributed and
// timestamped exactly like before, just without PIN entry. The PIN gate is
// reserved for safety-critical document types (method statements / RAMS,
// permits, and safety documents such as inductions), plus any document the
// PM explicitly flags with the per-document "require PIN sign-off" toggle.
export const PIN_REQUIRED_DOC_TYPES = new Set(["method_statement", "permit", "safety"]);

export function pinRequiredForDoc(doc: { type: string; requirePinSignoff: boolean }): boolean {
  return PIN_REQUIRED_DOC_TYPES.has(doc.type) || doc.requirePinSignoff;
}

// Shown when someone tries to sign off a revision that has been replaced.
export const SUPERSEDED_SIGNOFF_MESSAGE = "This revision has been replaced by a newer one, so it can't be signed off. Open the latest revision and sign off that.";

// RAMS, permits and safety documents always require sign-off (Dean,
// 2026-10-21): a method statement nobody can sign let close-out report a
// project complete. Applied at upload; documents already stored keep their
// setting until Dean decides what to do with them.
export function signOffRequiredOnUpload(type: string, requested: unknown): boolean {
  return requested === true || requested === "true" || PIN_REQUIRED_DOC_TYPES.has(type);
}
