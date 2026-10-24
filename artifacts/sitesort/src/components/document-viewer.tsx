import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, ExternalLink, FileSignature, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SignOffPinCard } from "@/components/sign-off-pin-card";
import { DocStatePill } from "@/components/doc-state";
import type { useSignOffFlow } from "@/hooks/use-sign-off-flow";
import { fileExt, fileHref, isCadFile, downloadFile } from "@/lib/documents";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// In-app document viewer with the sign-off on the same screen (Dean,
// 2026-10-23): "Open to sign off" used to open the file in a new tab and
// nothing followed. The open is recorded once the document is on screen.
//
// Reach the end before signing (Dean, 2026-10-24; PIN or acknowledgement,
// one rule): the sign-off bar is pinned to the bottom from the moment the
// document opens, disabled until the reader reaches the end of it. A
// tappable button at open would be one-tap sign-off again. Reaching the end
// is reported to the server (which refuses sign-off without it) and stored
// as how they got there; the record says "reached the end", never "read".
// Every state that can't reach the end says what to do next.
//
// PDFs render with pdf.js (legacy build, for older iPhones): iOS shows only
// the first page of a PDF in an iframe and Android shows none. Images show as
// images. Anything else (Word, CAD...) can't be drawn in a browser, so the
// viewer offers the file, and opening it is the most that can be recorded.

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"];

export type ViewerDoc = { id: string; name: string; fileUrl: string | null; label?: string | null };
export type ReachedEndHow = "scrolled" | "one_screen" | "opened_outside_render_failed" | "opened_outside";
// A revision replaced while it was open: say what to do instead.
export const SUPERSEDED_IN_VIEWER = "This revision has been replaced by a newer one, so it can't be signed off. Close this and open the latest revision from your list. If it isn't there yet, ask your project manager to share it.";

type Props = {
  doc: ViewerDoc;
  // Records the open server-side; resolves true once it is recorded.
  recordOpen: () => Promise<boolean>;
  // Reports reaching the end (or opening the file outside SiteSort).
  recordEnd: (how: ReachedEndHow) => Promise<boolean>;
  // The sign-off flow for this surface; null when no sign-off is needed.
  signOff: ReturnType<typeof useSignOffFlow> | null;
  pinRequired: boolean;
  // Why this copy can't be signed (e.g. replaced by a newer revision).
  signBlocked?: string | null;
  onClose: () => void;
};

type Shown = "loading" | "shown" | "other" | "failed";
type Step = "idle" | "working" | "done" | "failed";

// The visible screen height. On iPhone Safari a full-screen fixed box can be
// taller than what's visible, leaving its bottom (the sign-off bar) behind
// the toolbar; sizing to the visual viewport keeps the bar on screen, and
// above the keyboard while the PIN is typed.
function useVisibleHeight(): string {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setH(vv.height);
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);
  return h ? `${h}px` : "100dvh";
}

export function DocumentViewer({ doc, recordOpen, recordEnd, signOff, pinRequired, signBlocked, onClose }: Props) {
  const href = doc.fileUrl ? fileHref(doc.fileUrl) : null;
  const ext = fileExt(doc.fileUrl);
  const kind: "pdf" | "image" | "other" = ext === "pdf" ? "pdf" : IMAGE_EXTS.includes(ext) ? "image" : "other";
  const cad = isCadFile(doc.fileUrl, doc.name);
  const [shown, setShown] = useState<Shown>(kind === "other" || !href ? "other" : "loading");
  const [opened, setOpened] = useState<Step>("idle");
  const [ended, setEnded] = useState<Step>("idle");
  const [atEnd, setAtEnd] = useState(false);
  const [lastPageDrawn, setLastPageDrawn] = useState(kind === "image");
  const openingRef = useRef<Promise<boolean> | null>(null);
  const howRef = useRef<ReachedEndHow>("scrolled");
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const height = useVisibleHeight();
  const verb = pinRequired ? "sign off" : "acknowledge";
  const Verb = pinRequired ? "Sign off" : "Acknowledge";
  const outside = shown === "other" || shown === "failed";

  // One open record at a time; a failed one can be tried again.
  const record = useCallback((): Promise<boolean> => {
    if (openingRef.current) return openingRef.current;
    setOpened("working");
    const p = recordOpen().catch(() => false).then(ok => {
      setOpened(ok ? "done" : "failed");
      if (!ok) openingRef.current = null;
      return ok;
    });
    openingRef.current = p;
    return p;
  }, [recordOpen]);

  const saveEnd = useCallback(async (how: ReachedEndHow) => {
    howRef.current = how;
    setEnded("working");
    let ok = false;
    try { ok = await recordEnd(how); } catch { ok = false; }
    setEnded(ok ? "done" : "failed");
  }, [recordEnd]);

  // Recorded once the document is on screen, never before.
  useEffect(() => {
    if (shown === "shown" && opened === "idle") void record();
  }, [shown, opened, record]);

  // The end: a marker after the last page (or the image) comes into view.
  // Latched; "fitted on one screen" when there was nothing to scroll.
  useEffect(() => {
    if (shown !== "shown" || atEnd) return;
    const root = scrollRef.current, marker = endRef.current;
    if (!root || !marker) return;
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      howRef.current = root.scrollHeight <= root.clientHeight + 4 ? "one_screen" : "scrolled";
      setAtEnd(true);
    }, { root, threshold: 0 });
    io.observe(marker);
    return () => io.disconnect();
  }, [shown, atEnd]);

  // Reported once the open is recorded and the last page has actually drawn.
  useEffect(() => {
    if (!signOff || outside || ended !== "idle") return;
    if (opened === "done" && atEnd && lastPageDrawn) void saveEnd(howRef.current);
  }, [signOff, outside, ended, opened, atEnd, lastPageDrawn, saveEnd]);

  // Lock the page behind, close on Escape (not while typing a PIN).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !signOff?.target) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose, signOff?.target]);

  // Close any half-entered PIN with the viewer.
  const close = () => { if (signOff?.target?.id === doc.id) signOff.close(); onClose(); };

  // Opening the file outside SiteSort. From the header (a drawn PDF or image)
  // it records the open only: the end still has to be reached here. From the
  // body (a file SiteSort can't draw) it is the most that can be recorded.
  const takeFile = async (countsAsEnd: boolean) => {
    if (!doc.fileUrl || !href) return;
    if (cad) downloadFile(doc.fileUrl, doc.name);
    else window.open(href, "_blank", "noopener");
    if (!(await record())) return;
    if (countsAsEnd && signOff && ended !== "done" && ended !== "working") {
      void saveEnd(shown === "failed" ? "opened_outside_render_failed" : "opened_outside");
    }
  };

  const signed = !!signOff && signOff.lastSigned?.id === doc.id;
  const entering = !!signOff && signOff.target?.id === doc.id;
  const waitLine = (text: string, spin = false) => (
    <p className="text-sm text-muted-foreground pb-1 flex items-center gap-2">{spin && <Spinner className="size-4" />}{text}</p>
  );
  const retry = (text: string, run: () => void) => (
    <div className="flex flex-col gap-2 pb-1">
      <p className="text-sm text-destructive">{text}</p>
      <button type="button" onClick={run} className="w-full min-h-12 rounded-xl border-2 border-border text-base font-bold hover:bg-muted">Try again</button>
    </div>
  );

  let bar: ReactNode = null;
  if (signOff) {
    if (signed) {
      bar = (
        <div className="flex flex-col gap-3" data-testid="document-viewer-signed">
          <div className="flex flex-col gap-1.5">
            <DocStatePill state={pinRequired ? "pin" : "acknowledged"} at={signOff.lastSigned!.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} className="text-sm self-start" />
            <p className="text-sm text-muted-foreground">
              {pinRequired ? "You signed this with your PIN." : "You acknowledged this. No PIN was asked for."} Your name and the time are recorded.
            </p>
          </div>
          <button type="button" onClick={close}
            className="w-full min-h-12 rounded-xl border-2 border-border text-base font-bold hover:bg-muted">Close</button>
        </div>
      );
    } else if (signBlocked) {
      bar = <p className="text-sm text-destructive pb-1">{signBlocked}</p>;
    } else if (entering) {
      bar = <SignOffPinCard flow={signOff} />;
    } else if (!href) {
      bar = <p className="text-sm text-muted-foreground pb-1" data-testid="document-viewer-no-file">This document has no file attached, so there is nothing to {verb} yet. Ask your project manager to attach it.</p>;
    } else if (opened === "failed") {
      bar = retry(`SiteSort couldn't record that you opened this, so you can't ${verb} yet. Check your signal, then tap Try again.`, () => { void record(); });
    } else if (ended === "failed") {
      bar = retry(`SiteSort couldn't save that you reached the end, so you can't ${verb} yet. Check your signal, then tap Try again.`, () => { void saveEnd(howRef.current); });
    } else if (ended === "done") {
      bar = (
        <div className="flex flex-col gap-2">
          {(howRef.current === "opened_outside" || howRef.current === "opened_outside_render_failed") && (
            <p className="text-sm text-muted-foreground">You opened the file outside SiteSort. {Verb} once you've read it.</p>
          )}
          <button type="button" data-testid="document-viewer-sign-off"
            onClick={() => signOff.open({ id: doc.id, name: doc.name, pinRequired })}
            className="w-full inline-flex items-center justify-center gap-2 min-h-14 rounded-xl bg-accent text-accent-foreground text-base font-bold hover:bg-accent/90 active:scale-[0.98] transition-all">
            <FileSignature className="w-5 h-5" /> {Verb}
          </button>
        </div>
      );
    } else if (ended === "working") {
      bar = waitLine("Saving that you reached the end...", true);
    } else if (outside) {
      bar = waitLine(`Open the file to read it. ${Verb} unlocks once you have.`);
    } else if (shown === "loading" || opened !== "done") {
      bar = waitLine("Opening the document...", true);
    } else if (!atEnd) {
      bar = (
        <button type="button" disabled aria-disabled="true" data-testid="document-viewer-scroll-to-end"
          className="w-full inline-flex items-center justify-center gap-2 min-h-14 rounded-xl border-2 border-dashed border-border bg-muted text-muted-foreground text-base font-bold cursor-not-allowed">
          Scroll to the end to {verb}
        </button>
      );
    } else if (!lastPageDrawn) {
      bar = waitLine("Loading the last page...", true);
    } else {
      bar = waitLine("Saving that you reached the end...", true);
    }
  }

  const outsideText = !href ? "This document has no file attached."
    : shown === "failed" ? (signOff ? `SiteSort couldn't show this file here. Open it in your phone's viewer instead, read it, then come back here to ${verb}.` : "SiteSort couldn't show this file here.")
    : cad ? (signOff ? `Drawings in this format can't be shown on a phone or in a browser. Download it to open it in your drawing software, then come back here to ${verb}.` : "Drawings in this format can't be shown on a phone or in a browser. Download it to open it in your drawing software.")
    : (signOff ? `This type of file can't be shown inside SiteSort. Open it in your phone's viewer, read it, then come back here to ${verb}.` : "This type of file can't be shown inside SiteSort.");

  return (
    <div role="dialog" aria-modal="true" aria-label={doc.name} data-testid="document-viewer"
      className="fixed inset-x-0 top-0 z-[70] flex flex-col bg-background"
      style={{ height, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-base truncate">{doc.name}</p>
          {doc.label && <p className="text-xs text-muted-foreground truncate">{doc.label}</p>}
        </div>
        {href && kind !== "other" && (
          <button type="button" onClick={() => void takeFile(false)} aria-label="Open the file in a new tab"
            className="inline-flex shrink-0 items-center justify-center rounded-lg min-h-11 min-w-11 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ExternalLink className="w-5 h-5" />
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close" data-testid="document-viewer-close"
          className="inline-flex shrink-0 items-center justify-center rounded-lg min-h-11 min-w-11 hover:bg-muted">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-muted/40" data-testid="document-viewer-scroll">
        {kind === "pdf" && href && shown !== "failed" && (
          <PdfPages url={href} onFirstPage={() => setShown("shown")} onLastPage={() => setLastPageDrawn(true)} onError={() => setShown("failed")} />
        )}
        {kind === "image" && href && shown !== "failed" && (
          <div className="p-3 flex justify-center">
            <img src={href} alt={doc.name} className="max-w-full h-auto bg-white shadow-sm"
              onLoad={() => setShown("shown")} onError={() => setShown("failed")} />
          </div>
        )}
        {shown === "shown" && <div ref={endRef} className="h-px" data-testid="document-viewer-end" aria-hidden="true" />}
        {shown === "loading" && (
          <div className="flex justify-center py-16"><Spinner className="size-7 text-primary" /></div>
        )}
        {outside && (
          <div className="mx-auto max-w-md p-6 text-center flex flex-col items-center gap-4">
            <p className="text-base">{outsideText}</p>
            {href && (
              <button type="button" onClick={() => void takeFile(true)} data-testid="document-viewer-take-file"
                className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 min-h-12 text-base font-bold hover:bg-primary/90">
                {cad ? <Download className="w-5 h-5" /> : <ExternalLink className="w-5 h-5" />}
                {cad ? "Download the file" : "Open the file"}
              </button>
            )}
          </div>
        )}
      </div>

      {signOff && (
        <div className="border-t border-border bg-card px-3 pt-3 max-h-[70%] overflow-y-auto"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
          data-testid="document-viewer-signoff">
          {bar}
        </div>
      )}
    </div>
  );
}

// Every page of a PDF, drawn lazily as the reader scrolls (a long RAMS on a
// phone must not hold dozens of full-size canvases: iOS caps canvas memory).
// Each page is drawn once to a canvas, turned into an image and the canvas
// released.
function PdfPages({ url, onFirstPage, onLastPage, onError }: { url: string; onFirstPage: () => void; onLastPage: () => void; onError: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ w: number; h: number }[] | null>(null);
  const [srcs, setSrcs] = useState<Record<number, string>>({});
  const pdfRef = useRef<any>(null);
  const drawing = useRef<Set<number>>(new Set());
  const firstDone = useRef(false);
  const cbs = useRef({ onFirstPage, onLastPage, onError });
  cbs.current = { onFirstPage, onLastPage, onError };

  useEffect(() => {
    let cancelled = false;
    let task: any = null;
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({ url });
        const pdf = await task.promise;
        if (cancelled) { void pdf.destroy(); return; }
        pdfRef.current = pdf;
        const sizes: { w: number; h: number }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (!cancelled) setPages(sizes);
      } catch {
        if (!cancelled) cbs.current.onError();
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy?.();
      void pdfRef.current?.destroy?.();
      pdfRef.current = null;
    };
  }, [url]);

  useEffect(() => () => { Object.values(srcs).forEach(s => URL.revokeObjectURL(s)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(async (n: number) => {
    const pdf = pdfRef.current;
    const wrap = wrapRef.current;
    if (!pdf || !wrap || drawing.current.has(n)) return;
    drawing.current.add(n);
    try {
      const page = await pdf.getPage(n);
      const cssWidth = Math.min(wrap.clientWidth - 24, 1200);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
      const blob: Blob | null = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
      canvas.width = 0; canvas.height = 0;
      if (!blob || !pdfRef.current) return;
      const src = URL.createObjectURL(blob);
      setSrcs(prev => ({ ...prev, [n]: src }));
      if (!firstDone.current) { firstDone.current = true; cbs.current.onFirstPage(); }
      if (n === pdf.numPages) cbs.current.onLastPage();
    } catch {
      drawing.current.delete(n);
      if (n === 1 && !firstDone.current) cbs.current.onError();
    }
  }, []);

  useEffect(() => {
    if (!pages || !wrapRef.current) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) void draw(Number((e.target as HTMLElement).dataset.page));
    }, { root: wrapRef.current.parentElement, rootMargin: "800px 0px" });
    wrapRef.current.querySelectorAll("[data-page]").forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [pages, draw]);

  return (
    <div ref={wrapRef} className="flex flex-col items-center gap-3 p-3" data-testid="document-viewer-pdf">
      {pages?.map((s, i) => (
        <div key={i} data-page={i + 1} className="w-full max-w-[1200px] bg-white shadow-sm" style={{ aspectRatio: `${s.w} / ${s.h}` }}>
          {srcs[i + 1] && <img src={srcs[i + 1]} alt={`Page ${i + 1} of ${pages.length}`} className="block w-full h-auto" />}
        </div>
      ))}
    </div>
  );
}
