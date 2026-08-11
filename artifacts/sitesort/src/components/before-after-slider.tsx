import { useEffect, useRef, useState } from "react";

/**
 * Before/After comparison slider for the hero. Sweeps once when it scrolls
 * into view, then the visitor can drag (or touch) the handle to compare.
 * Shared by the landing page and the sales/info page so both stay in sync.
 */
export function BeforeAfterSlider() {
  const [pos, setPos] = useState(50); // % of the width where the divider sits
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  const stopAuto = () => {
    stoppedRef.current = true;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  // Gentle continuous back-and-forth sweep while on screen; the visitor taking
  // over (drag or keyboard) stops it so the handle stays where they put it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let start: number | null = null;
    const tick = (now: number) => {
      if (stoppedRef.current) return;
      if (start === null) start = now;
      const t = (now - start) / 1000;
      // Smooth sine sweep between ~14% and ~86%, one full pass every 8 seconds.
      setPos(50 + 36 * Math.sin((t * Math.PI * 2) / 8));
      rafRef.current = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (stoppedRef.current) return;
      if (entry.isIntersecting && rafRef.current === null) {
        start = null;
        rafRef.current = requestAnimationFrame(tick);
      } else if (!entry.isIntersecting && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => { io.disconnect(); if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  const updateFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(96, Math.max(4, pct)));
  };

  return (
    <div
      ref={containerRef}
      className="relative mx-auto w-full max-w-xl sm:max-w-2xl rounded-2xl shadow-2xl border border-border/50 overflow-hidden select-none touch-none cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      style={{ aspectRatio: "616 / 625" }}
      onPointerDown={e => { setDragging(true); stopAuto(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); updateFromClientX(e.clientX); }}
      onPointerMove={e => { if (dragging) updateFromClientX(e.clientX); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      role="slider"
      aria-label="Compare before and after SiteSort"
      aria-valuemin={4}
      aria-valuemax={96}
      aria-valuenow={Math.round(pos)}
      tabIndex={0}
      onKeyDown={e => {
        const step = (delta: number) => { stopAuto(); setPos(p => Math.min(96, Math.max(4, p + delta))); };
        if (e.key === "ArrowLeft") { e.preventDefault(); step(-5); }
        else if (e.key === "ArrowRight") { e.preventDefault(); step(5); }
        else if (e.key === "Home") { e.preventDefault(); stopAuto(); setPos(4); }
        else if (e.key === "End") { e.preventDefault(); stopAuto(); setPos(96); }
      }}
    >
      <img
        src={`${import.meta.env.BASE_URL}images/before-sitesort.webp`}
        alt="Before SiteSort: a site manager buried in paperwork"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
        decoding="async"
      />
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/after-sitesort.webp`}
          alt="After SiteSort: the same manager relaxed, everything on one laptop"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
          decoding="async"
        />
      </div>
      {/* Divider + handle */}
      <div
        className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.35)]"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white shadow-lg border border-border flex items-center justify-center gap-0.5 text-muted-foreground">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6-6 6 6 6" /><path d="m15 6 6 6-6 6" /></svg>
        </div>
      </div>
      {/* Labels */}
      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-[11px] font-bold uppercase tracking-wider backdrop-blur-sm">Before</span>
      <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-accent text-accent-foreground text-[11px] font-bold uppercase tracking-wider">After</span>
    </div>
  );
}
