// Shared assignment & accountability helpers (F1). One place to decide whether a
// record is "overdue", so snags, safety concerns, permits and certifications all
// agree on the rule. Overdue is always DERIVED (never a stored/manual flag):
// a record is overdue when it has a due date in the past and isn't yet "done".
//
// `dueDate` is a date column, surfaced by drizzle as a "YYYY-MM-DD" string.
// `isDone` is the per-type "closed" predicate the caller supplies (e.g. a snag is
// done when status === "resolved"; a permit/cert when it's been archived/renewed).
export function isOverdue(
  dueDate: string | null | undefined,
  isDone: boolean,
  now: Date = new Date(),
): boolean {
  if (!dueDate || isDone) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  const due = new Date(y, m - 1, d);
  return due.getTime() < today.getTime();
}
