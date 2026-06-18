/**
 * Intercepts all fetch calls to inject the Authorization header
 * if a token is present in localStorage. This allows us to use
 * the generated React Query hooks without modifying them.
 */
export function setupApiInterceptor() {
  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    const [resource, config] = args;
    const token = localStorage.getItem('sitesort_token');

    if (token) {
      const existing = config?.headers;
      const normalized: Record<string, string> =
        existing instanceof Headers
          ? Object.fromEntries(existing.entries())
          : (existing as Record<string, string>) ?? {};

      const newHeaders = { ...normalized, Authorization: `Bearer ${token}` };

      if (config) {
        config.headers = newHeaders;
      } else {
        args[1] = { headers: newHeaders };
      }
    }

    return originalFetch(...args);
  };
}
