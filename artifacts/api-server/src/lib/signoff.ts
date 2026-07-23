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
