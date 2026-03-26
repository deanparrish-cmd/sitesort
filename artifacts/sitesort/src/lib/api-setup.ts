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
      if (config) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${token}`
        };
      } else {
        args[1] = { 
          headers: { 
            Authorization: `Bearer ${token}` 
          } 
        };
      }
    }
    
    return originalFetch(...args);
  };
}
