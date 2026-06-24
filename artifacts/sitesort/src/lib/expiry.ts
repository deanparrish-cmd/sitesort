// Frontend mirror of the API's shared expiry helper (artifacts/api-server/src/
// lib/expiry.ts). Keeps the client's "expiring soon" bands in lock-step with the
// server so a permit/cert never looks "active" in the list but "expiring" in an
// email. Canonical rule: days < 0 → expired, 0..30 → expiring_soon, else active.
export type ExpiryStatus = "active" | "expiring_soon" | "expired";

export const EXPIRING_SOON_DAYS = 30;

// Whole calendar days from today (date-only) until the expiry date.
// 0 = expires today, negative = already expired.
export function daysUntilExpiry(expiryDate: string, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = expiryDate.slice(0, 10).split("-").map(Number);
  const expiry = new Date(y, m - 1, d);
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

export function expiryStatus(expiryDate: string, now: Date = new Date()): ExpiryStatus {
  const days = daysUntilExpiry(expiryDate, now);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return "active";
}
