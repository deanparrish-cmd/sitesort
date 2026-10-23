import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, FileSignature, ShieldCheck, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SignOffPinCard } from "@/components/sign-off-pin-card";
import type { useSignOffFlow } from "@/hooks/use-sign-off-flow";
import { fileExt, fileHref, isCadFile, downloadFile } from "@/lib/documents";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// In-app document viewer with the sign-off on the same screen (Dean,
// 2026-10-23): "Open to sign off" used to open the file in a new tab and
// nothing followed, so the signature step meant closing it and finding the
// row again. Here the open is recorded once the document is actually on
// screen, then Sign off appears at the bottom, the PIN is asked for there and
// the confirmation shows there, without closing the document.
//
// PDFs render with pdf.js (legacy build, for older iPhones): iOS shows only
// the first page of a PDF in an iframe and Android shows none. Images show as
// images. Anything else (Word, CAD...) can't be drawn in a browser, so the
// viewer offers the file and records the open when they take it.

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"];

export type ViewerDoc = { id: string; name: string; fileUrl: string | null; label?: string | null };

type Props = {
  doc: ViewerDoc;
  // Records the open server-side; resolves true once it is recorded.
  recordOpen: () => Promise<boolean>;
  // The sign-off flow for this surface; null when no sign-off is needed.
  signOff: ReturnType<typeof useSignOffFlow> | null;
  pinRequired: boolean;
  // Why this copy can't be signed (e.g. replaced by a newer revision).
  signBlocked?: string | null;
  onClose: () => void;
};

type Shown = "loading" | "shown" | "other" | "failed";
type Recorded = "idle" | "recording" | "recorded" | "failed";

export function DocumentViewer({ doc, recordOpen, signOff, pinRequired, signBlocked, onClose }: Props) {
  const href = doc.fileUrl ? fileHref(doc.fileUrl) : null;
  const ext = fileExt(doc.fileUrl);
  const kind: "pdf" | "image" | "other" = ext === "pdf" ? "pdf" : IMAGE_EXTS.includes(ext) ? "image" : "other";
  const cad = isCadFile(doc.fileUrl, doc.name);
  const [shown, setShown] = useState<Shown>(kind === "other" || !href ? "other" : "loading");
  const [recorded, setRecorded] = useState<Recorded>("idle");
  const recordingRef = useRef(false);

  const record = useCallback(async () => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setRecorded("recording");
    let ok = false;
    try { ok = await recordOpen(); } catch { ok = false; }
    setRecorded(ok ? "recorded" : "failed");
    recordingRef.current = false;
  }, [recordOpen]);

  // Recorded once the document is on screen, never before.
  useEffect(() => {
    if (shown === "shown" && recorded === "idle") void record();
  }, [shown, recorded, record]);

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

  const takeFile = () => {
    if (!doc.fileUrl || !href) return;
    if (cad) downloadFile(doc.fileUrl, doc.name);
    else window.open(href, "_blank", "noopener");
    if (recorded !== "recorded") void record();
  };

  const signed = !!signOff && signOff.lastSigned?.id === doc.id;
  const entering = !!signOff && signOff.target?.id === doc.id;

  return (
    <div role="dialog" aria-modal="true" aria-label={doc.name} data-testid="document-viewer"
      className="fixed inset-0 z-[70] flex flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-base truncate">{doc.name}</p>
          {doc.label && <p className="text-xs text-muted-foreground truncate">{doc.label}</p>}
        </div>
        {href && kind !== "other" && (
          <button type="button" onClick={takeFile} aria-label="Open the file in a new tab"
            className="inline-flex shrink-0 items-center justify-center rounded-lg min-h-11 min-w-11 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ExternalLink className="w-5 h-5" />
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close" data-testid="document-viewer-close"
          className="inline-flex shrink-0 items-center justify-center rounded-lg min-h-11 min-w-11 hover:bg-muted">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-muted/40">
        {kind === "pdf" && href && shown !== "failed" && (
          <PdfPages url={href} onFirstPage={() => setShown("shown")} onError={() => setShown("failed")} />
        )}
        {kind === "image" && href && shown !== "failed" && (
          <div className="p-3 flex justify-center">
            <img src={href} alt={doc.name} className="max-w-full h-auto bg-white shadow-sm"
              onLoad={() => setShown("shown")} onError={() => setShown("failed")} />
          </div>
        )}
        {shown === "loading" && (
          <div className="flex justify-center py-16"><Spinner className="size-7 text-primary" /></div>
        )}
        {(shown === "other" || shown === "failed") && (
          <div className="mx-auto max-w-md p-6 text-center flex flex-col items-center gap-4">
            <p className="text-base">
              {!href ? "This document has no file attached."
                : shown === "failed" ? "SiteSort couldn't show this file here."
                : cad ? "Drawings in this format can't be shown on a phone or in a browser. Download it to open it in your drawing software."
                : "This type of file can't be shown inside SiteSort."}
            </p>
            {href && (
              <button type="button" onClick={takeFile} data-testid="document-viewer-take-file"
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
          {signed ? (
            <div className="flex flex-col gap-3" data-testid="document-viewer-signed">
              <p className={`flex items-start gap-2 font-bold text-base ${pinRequired ? "text-success" : "text-foreground"}`}>
                {pinRequired ? <ShieldCheck className="w-6 h-6 shrink-0" /> : <CheckCircle2 className="w-6 h-6 shrink-0 text-muted-foreground" />}
                <span>{pinRequired ? "Signed with your PIN" : "Acknowledged, without a PIN,"} at {signOff.lastSigned!.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Your name and the time are recorded.</span>
              </p>
              <button type="button" onClick={close}
                className="w-full min-h-12 rounded-xl border-2 border-border text-base font-bold hover:bg-muted">Close</button>
            </div>
          ) : signBlocked ? (
            <p className="text-sm text-destructive pb-1">{signBlocked}</p>
          ) : entering ? (
            <SignOffPinCard flow={signOff} />
          ) : recorded === "recorded" ? (
            <button type="button" data-testid="document-viewer-sign-off"
              onClick={() => signOff.open({ id: doc.id, name: doc.name, pinRequired })}
              className="w-full inline-flex items-center justify-center gap-2 min-h-14 rounded-xl bg-accent text-accent-foreground text-base font-bold hover:bg-accent/90 active:scale-[0.98] transition-all">
              <FileSignature className="w-5 h-5" /> {pinRequired ? "Sign off" : "Acknowledge"}
            </button>
          ) : recorded === "failed" ? (
            <div className="flex flex-col gap-2 pb-1">
              <p className="text-sm text-destructive">SiteSort couldn't record that you opened this, so it can't be signed off yet. Check your signal.</p>
              <button type="button" onClick={() => void record()}
                className="w-full min-h-12 rounded-xl border-2 border-border text-base font-bold hover:bg-muted">Try again</button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground pb-1 flex items-center gap-2">
              {recorded === "recording" && <Spinner className="size-4" />}
              {recorded === "recording" ? "Recording that you opened it..."
                : shown === "other" ? (cad ? "Download the file to read it. Sign off appears here once you have." : "Open the file to read it. Sign off appears here once you have.")
                : "Sign off appears here once the document has opened."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Every page of a PDF, drawn lazily as the reader scrolls (a long RAMS on a
// phone must not hold dozens of full-size canvases: iOS caps canvas memory).
// Each page is drawn once to a canvas, turned into an image and the canvas
// released.
function PdfPages({ url, onFirstPage, onError }: { url: string; onFirstPage: () => void; onError: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ w: number; h: number }[] | null>(null);
  const [srcs, setSrcs] = useState<Record<number, string>>({});
  const pdfRef = useRef<any>(null);
  const drawing = useRef<Set<number>>(new Set());
  const firstDone = useRef(false);
  const cbs = useRef({ onFirstPage, onError });
  cbs.current = { onFirstPage, onError };

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
