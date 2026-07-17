import { useEffect, useRef, useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, FileText, AlertTriangle, CreditCard, ClipboardCheck, ChevronLeft, ChevronRight, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  relatedEntityId?: string | null;
  relatedEntityType?: string | null;
};

function notifIcon(type: string) {
  switch (type) {
    case "new_message": return <MessageSquare className="w-5 h-5 text-blue-500" />;
    case "document_uploaded": return <FileText className="w-5 h-5 text-indigo-500" />;
    case "safety_concern": return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    case "trial_ending": return <CreditCard className="w-5 h-5 text-orange-500" />;
    case "payment_failed": return <CreditCard className="w-5 h-5 text-red-500" />;
    case "daily_report": return <ClipboardCheck className="w-5 h-5 text-teal-500" />;
    default: return <Bell className="w-5 h-5 text-muted-foreground" />;
  }
}

function notifBg(type: string) {
  switch (type) {
    case "new_message": return "bg-blue-100";
    case "document_uploaded": return "bg-indigo-100";
    case "safety_concern": return "bg-amber-100";
    case "trial_ending": return "bg-orange-100";
    case "payment_failed": return "bg-red-100";
    case "daily_report": return "bg-teal-100";
    default: return "bg-muted";
  }
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const SWIPE_THRESHOLD = 50;

interface AlertViewerProps {
  items: AlertItem[];
  startIndex: number;
  onOpenItem: (item: AlertItem) => void;
  onMarkRead: (id: string) => void;
  onClose: () => void;
}

export function AlertViewer({ items, startIndex, onOpenItem, onMarkRead, onClose }: AlertViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [caughtUp, setCaughtUp] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setIndex(startIndex);
    setCaughtUp(false);
  }, [startIndex]);

  const current = caughtUp ? null : items[index];

  useEffect(() => {
    if (current && !current.read) onMarkRead(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const goNext = () => {
    if (index >= items.length - 1) { setCaughtUp(true); return; }
    setIndex(i => i + 1);
  };
  const goPrev = () => {
    if (index <= 0) return;
    setIndex(i => i - 1);
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta <= -SWIPE_THRESHOLD) goNext();
    else if (delta >= SWIPE_THRESHOLD) goPrev();
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {caughtUp || !current ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <PartyPopper className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="font-semibold text-lg">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-1">You've been through every alert.</p>
            <Button variant="accent" className="mt-6" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0", notifBg(current.type))}>
                  {notifIcon(current.type)}
                </div>
                <span className="text-base font-semibold leading-snug">{current.title}</span>
              </DialogTitle>
            </DialogHeader>

            <p className="text-sm text-muted-foreground">{current.message}</p>
            <p className="text-xs text-muted-foreground mt-2">{timeLabel(current.createdAt)}</p>

            <div className="flex items-center justify-center gap-2 mt-6 text-xs font-medium text-muted-foreground">
              <span>{index + 1} of {items.length}</span>
            </div>

            <DialogFooter className="items-center sm:justify-between">
              <div className="flex items-center gap-1.5 order-2 sm:order-1">
                <Button variant="outline" size="sm" onClick={goPrev} disabled={index === 0} aria-label="Previous alert">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={goNext} aria-label="Next alert">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <Button
                variant="accent"
                className="order-1 sm:order-2"
                onClick={() => { onOpenItem(current); onClose(); }}
              >
                Open
              </Button>
            </DialogFooter>
          </>
        )}
      </div>
    </Dialog>
  );
}
