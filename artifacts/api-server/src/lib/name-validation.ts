// Requires a "First Last" shape: at least two whitespace-separated tokens, each
// 2+ characters — mirrors the firstName/lastName min(2) rule already enforced
// on people/subcontractor contacts, for the handful of routes (dashboard team
// invites, self-registration, legacy invite-accept) that only ever collected a
// single free-text name field and let a surname-less record like "Amy" through.
const FULL_NAME_PATTERN = /^\S{2,}(?:\s+\S{2,})+$/;

export function parseFullPersonName(value: unknown): { success: true; data: string } | { success: false; message: string } {
  if (typeof value !== "string" || !FULL_NAME_PATTERN.test(value.trim())) {
    return { success: false, message: "Enter a first name and surname (2+ characters each)." };
  }
  return { success: true, data: value.trim() };
}
