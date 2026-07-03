/**
 * Intercepts all fetch calls to inject the Authorization header
 * if a token is present in localStorage. This allows us to use
 * the generated React Query hooks without modifying them.
 *
 * Team Portal: portal members hold a separate, project-scoped token under
 * `sitesort_portal_token`. Requests to `/api/portal/*` prefer that token so a
 * portal session and a PM dashboard session can coexist in one browser without
 * clobbering each other. Everything else uses the normal `sitesort_token`.
 */
function urlOf(resource: RequestInfo | URL): string {
  if (typeof resource === "string") return resource;
  if (resource instanceof URL) return resource.pathname;
  if (resource instanceof Request) return resource.url;
  return "";
}

export function setupApiInterceptor() {
  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    const [resource, config] = args;
    const isPortal = urlOf(resource).includes("/api/portal/");
    const portalToken = localStorage.getItem("sitesort_portal_token");
    const token = isPortal && portalToken ? portalToken : localStorage.getItem("sitesort_token");

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
