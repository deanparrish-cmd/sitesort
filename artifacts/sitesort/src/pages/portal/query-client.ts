import { QueryClient } from "@tanstack/react-query";

// A QueryClient scoped to the Team Portal, separate from the dashboard client so
// members always see fresh data on a long-lived (30-day) session:
//   • refetchOnMount + refetchOnWindowFocus — every navigation / return-to-app
//     re-checks the server (the dashboard client deliberately disables focus
//     refetch; the portal wants the opposite).
//   • staleTime 0 — a focus/mount refetch always actually hits the network.
// Time-sensitive sections additionally poll (see PORTAL_LIVE_REFETCH) while the
// tab is visible. A visibilitychange fallback in PortalLayout covers standalone
// PWAs where the browser's own focus event may not fire.
// Poll interval (ms) for sections whose content is time-sensitive: Drawings,
// Site Issues, site updates (Overview/General), and "Shared with me". Only fires
// while the document is visible (refetchIntervalInBackground defaults to false).
export const PORTAL_LIVE_REFETCH = 60_000;

export const portalQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One quick retry for a dropped connection or server error, none for a
      // refusal (4xx): a single blip on site shouldn't flash "couldn't update".
      retry: (count, err) => {
        const status = (err as unknown as { status?: number })?.status;
        return count < 1 && !(status && status < 500);
      },
      staleTime: 0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Every list on screen re-checks every minute while visible (#133), so
      // "Updated X ago" stays true and 15+ minutes old really means updates
      // have stopped.
      refetchInterval: PORTAL_LIVE_REFETCH,
    },
  },
});
