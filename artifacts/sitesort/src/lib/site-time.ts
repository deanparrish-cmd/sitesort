// Check-in times are shown on the SITE's clock (the project's timezone), never
// the viewer's device clock, and labelled, so a manager in Madrid and one in
// Leeds read the same time for the same sign-in. Mirrors api-server
// lib/site-clock.ts; the API sends siteTimeZone / siteTzLabel on each check-in.

export const DEFAULT_SITE_TZ = "Europe/London";

function zone(tz?: string | null): string {
  if (!tz) return DEFAULT_SITE_TZ;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_SITE_TZ;
  }
}

/** "07:45" on the site clock. */
export function fmtSiteTime(iso: string, tz?: string | null): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone(tz) });
}

/** A date on the site clock, e.g. "Tue 7 Oct". */
export function fmtSiteDate(iso: string, tz?: string | null, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Date(iso).toLocaleDateString("en-GB", { ...opts, timeZone: zone(tz) });
}

/** YYYY-MM-DD on the site clock, for grouping by site day. */
export function siteDayKey(iso: string | Date, tz?: string | null): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "UK time" for London, else the zone's short name, e.g. "CEST time". */
export function siteTzLabel(tz?: string | null, at: Date = new Date()): string {
  const z = zone(tz);
  if (z === "Europe/London") return "UK time";
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: z, timeZoneName: "short" }).formatToParts(at).find(p => p.type === "timeZoneName")?.value;
  return name ? `${name} time` : `${z} time`;
}

/** "07:45 UK time". */
export function fmtSiteTimeLabelled(iso: string, tz?: string | null): string {
  return `${fmtSiteTime(iso, tz)} ${siteTzLabel(tz, new Date(iso))}`;
}

/** Timezones offered in project settings: common ones first, then every zone the browser knows. */
export function siteTimeZoneOptions(): string[] {
  const common = ["Europe/London", "Europe/Dublin", "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "Europe/Lisbon", "Europe/Amsterdam"];
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch { /* older browsers: common list only */ }
  return [...common, ...all.filter(z => !common.includes(z))];
}
