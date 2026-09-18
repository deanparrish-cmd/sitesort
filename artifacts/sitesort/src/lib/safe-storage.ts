/**
 * Some browsers (private modes, blocked site data, embedded webviews) make
 * localStorage/sessionStorage throw on access. Much of the app reads them at
 * start-up, so one blocked read would blank every page, including the public
 * QR site board that workers open on their own phones. If storage is unusable,
 * swap in an in-memory stand-in so the app runs (nothing persists, which is the
 * best we can do). Imported first in main.tsx so it runs before anything else.
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  } as Storage;
}

function usable(get: () => Storage): boolean {
  try {
    const s = get();
    const probe = "__sitesort_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (!usable(() => window[name])) {
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch { /* nothing more we can do */ }
  }
}
