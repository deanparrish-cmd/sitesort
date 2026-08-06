import { useState } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { QrCode, Share2, FolderOpen, ChevronDown, ChevronRight } from "lucide-react";
import { useDetail } from "../context";

type Checkin = {
  id: string;
  workerName: string;
  photoUrl: string;
  checkedInAt: string;
};

function CheckinCard({ ci, setSharingDoc }: { ci: Checkin; setSharingDoc: (d: any) => void }) {
  const photoSrc = ci.photoUrl.startsWith("/uploads/") ? ci.photoUrl.replace("/uploads/", "/api/uploads/") : ci.photoUrl;
  const dt = new Date(ci.checkedInAt);
  const dateStr = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rounded-xl overflow-hidden border bg-card shadow-sm">
      <div className="aspect-square bg-muted relative cursor-pointer" onClick={() => window.open(photoSrc, '_blank', 'noopener,noreferrer')}>
        <img src={photoSrc} alt={ci.workerName} className="w-full h-full object-contain" />
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm truncate">{ci.workerName}</p>
        <p className="text-muted-foreground text-xs mt-0.5">{dateStr}</p>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-muted-foreground text-xs">{timeStr}</p>
          <button
            type="button"
            onClick={() => setSharingDoc({ type: "photo", id: ci.id, name: `Check-in: ${ci.workerName}`, version: null, fileUrl: photoSrc })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground hover:text-primary hover:bg-muted transition-colors shrink-0"
            title="Share check-in"
          >
            <Share2 className="w-3.5 h-3.5" />Share
          </button>
        </div>
      </div>
    </div>
  );
}

export function CheckinsTab() {
  const {
    checkins,
    siteBoardUrl,
    setSharingDoc,
  } = useDetail();
  // Only today's photos are laid out as cards. Every earlier day is collapsed
  // into a dated folder row (newest first) that expands on demand, so the tab
  // never fills up with old photos.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  const todayKey = new Date().toDateString();
  const today: Checkin[] = [];
  const byDay = new Map<string, Checkin[]>(); // insertion order = newest first (API sorts desc)
  for (const ci of checkins as Checkin[]) {
    const key = new Date(ci.checkedInAt).toDateString();
    if (key === todayKey) today.push(ci);
    else {
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(ci);
    }
  }

  return (
    <>
        <TabsContent value="checkins">
          <PageHeader
            level="section"
            className="mb-4"
            title="Site Check-Ins"
            description="Workers who checked in on site via the QR code board."
            actions={<>
              {siteBoardUrl && (
                <a
                  href={siteBoardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium"
                >
                  <QrCode className="w-3.5 h-3.5 text-primary" /> View Site Board
                </a>
              )}
              <span className="text-sm text-muted-foreground whitespace-nowrap">{checkins.length} {checkins.length === 1 ? "check-in" : "check-ins"}</span>
            </>}
          />

          {checkins.length === 0 ? (
            <Card className="p-12 text-center border-dashed border-2">
              <p className="text-muted-foreground font-medium">No check-ins yet.</p>
              <p className="text-muted-foreground text-sm mt-1">Workers can check in by scanning the site board QR code.</p>
            </Card>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">Today</h3>
                {today.length === 0 ? (
                  <Card className="p-6 text-center border-dashed border-2">
                    <p className="text-muted-foreground text-sm">No check-ins yet today.</p>
                  </Card>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {today.map(ci => <CheckinCard key={ci.id} ci={ci} setSharingDoc={setSharingDoc} />)}
                  </div>
                )}
              </div>

              {byDay.size > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">Previous days</h3>
                  <div className="space-y-2">
                    {[...byDay.entries()].map(([key, list]) => {
                      const open = !!openDays[key];
                      const label = new Date(list[0].checkedInAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
                      return (
                        <div key={key} className="rounded-xl border bg-card overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setOpenDays(prev => ({ ...prev, [key]: !prev[key] }))}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                            data-testid={`button-checkin-day-${key.replaceAll(" ", "-")}`}
                          >
                            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                            <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                            <span className="font-semibold text-sm flex-1 truncate">{label}</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{list.length} {list.length === 1 ? "check-in" : "check-ins"}</span>
                          </button>
                          {open && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-4 pt-1">
                              {list.map(ci => <CheckinCard key={ci.id} ci={ci} setSharingDoc={setSharingDoc} />)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
    </>
  );
}
