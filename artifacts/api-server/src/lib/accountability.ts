import { and, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm";
import { photosTable } from "@workspace/db/schema";

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

// One place to decide which `photos` rows count as a "site issue". Snag and
// safety_concern always do. "work_completed" is also used for ordinary
// dashboard progress photos (which never get a status) — a portal-submitted
// "Work Completed" report always has a status (starts at "new"), so gating on
// `status IS NOT NULL` lets portal reports into issue lists/counts without
// flooding them with historical progress photos.
export function issueCategoryFilter(): SQL {
  return or(
    inArray(photosTable.category, ["snag", "safety_concern"]),
    and(eq(photosTable.category, "work_completed"), isNotNull(photosTable.status)),
  )!;
}
