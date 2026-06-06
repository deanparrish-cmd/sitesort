const STORAGE_KEY = "sitesort_attribution";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
] as const;

export type Attribution = Partial<Record<(typeof UTM_KEYS)[number], string>> & {
  landing_path?: string;
  captured_at?: string;
};

/**
 * Reads UTM / referral params from the current URL. Persists the first-touch
 * attribution to localStorage so it survives navigation into the signup flow.
 */
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const fromUrl: Attribution = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) fromUrl[key] = value;
  }

  const existing = getAttribution();

  if (Object.keys(fromUrl).length > 0) {
    const next: Attribution = {
      ...fromUrl,
      landing_path: window.location.pathname,
      captured_at: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
    return next;
  }

  return existing;
}

export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}

/**
 * Builds a query string from the currently captured attribution so it can be
 * appended to the register / login links and carried into the signup flow.
 */
export function attributionQuery(): string {
  const attribution = getAttribution();
  const params = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = attribution[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Appends the captured attribution params to a path, preserving any params
 * the path already declares.
 */
export function withAttribution(path: string): string {
  const query = attributionQuery();
  if (!query) return path;
  return path.includes("?") ? `${path}&${query.slice(1)}` : `${path}${query}`;
}
