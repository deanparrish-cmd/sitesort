import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Send } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import {
  useCreatePlantItem, useUpdatePlantItem, useCreatePlantItemAttachment, useDistributePlantItem,
  useListSubcontractors, useListProjectMembers,
  getListPlantItemsQueryKey, getListPlantItemAttachmentsQueryKey, getListProjectMembersQueryKey, getListSubcontractorsQueryKey,
  type PlantItem, type PlantItemCategory, type PlantItemStatus, type CreatePlantItemAttachmentRequestKind,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_OPTIONS: { value: PlantItemCategory; label: string }[] = [
  { value: "plant_equipment", label: "Plant / Equipment" },
  { value: "materials", label: "Materials" },
];
const STATUS_OPTIONS: { value: PlantItemStatus; label: string }[] = [
  { value: "on_site", label: "On site" },
  { value: "on_order", label: "On order" },
  { value: "off_hired", label: "Off-hired" },
  { value: "depleted", label: "Depleted" },
];
const ATTACHMENT_KINDS = [
  { value: "delivery_ticket", label: "Delivery ticket" },
  { value: "certificate", label: "Plant certificate" },
  { value: "test_certificate", label: "Test certificate" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];

type FormState = {
  name: string; category: PlantItemCategory; quantity: string; unit: string;
  supplierMode: "text" | "contact"; supplierOwnerText: string; supplierContactId: string;
  location: string; status: PlantItemStatus; notes: string; onSiteDate: string; expectedOffHireDate: string;
};

const BLANK: FormState = {
  name: "", category: "plant_equipment", quantity: "", unit: "",
  supplierMode: "text", supplierOwnerText: "", supplierContactId: "",
  location: "", status: "on_site", notes: "", onSiteDate: "", expectedOffHireDate: "",
};

function toForm(item: PlantItem): FormState {
  return {
    name: item.name, category: item.category as PlantItemCategory,
    quantity: item.quantity ?? "", unit: item.unit ?? "",
    supplierMode: item.supplierContactId ? "contact" : "text",
    supplierOwnerText: item.supplierOwnerText ?? "", supplierContactId: item.supplierContactId ?? "",
    location: item.location ?? "", status: item.status as PlantItemStatus, notes: item.notes ?? "",
    onSiteDate: item.onSiteDate ?? "", expectedOffHireDate: item.expectedOffHireDate ?? "",
  };
}

// Add/Edit item dialog + attachment upload (Documents & photos per item) +
// the Allocate dialog — all self-contained (own state/queries), so this new
// feature doesn't need to be wired into the giant project-detail state hook.
export function PlantItemDialogs({
  projectId,
  editingItem, onCloseEdit,
  allocatingItem, onCloseAllocate,
}: {
  projectId: string;
  editingItem: PlantItem | "new" | null;
  onCloseEdit: () => void;
  allocatingItem: PlantItem | null;
  onCloseAllocate: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(BLANK);
  const [attachName, setAttachName] = useState("");
  const [attachKind, setAttachKind] = useState<CreatePlantItemAttachmentRequestKind>("delivery_ticket");
  const [attachFile, setAttachFile] = useState<{ url: string; size: number } | null>(null);
  const [allocateSelected, setAllocateSelected] = useState<Set<string>>(new Set());

  const create = useCreatePlantItem();
  const update = useUpdatePlantItem();
  const createAttachment = useCreatePlantItemAttachment();
  const distribute = useDistributePlantItem();
  const { data: subcontractors } = useListSubcontractors(undefined, { query: { enabled: !!editingItem, queryKey: getListSubcontractorsQueryKey() } });
  const { data: members } = useListProjectMembers(projectId, { query: { enabled: !!allocatingItem, queryKey: getListProjectMembersQueryKey(projectId) } });

  useEffect(() => {
    if (editingItem === "new") setForm(BLANK);
    else if (editingItem) setForm(toForm(editingItem));
    setAttachName(""); setAttachKind("delivery_ticket"); setAttachFile(null);
  }, [editingItem]);

  useEffect(() => { setAllocateSelected(new Set()); }, [allocatingItem]);

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: getListPlantItemsQueryKey(projectId, undefined) });

  const submit = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const data = {
      name: form.name.trim(),
      category: form.category,
      quantity: form.quantity.trim() || null,
      unit: form.unit.trim() || null,
      supplierOwnerText: form.supplierMode === "text" ? (form.supplierOwnerText.trim() || null) : null,
      supplierContactId: form.supplierMode === "contact" ? (form.supplierContactId || null) : null,
      location: form.location.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
      onSiteDate: form.onSiteDate || null,
      expectedOffHireDate: form.expectedOffHireDate || null,
    };
    try {
      if (editingItem === "new") {
        await create.mutateAsync({ projectId, data });
        toast({ title: "Item added" });
      } else if (editingItem) {
        await update.mutateAsync({ projectId, itemId: editingItem.id, data });
        toast({ title: "Item updated" });
      }
      await invalidateList();
      onCloseEdit();
    } catch {
      toast({ title: "Couldn't save item", variant: "destructive" });
    }
  };

  const addAttachment = async () => {
    if (editingItem === "new" || !editingItem || !attachFile || !attachName.trim()) return;
    try {
      await createAttachment.mutateAsync({
        projectId, itemId: editingItem.id,
        data: { name: attachName.trim(), kind: attachKind, fileUrl: attachFile.url, fileSize: attachFile.size },
      });
      toast({ title: "Attached" });
      setAttachName(""); setAttachFile(null);
      await queryClient.invalidateQueries({ queryKey: getListPlantItemAttachmentsQueryKey(projectId, editingItem.id) });
      await invalidateList();
    } catch {
      toast({ title: "Couldn't attach file", variant: "destructive" });
    }
  };

  const toggleAllocate = (userId: string) => {
    setAllocateSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };
  const submitAllocate = async () => {
    if (!allocatingItem || allocateSelected.size === 0) return;
    try {
      await distribute.mutateAsync({ projectId, itemId: allocatingItem.id, data: { userIds: Array.from(allocateSelected) } });
      toast({ title: "Allocated" });
      onCloseAllocate();
    } catch {
      toast({ title: "Couldn't allocate item", variant: "destructive" });
    }
  };

  return (
    <>
      <Dialog open={!!editingItem} onOpenChange={v => { if (!v) onCloseEdit(); }}>
        <DialogHeader>
          <DialogTitle>{editingItem === "new" ? "Add item" : "Edit item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Tower crane, Ready-mix concrete" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as PlantItemCategory }))} className="mt-1 w-full h-9 rounded-lg border border-input bg-background px-2 text-sm">
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as PlantItemStatus }))} className="mt-1 w-full h-9 rounded-lg border border-input bg-background px-2 text-sm">
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Quantity</label>
              <Input value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="e.g. 50" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Unit</label>
              <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="e.g. tonnes, m³, units" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Supplier / owner</label>
            <div className="flex gap-2 mt-1 mb-1.5">
              <button type="button" onClick={() => setForm(f => ({ ...f, supplierMode: "text" }))} className={`text-xs px-2 py-1 rounded-md border ${form.supplierMode === "text" ? "bg-primary/10 border-primary text-primary" : "border-border"}`}>Type a name</button>
              <button type="button" onClick={() => setForm(f => ({ ...f, supplierMode: "contact" }))} className={`text-xs px-2 py-1 rounded-md border ${form.supplierMode === "contact" ? "bg-primary/10 border-primary text-primary" : "border-border"}`}>Pick from directory</button>
            </div>
            {form.supplierMode === "text" ? (
              <Input value={form.supplierOwnerText} onChange={e => setForm(f => ({ ...f, supplierOwnerText: e.target.value }))} placeholder="Supplier or owner name" />
            ) : (
              <select value={form.supplierContactId} onChange={e => setForm(f => ({ ...f, supplierContactId: e.target.value }))} className="w-full h-9 rounded-lg border border-input bg-background px-2 text-sm">
                <option value="">Select…</option>
                {((subcontractors as any[]) ?? []).map(s => <option key={s.id} value={s.id}>{s.companyName}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Location on site</label>
            <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Compound B, Level 3" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">On-site date</label>
              <Input type="date" value={form.onSiteDate} onChange={e => setForm(f => ({ ...f, onSiteDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Expected off-hire / usage date</label>
              <Input type="date" value={form.expectedOffHireDate} onChange={e => setForm(f => ({ ...f, expectedOffHireDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>

          {editingItem && editingItem !== "new" && (
            <div className="pt-2 border-t border-border/60">
              <label className="text-xs font-medium text-muted-foreground">Add a document or photo</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <Input value={attachName} onChange={e => setAttachName(e.target.value)} placeholder="Name (e.g. Delivery ticket 12/07)" className="col-span-2" />
                <select value={attachKind} onChange={e => setAttachKind(e.target.value as CreatePlantItemAttachmentRequestKind)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm col-span-2">
                  {ATTACHMENT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </div>
              <div className="mt-2">
                {attachFile ? (
                  <div className="flex items-center justify-between text-xs bg-muted rounded-lg px-3 py-2">
                    <span>File ready ({formatBytes(attachFile.size)})</span>
                    <button type="button" onClick={() => setAttachFile(null)} className="text-muted-foreground hover:text-destructive">Remove</button>
                  </div>
                ) : (
                  <FileDropZone onUploaded={f => setAttachFile({ url: f.url, size: f.size })} onCleared={() => setAttachFile(null)} />
                )}
              </div>
              <Button type="button" size="sm" className="mt-2" disabled={!attachFile || !attachName.trim()} isLoading={createAttachment.isPending} onClick={addAttachment}>
                Attach
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCloseEdit}>Cancel</Button>
          <Button type="button" onClick={submit} isLoading={create.isPending || update.isPending}>
            {editingItem === "new" ? "Add item" : "Save changes"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!allocatingItem} onOpenChange={v => { if (!v) onCloseAllocate(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="w-4 h-4" /> Allocate item</DialogTitle>
          {allocatingItem && <p className="text-sm text-muted-foreground truncate mt-0.5">{allocatingItem.name}</p>}
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Select team members to allocate this item to. They'll get a notification and their view is tracked.</p>
          {(() => {
            const allocatable = ((members as any[]) ?? []).filter(m => m.userId);
            if (allocatable.length === 0) {
              return <p className="text-sm text-muted-foreground py-4 text-center">No team members with accounts to allocate to.</p>;
            }
            return (
              <div className="max-h-72 overflow-y-auto space-y-1.5 border rounded-lg p-2">
                {allocatable.map((m: any) => (
                  <label key={m.userId} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
                    <input type="checkbox" checked={allocateSelected.has(m.userId)} onChange={() => toggleAllocate(m.userId)} className="w-4 h-4 rounded border-input shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground truncate capitalize">{(m.role ?? "").replace("_", " ")}</p>
                    </div>
                  </label>
                ))}
              </div>
            );
          })()}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCloseAllocate}>Cancel</Button>
          <Button type="button" onClick={submitAllocate} disabled={allocateSelected.size === 0} isLoading={distribute.isPending}>
            Allocate{allocateSelected.size > 0 ? ` (${allocateSelected.size})` : ""}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
