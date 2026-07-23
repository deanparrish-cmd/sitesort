import { useState } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ListRow, Pill } from "@/components/ui/list-row";
import { Plus, Send, Pencil, Trash2, FileText, Archive, RefreshCw, Share2 } from "lucide-react";
import { ShareModal } from "@/components/share-modal";
import { ArchiveIssueDialog } from "../dialogs/archive-issue-dialog";
import { cn } from "@/lib/utils";
import { useDetail } from "../context";
import { PlantItemDialogs } from "../dialogs/plant-dialogs";
import { useListPlantItems, useDeletePlantItem, getListPlantItemsQueryKey, type PlantItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_FILTERS = [
  { value: "all", label: "All" },
  { value: "plant_equipment", label: "Plant / Equipment" },
  { value: "materials", label: "Materials" },
] as const;
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "on_site", label: "On site" },
  { value: "on_order", label: "On order" },
  { value: "off_hired", label: "Off-hired" },
  { value: "depleted", label: "Depleted" },
] as const;
const STATUS_PILL: Record<string, string> = {
  on_site: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  on_order: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  off_hired: "bg-muted text-muted-foreground",
  depleted: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};
const STATUS_LABEL: Record<string, string> = { on_site: "On site", on_order: "On order", off_hired: "Off-hired", depleted: "Depleted" };

function fmtUpdated(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function PlantTab() {
  const { projectId, caps } = useDetail();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [editingItem, setEditingItem] = useState<PlantItem | "new" | null>(null);
  const [allocatingItem, setAllocatingItem] = useState<PlantItem | null>(null);
  const [sharingItem, setSharingItem] = useState<PlantItem | null>(null);
  const [archivingItemId, setArchivingItemId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const params = { category: category === "all" ? undefined : category, status: status === "all" ? undefined : status, ...(showArchived ? { archived: "true" } : {}) } as any;
  const { data, isLoading } = useListPlantItems(projectId, params, { query: { enabled: !!projectId, queryKey: getListPlantItemsQueryKey(projectId, params) } });
  const deleteItem = useDeletePlantItem();

  const items = (data as PlantItem[]) ?? [];

  const authHeaders = (): Record<string, string> => {
    const t = localStorage.getItem("sitesort_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const refreshList = () => queryClient.invalidateQueries({ queryKey: getListPlantItemsQueryKey(projectId, undefined) });

  const archiveItem = async (itemId: string, reason?: string) => {
    const res = await fetch(`/api/projects/${projectId}/plant-items/${itemId}/archive`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: "Couldn't archive item", description: body?.message, variant: "destructive" });
      return;
    }
    await refreshList();
    toast({ title: "Item archived", description: "Find it under the Archived filter." });
  };

  const restoreItem = async (itemId: string) => {
    const res = await fetch(`/api/projects/${projectId}/plant-items/${itemId}/restore`, { method: "PATCH", headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: "Couldn't restore item", description: body?.message, variant: "destructive" });
      return;
    }
    await refreshList();
    toast({ title: "Item restored" });
  };

  const itemShareText = (item: PlantItem) => {
    const lines = [
      `Plant & Materials — ${item.name}`,
      `Category: ${item.category.replace("_", " ")}`,
      `Status: ${STATUS_LABEL[item.status] ?? item.status}`,
      item.quantity ? `Quantity: ${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "",
      item.location ? `Location: ${item.location}` : "",
      (item.supplierOwnerText || item.supplierContactName) ? `Supplier/Owner: ${item.supplierOwnerText ?? item.supplierContactName}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  };

  const remove = async (item: PlantItem) => {
    if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    try {
      await deleteItem.mutateAsync({ projectId, itemId: item.id });
      await queryClient.invalidateQueries({ queryKey: getListPlantItemsQueryKey(projectId, undefined) });
      toast({ title: "Item deleted" });
    } catch {
      toast({ title: "Couldn't delete item", variant: "destructive" });
    }
  };

  return (
    <TabsContent value="plant">
      <PageHeader
        level="section"
        title="Plant & Materials"
        description="What's on site — plant, equipment, and materials."
        actions={caps.isInternal && (
          <Button size="sm" onClick={() => setEditingItem("new")}>
            <Plus className="w-4 h-4 mr-1.5" /> Add item
          </Button>
        )}
      />

      <div className="flex flex-col sm:flex-row gap-3 my-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_FILTERS.map(f => (
            <button key={f.value} onClick={() => setCategory(f.value)} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors", category === f.value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(f => (
            <button key={f.value} onClick={() => setStatus(f.value)} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors", status === f.value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40")}>
              {f.label}
            </button>
          ))}
          {caps.canManageProjects && (
            <button onClick={() => setShowArchived(v => !v)} className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center gap-1.5", showArchived ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40")}>
              <Archive className="w-3.5 h-3.5" />Archived
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-32 bg-muted rounded-xl" />
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border rounded-xl">{showArchived ? "No archived items." : "No Plant & Materials items yet."}</div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <ListRow
              key={item.id}
              content={<>
                <p className="font-semibold text-sm truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground truncate capitalize">
                  {item.category.replace("_", " ")}
                  {item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : ""}
                  {item.location ? ` · ${item.location}` : ""}
                  {(item.supplierOwnerText || item.supplierContactName) ? ` · ${item.supplierOwnerText ?? item.supplierContactName}` : ""}
                </p>
                {item.lastUpdatedByName && (
                  <p className="text-xs text-muted-foreground mt-0.5">Last updated by {item.lastUpdatedByName}, {fmtUpdated(item.lastUpdatedAt)}</p>
                )}
                {item.attachmentCount > 0 && (
                  <button
                    type="button"
                    onClick={() => caps.isInternal && setEditingItem(item)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mt-0.5 transition-colors"
                    title="View attachments"
                  >
                    <FileText className="w-3 h-3" />{item.attachmentCount} attachment{item.attachmentCount === 1 ? "" : "s"}
                  </button>
                )}
              </>}
              actions={<>
                <Pill className={STATUS_PILL[item.status]}>{STATUS_LABEL[item.status] ?? item.status}</Pill>
                {caps.isInternal && !showArchived && (
                  <>
                    <button type="button" onClick={() => setEditingItem(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />Edit
                    </button>
                    <button type="button" onClick={() => setAllocatingItem(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors" title="Allocate">
                      <Send className="w-3.5 h-3.5" />Allocate
                    </button>
                  </>
                )}
                {caps.isInternal && !showArchived && (
                  <button type="button" onClick={() => setSharingItem(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors" title="Share">
                    <Share2 className="w-3.5 h-3.5" />Share
                  </button>
                )}
                {caps.canManageProjects && !showArchived && (
                  <button type="button" onClick={() => setArchivingItemId(item.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors" title="Archive">
                    <Archive className="w-3.5 h-3.5" />Archive
                  </button>
                )}
                {caps.canManageProjects && showArchived && (
                  <button type="button" onClick={() => restoreItem(item.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors" title="Restore">
                    <RefreshCw className="w-3.5 h-3.5" />Restore
                  </button>
                )}
                {caps.canManageProjects && (
                  <button type="button" onClick={() => remove(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </>}
            />
          ))}
        </div>
      )}

      <PlantItemDialogs
        projectId={projectId}
        editingItem={editingItem}
        onCloseEdit={() => setEditingItem(null)}
        allocatingItem={allocatingItem}
        onCloseAllocate={() => setAllocatingItem(null)}
      />
      <ArchiveIssueDialog photoId={archivingItemId} onClose={() => setArchivingItemId(null)} archiveIssue={archiveItem} itemLabel="item" />
      <ShareModal
        open={!!sharingItem}
        onClose={() => setSharingItem(null)}
        entityType="plant_item"
        entityId={sharingItem?.id ?? ""}
        entityName={sharingItem?.name ?? ""}
        projectId={projectId}
        shareText={sharingItem ? itemShareText(sharingItem) : undefined}
      />
    </TabsContent>
  );
}
