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
export const portalQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

// Poll interval (ms) for sections whose content is time-sensitive: Drawings,
// Site Issues, site updates (Overview/General), and "Shared with me". Only fires
// while the document is visible (refetchIntervalInBackground defaults to false).
export const PORTAL_LIVE_REFETCH = 60_000;
