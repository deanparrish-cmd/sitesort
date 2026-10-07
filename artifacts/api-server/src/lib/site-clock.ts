// The site clock (#114). Every project has an IANA timezone and a daily close
// time ("HH:MM", site time). Check-in "today", the automatic close and every
// check-in time a person reads are worked out on THIS clock, so a site in
// London reads the same to a manager in Madrid. No external deps.

export const DEFAULT_SITE_TZ = "Europe/London";
export const DEFAULT_SITE_CLOSE = "20:00";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidCloseTime(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function safeTz(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_SITE_TZ;
}

// Offset (ms, positive east of UTC) of `tz` at the given instant.
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  return Date.UTC(m.year!, m.month! - 1, m.day!, m.hour!, m.minute!, m.second!) - date.getTime();
}

// YYYY-MM-DD calendar date on the site clock for the given instant.
export function siteDateStr(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeTz(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// UTC instant of wall-clock `hhmm` on `dateStr` in `tz`. Two passes so a DST
// change between the guess and the answer still lands on the right hour.
export function wallClockUtc(dateStr: string, hhmm: string, tz: string): Date {
  const zone = safeTz(tz);
  const guess = new Date(`${dateStr}T${hhmm}:00Z`);
  let t = new Date(guess.getTime() - tzOffsetMs(guess, zone));
  t = new Date(guess.getTime() - tzOffsetMs(t, zone));
  return t;
}

// The first site close strictly AFTER a check-in. Erring late: someone who
// checks in after today's close (a night shift) is closed at the NEXT one.
export function closeDueAfter(checkedInAt: Date, tz: string, closeTime: string): Date {
  const close = isValidCloseTime(closeTime) ? closeTime : DEFAULT_SITE_CLOSE;
  const day = siteDateStr(checkedInAt, tz);
  const sameDay = wallClockUtc(day, close, tz);
  return sameDay.getTime() > checkedInAt.getTime() ? sameDay : wallClockUtc(addDaysStr(day, 1), close, tz);
}

// "HH:MM" on the site clock.
export function siteTime(date: Date, tz: string): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: safeTz(tz) });
}

// Human label for the site clock: "UK time" for London, else the zone's short
// name at that instant (e.g. "CEST").
export function siteTzLabel(tz: string, at: Date = new Date()): string {
  const zone = safeTz(tz);
  if (zone === "Europe/London") return "UK time";
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(at).find(p => p.type === "timeZoneName")?.value;
  return name ? `${name} time` : `${zone} time`;
}
