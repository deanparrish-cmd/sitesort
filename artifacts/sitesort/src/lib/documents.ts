// Helpers for opening documents. Browser-renderable files (PDF, images) preview
// in a new tab; CAD files (DWG/DXF/DWF/RVT/IFC) can't render in a browser, so they
// download instead of leaving a blank tab. Everything else about a document
// (versioning, revisions, superseded status, distribution, portal visibility) is
// format-agnostic — this only affects the open/download action and a format badge.

const CAD_EXTS = ["dwg", "dxf", "dwf", "rvt", "ifc"];

// Legacy /uploads/ links must be rewritten to /api/uploads/ (Replit only routes /api/*).
export function fileHref(fileUrl: string): string {
  return fileUrl.replace(/^\/uploads\//, "/api/uploads/");
}

export function fileExt(nameOrUrl?: string | null): string {
  if (!nameOrUrl) return "";
  const clean = nameOrUrl.split("?")[0].split("#")[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

// Detect CAD strictly from the stored file URL — uploads always preserve the real
// extension there (uuid + ext), so we must NOT fall back to the display name (a PDF
// a user happened to title "GA Plan.dwg" is not CAD). The unused `name` param is
// kept so call sites can pass (fileUrl, name) uniformly.

/** True if the stored file is a CAD format the browser can't preview. */
export function isCadFile(fileUrl?: string | null, _name?: string | null): boolean {
  return CAD_EXTS.includes(fileExt(fileUrl));
}

/** Uppercase format label (e.g. "DWG") for a CAD file, else null — used for the row badge. */
export function cadBadgeLabel(fileUrl?: string | null, _name?: string | null): string | null {
  const e = fileExt(fileUrl);
  return CAD_EXTS.includes(e) ? e.toUpperCase() : null;
}

/** Force-download a file with a sensible filename (adds the extension if the
 *  display name lacks it). The download attribute only works same-origin, so a
 *  cross-origin file is opened in a new tab instead of navigating the app away. */
export function downloadFile(fileUrl: string, name?: string | null): void {
  const href = fileHref(fileUrl);
  const sameOrigin = href.startsWith("/") || (typeof window !== "undefined" && href.startsWith(window.location.origin));
  if (!sameOrigin) { window.open(href, "_blank", "noopener,noreferrer"); return; }
  const ext = fileExt(href);
  let dl = (name && name.trim()) || "document";
  if (ext && !dl.toLowerCase().endsWith("." + ext)) dl += "." + ext;
  const a = document.createElement("a");
  a.href = href;
  a.download = dl;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Open a document: preview PDFs/images in a new tab; download CAD files. */
export function openDocument(fileUrl: string, name?: string | null): void {
  if (isCadFile(fileUrl, name)) downloadFile(fileUrl, name);
  else window.open(fileHref(fileUrl), "_blank", "noopener,noreferrer");
}
