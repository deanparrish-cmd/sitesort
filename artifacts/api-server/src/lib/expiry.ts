// Shared expiry-status helper (F1). One place to turn an expiry date into a
// status + days-remaining, so permits, insurance certs, the compliance overview,
// the QR board and the reminder job all agree on the thresholds. Before this,
// ~11 sites each reimplemented their own bands (exact-day / 7 / 30) with mixed
// rounding — see CLAUDE.md "Issues discovered" note. The canonical rule:
//   days < 0            → "expired"
//   0 <= days <= 30     → "expiring_soon"
//   days > 30           → "active"
//
// Like `isOverdue`, comparison is done at local midnight so time-of-day never
// flips the result. `expiryDate` is a date column, surfaced by drizzle as a
// "YYYY-MM-DD" string.
export type ExpiryStatus = "active" | "expiring_soon" | "expired";

export const EXPIRING_SOON_DAYS = 30;

// Whole calendar days from `now` (date-only) until the expiry date.
// 0 = expires today, negative = already expired.
export function daysUntilExpiry(
  expiryDate: string,
  now: Date = new Date(),
): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expiryDate.slice(0, 10).split("-").map(Number);
  const expiry = new Date(y, m - 1, d);
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

export function expiryStatus(
  expiryDate: string,
  now: Date = new Date(),
): ExpiryStatus {
  const days = daysUntilExpiry(expiryDate, now);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return "active";
}
