// Builds the deep-link URL for an item referenced from an activity/notification
// entry (document, photo/issue, permit, plant item, daily report). Consumed by
// use-project-detail.tsx's on-mount query-param handlers, which switch tab and
// open the item (mirrors the existing ?photo=/?report= pattern).
export function itemDeepLink(projectId: string, itemType: string | undefined, itemId: string | undefined): string | null {
  if (!projectId || !itemId) return null;
  switch (itemType) {
    case "document":
      return `/projects/${projectId}?tab=documents&document=${itemId}`;
    case "photo":
    case "photo_attachment":
      return `/projects/${projectId}?tab=issues&photo=${itemId}`;
    case "permit":
      return `/projects/${projectId}?tab=permits&permit=${itemId}`;
    case "plant_item":
    case "plant_item_attachment":
      return `/projects/${projectId}?tab=plant`;
    case "daily_report":
      return `/projects/${projectId}?report=${itemId}`;
    default:
      return null;
  }
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export type NotificationLike = { type: string; relatedEntityId?: string | null };

/**
 * Resolves a notification to its deep-link target and navigates there. Shared
 * by the dashboard's "Recent Activity" AlertViewer and the Notifications page,
 * which previously duplicated this per-type resolution independently. Returns
 * true if it navigated; the caller falls back to its own default handling
 * (message/billing types, or a plain notifLink) when this returns false.
 */
export async function navigateToNotification(n: NotificationLike, navigate: (to: string) => void): Promise<boolean> {
  const id = n.relatedEntityId;
  if (!id) return false;
  const h = authHeaders();

  if (n.type === "daily_report") {
    const res = await fetch(`/api/daily-reports/${id}`, { headers: h }).catch(() => null);
    if (!res?.ok) return false;
    const r = await res.json();
    navigate(`/projects/${r.projectId}?tab=reports&report=${id}`);
    return true;
  }

  if (n.type === "safety_concern" || n.type === "portal_issue_logged") {
    const res = await fetch(`/api/photos/${id}`, { headers: h }).catch(() => null);
    if (!res?.ok) return false;
    const photo = await res.json();
    const statusParam = n.type === "portal_issue_logged" ? "&issueStatus=new" : "";
    navigate(`/projects/${photo.projectId}?tab=issues&photo=${id}${statusParam}`);
    return true;
  }

  if (n.type === "document_uploaded") {
    const res = await fetch(`/api/documents/${id}`, { headers: h }).catch(() => null);
    if (!res?.ok) return false;
    const doc = await res.json();
    navigate(`/projects/${doc.projectId}?tab=documents&document=${id}`);
    return true;
  }

  // A portal member's "My documents" self-upload / a plant item logged from the
  // portal — relatedEntityId is already the PROJECT id (no single-row fetch
  // exists for either), so these go straight to the relevant tab.
  if (n.type === "member_document_uploaded") {
    navigate(`/projects/${id}?tab=teamportal`);
    return true;
  }
  if (n.type === "portal_plant_item_logged") {
    navigate(`/projects/${id}?tab=plant`);
    return true;
  }

  return false;
}
