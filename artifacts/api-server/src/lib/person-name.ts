// A subcontractor-linked primary contact's name lives on TWO rows that are
// meant to mirror each other: subcontractors.contactFirstName/contactLastName
// (what the Contacts directory reads AND writes directly) is copied onto the
// linked people row on every subcontractor edit (see subcontractors.ts PATCH).
// That mirror is copy-on-write, not a live join — if its WHERE clause ever
// misses the right row (e.g. no people row flagged isPrimaryContact for that
// subcontractor), the people row silently keeps stale data forever, even
// though the "canonical" edit form (Contacts) shows the correct value.
//
// Every reader that needs a subcontractor-linked person's name/surname
// (Team tab, portal invite validation, etc.) should go through this helper
// instead of trusting people.name/firstName/lastName on their own — it
// prefers the subcontractor's own fields (proven fresh, since that's what
// was just edited) and only falls back to the people row's own columns for
// an in-house contact with no subcontractor link, where people.* IS the
// canonical record.
export function canonicalPersonName(
  person: { firstName?: string | null; lastName?: string | null; name: string },
  sub?: { contactFirstName?: string | null; contactLastName?: string | null; contactName?: string | null } | null,
): { firstName: string | null; lastName: string | null; name: string } {
  const subFirst = sub?.contactFirstName?.trim();
  const subLast = sub?.contactLastName?.trim();
  if (subFirst && subLast) {
    return { firstName: subFirst, lastName: subLast, name: sub?.contactName?.trim() || `${subFirst} ${subLast}` };
  }
  const personFirst = person.firstName?.trim();
  const personLast = person.lastName?.trim();
  if (personFirst && personLast) {
    return { firstName: personFirst, lastName: personLast, name: person.name };
  }
  return { firstName: person.firstName ?? null, lastName: person.lastName ?? null, name: person.name };
}
