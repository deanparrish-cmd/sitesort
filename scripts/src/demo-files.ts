/**
 * Generated PDFs for the demo company (seed-demo.ts): drawings with a title
 * block, multi-page RAMS and safety documents, and specimen certificates.
 *
 * Certificates are deliberately unusable as the real thing (Dean, 2026-10-27):
 * an invented insurer (Quorrendale Insurance Company Ltd, no Companies House
 * match on 2026-10-27), no real insurer, broker or scheme branding, and
 * "SPECIMEN - NOT A VALID CERTIFICATE" across the face of every page.
 */
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pw from "playwright-core";

export const INSURER = "Quorrendale Insurance Company Ltd";
const COMPANY = "Brookfield & Haigh Construction Ltd";
const JOB = "Ravensworth Mews, Old Mill Lane, Ossett";

export type DrawingKind = "location" | "layout" | "plan-gf" | "plan-ff" | "elevations" | "foundations" | "drainage" | "levels";
export type DrawingSpec = { number: string; title: string; rev: string; kind: DrawingKind; consultant: "SHA" | "KLC"; status: string };
export type TextDoc = { title: string; ref: string; rev: string; author: string; sections: { h: string; p?: string[]; table?: string[][] }[] };
export type CertSpec = { kind: "insurance"; holder: string; address: string; policy: string; from: string; to: string; limit: string; activity: string }
  | { kind: "card"; holder: string; cardTitle: string; number: string; to: string; level: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BASE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:"DejaVu Sans",Arial,sans-serif;color:#111}`;

// ---------- drawings ----------
function linework(kind: DrawingKind): string {
  const L: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, extra = "") => L.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#111" stroke-width="2" ${extra}/>`);
  const line = (x1: number, y1: number, x2: number, y2: number, extra = "") => L.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="1.5" ${extra}/>`);
  const text = (x: number, y: number, t: string, size = 14) => L.push(`<text x="${x}" y="${y}" font-size="${size}" font-family="DejaVu Sans">${esc(t)}</text>`);
  if (kind === "location") {
    L.push(`<path d="M40 420 C 300 380, 500 460, 980 400" fill="none" stroke="#111" stroke-width="10"/>`);
    L.push(`<path d="M520 60 C 540 200, 500 300, 560 560" fill="none" stroke="#111" stroke-width="7"/>`);
    for (let i = 0; i < 18; i++) rect(80 + (i % 6) * 70, 120 + Math.floor(i / 6) * 70, 50, 40);
    L.push(`<polygon points="640,160 860,150 880,330 650,340" fill="none" stroke="#c00" stroke-width="4" stroke-dasharray="14 8"/>`);
    text(670, 250, "SITE", 22); text(560, 395, "OLD MILL LANE", 13);
  } else if (kind === "layout" || kind === "levels") {
    L.push(`<path d="M60 300 L 940 300" stroke="#111" stroke-width="40" fill="none" opacity=".15"/>`);
    text(420, 306, "ESTATE ROAD", 13);
    for (let i = 0; i < 7; i++) { rect(80 + i * 122, 120, 100, 130); text(112 + i * 122, 190, `Plot ${i + 1}`, 13); }
    for (let i = 0; i < 7; i++) { rect(80 + i * 122, 360, 100, 130); text(112 + i * 122, 430, `Plot ${i + 8}`, 13); }
    if (kind === "levels") for (let i = 0; i < 14; i++) text(90 + (i % 7) * 122, i < 7 ? 270 : 350, `FFL ${(84.25 + i * 0.15).toFixed(2)}`, 11);
  } else if (kind === "plan-gf" || kind === "plan-ff") {
    rect(200, 80, 600, 440);
    line(500, 80, 500, 520); line(200, 300, 800, 300); line(650, 300, 650, 520);
    const rooms = kind === "plan-gf" ? ["Lounge", "Kitchen / Dining", "Hall", "WC", "Utility"] : ["Bedroom 1", "Bedroom 2", "Landing", "Bathroom", "Bedroom 3"];
    text(300, 200, rooms[0]); text(590, 200, rooms[1]); text(300, 420, rooms[2]); text(540, 420, rooms[3]); text(690, 420, rooms[4]);
    for (const x of [260, 380, 600, 720]) line(x, 80, x + 60, 80, `stroke-width="6" stroke="#fff"`);
    text(200, 60, "8650", 12); line(200, 66, 800, 66, `stroke-width="1"`);
  } else if (kind === "elevations") {
    for (const [ox, label] of [[80, "Front elevation"], [540, "Rear elevation"]] as const) {
      rect(ox, 220, 380, 280); L.push(`<polygon points="${ox - 20},220 ${ox + 190},90 ${ox + 400},220" fill="none" stroke="#111" stroke-width="2"/>`);
      rect(ox + 40, 260, 80, 70); rect(ox + 260, 260, 80, 70); rect(ox + 40, 390, 80, 70); rect(ox + 160, 380, 60, 120); rect(ox + 260, 390, 80, 70);
      text(ox + 120, 540, label);
    }
  } else if (kind === "foundations") {
    for (let i = 0; i < 7; i++) { rect(70 + i * 128, 160, 100, 200, `stroke-width="10" stroke-opacity=".35"`); rect(70 + i * 128, 160, 100, 200); text(98 + i * 128, 270, `Plot ${i + 1}`, 12); }
    text(70, 420, "Trench fill foundations 600 wide x 1000 min deep to engineer's details. Founding depth to be agreed on site.", 13);
  } else {
    line(80, 460, 920, 460, `stroke-width="3"`);
    for (let i = 0; i < 7; i++) {
      const x = 130 + i * 120; L.push(`<circle cx="${x}" cy="460" r="14" fill="#fff" stroke="#111" stroke-width="2"/>`);
      text(x - 14, 495, `MH${i + 1}`, 11); line(x, 446, x, 220, `stroke-dasharray="8 5"`); rect(x - 40, 160, 80, 60); text(x - 22, 195, `P${i + 1}`, 12);
    }
    text(90, 440, "150 dia uPVC foul at 1:80 min", 12); text(600, 440, "225 dia surface water to attenuation", 12);
  }
  return L.join("");
}

function drawingHtml(d: DrawingSpec): string {
  const cons = d.consultant === "SHA" ? "Studio Hartley Architects" : "Kirkby Lister Consulting";
  const prefix = d.rev[0];
  const n = Number(d.rev.slice(1));
  const revRows = Array.from({ length: n }, (_, i) => `<tr><td>${prefix}${String(i + 1).padStart(2, "0")}</td><td>${i === 0 ? (prefix === "P" ? "Preliminary issue" : "Construction issue") : "Revised following comments"}</td></tr>`).reverse().join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  @page{size:A3 landscape;margin:0}.sheet{width:420mm;height:297mm;padding:10mm;position:relative}
  .frame{border:2px solid #111;height:100%;display:grid;grid-template-columns:1fr 95mm}
  .draw{border-right:2px solid #111;padding:8mm;position:relative}
  .tb{display:flex;flex-direction:column;font-size:10pt}
  .tb>div{border-bottom:1px solid #111;padding:3mm}
  .big{font-size:15pt;font-weight:700}.lab{font-size:7pt;text-transform:uppercase;color:#444}
  table{width:100%;border-collapse:collapse;font-size:8.5pt}td{border-top:1px solid #999;padding:1mm}
  .north{position:absolute;right:14mm;top:12mm;font-weight:700}
  </style></head><body><div class="sheet"><div class="frame">
  <div class="draw"><div class="north">N &#8593;</div><svg viewBox="0 0 1000 600" width="100%" height="88%">${linework(d.kind)}</svg>
  <div style="font-size:8.5pt">Do not scale. All dimensions in millimetres unless stated. Report any discrepancy to the architect before work proceeds.</div></div>
  <div class="tb">
    <div><span class="lab">Revisions</span><table>${revRows}</table></div>
    <div style="flex:1"></div>
    <div><span class="lab">Client</span><br>${esc(COMPANY)}</div>
    <div><span class="lab">Project</span><br>${esc(JOB)}<br>Job 2417</div>
    <div><span class="lab">Title</span><br><span class="big">${esc(d.title)}</span></div>
    <div><span class="lab">Status</span><br>${esc(d.status)}</div>
    <div><span class="lab">Drawing number</span><br><b>${esc(d.number)}</b></div>
    <div style="display:flex;justify-content:space-between"><span><span class="lab">Scale</span><br>1:${d.kind === "location" ? "1250" : d.kind.startsWith("plan") || d.kind === "elevations" ? "50" : "200"} @ A3</span><span><span class="lab">Revision</span><br><span class="big">${esc(d.rev)}</span></span></div>
    <div class="big" style="border-bottom:0">${esc(cons)}</div>
  </div></div></div></body></html>`;
}

// ---------- text documents (RAMS, safety, general) ----------
function textDocHtml(t: TextDoc): string {
  const body = t.sections.map(s => `<h2>${esc(s.h)}</h2>${(s.p ?? []).map(p => `<p>${esc(p)}</p>`).join("")}${s.table ? `<table>${s.table.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : ""}`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  @page{size:A4;margin:18mm 16mm 20mm}body{font-size:10.5pt;line-height:1.5}
  header{border-bottom:3px solid #c2620a;padding-bottom:4mm;margin-bottom:6mm;display:flex;justify-content:space-between;align-items:flex-end;gap:8mm}
  h1{font-size:19pt;margin:0}h2{font-size:12.5pt;margin:7mm 0 2mm;color:#7a3e05;break-after:avoid}
  .meta{font-size:9pt;text-align:right;white-space:nowrap}
  table{width:100%;border-collapse:collapse;margin:2mm 0;font-size:9.5pt}th,td{border:1px solid #888;padding:1.6mm;text-align:left;vertical-align:top}th{background:#f1e6da}
  tr{break-inside:avoid}
  </style></head><body><header><div><div style="font-size:9pt;color:#555">${esc(COMPANY)} · ${esc(JOB)}</div><h1>${esc(t.title)}</h1></div>
  <div class="meta">Ref ${esc(t.ref)}<br>Revision ${esc(t.rev)}<br>${esc(t.author)}</div></header>${body}</body></html>`;
}

// ---------- specimen certificates ----------
function certHtml(c: CertSpec): string {
  const stamp = `<div class="stamp">SPECIMEN - NOT A VALID CERTIFICATE</div>`;
  const inner = c.kind === "insurance" ? `
    <div class="head"><div><div class="ins">${esc(INSURER)}</div><div class="sub">Certificate of Insurance: Public and Products Liability</div></div></div>
    <table>
      <tr><th>Policyholder</th><td>${esc(c.holder)}<br>${esc(c.address)}</td></tr>
      <tr><th>Policy number</th><td>${esc(c.policy)}</td></tr>
      <tr><th>Period of insurance</th><td>${esc(c.from)} to ${esc(c.to)} (both days inclusive)</td></tr>
      <tr><th>Limit of indemnity</th><td>${esc(c.limit)} any one occurrence</td></tr>
      <tr><th>Business description</th><td>${esc(c.activity)}</td></tr>
    </table>
    <p>This document is a specimen produced for a software demonstration. It is not evidence of insurance, has no policy behind it, and must not be relied on by anyone.</p>`
    : `
    <div class="head"><div><div class="ins">${esc(c.cardTitle)}</div><div class="sub">Demonstration card record</div></div></div>
    <table>
      <tr><th>Card holder</th><td>${esc(c.holder)}</td></tr>
      <tr><th>Card number</th><td>${esc(c.number)}</td></tr>
      <tr><th>Level</th><td>${esc(c.level)}</td></tr>
      <tr><th>Expires</th><td>${esc(c.to)}</td></tr>
    </table>
    <p>This document is a specimen produced for a software demonstration. It is not a qualification record and must not be relied on by anyone.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  @page{size:A4;margin:0}.page{width:210mm;height:297mm;padding:22mm 18mm;position:relative;overflow:hidden}
  .banner{background:#b3261e;color:#fff;font-weight:700;font-size:15pt;text-align:center;padding:3mm;letter-spacing:.06em;margin-bottom:10mm}
  .head{border-bottom:2px solid #333;padding-bottom:4mm;margin-bottom:8mm}.ins{font-size:20pt;font-weight:700}.sub{font-size:12pt;color:#444;margin-top:1mm}
  table{width:100%;border-collapse:collapse;font-size:11pt;margin-bottom:8mm}th,td{border:1px solid #999;padding:3mm;text-align:left;vertical-align:top}th{width:38%;background:#eee}
  p{font-size:10pt;color:#333}
  .stamp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-32deg);white-space:nowrap;font-size:25pt;font-weight:800;color:rgba(179,38,30,.6);border:5px solid rgba(179,38,30,.6);padding:4mm 8mm;letter-spacing:.04em}
  </style></head><body><div class="page"><div class="banner">SPECIMEN - NOT A VALID CERTIFICATE</div>${inner}${stamp}
  <div class="banner" style="position:absolute;left:18mm;right:18mm;bottom:18mm;margin:0">SPECIMEN - NOT A VALID CERTIFICATE</div></div></body></html>`;
}

// ---------- render ----------
let browser: pw.Browser | null = null;
async function render(html: string, out: string, landscapeA3 = false): Promise<void> {
  if (!browser) {
    const exec = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    if (!exec) throw new Error("REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set: no Chromium to draw the PDFs with.");
    browser = await pw.chromium.launch({ executablePath: exec, args: ["--no-sandbox"] });
  }
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, ...(landscapeA3 ? {} : {}) });
  await page.close();
}
export async function closeRenderer() { if (browser) { await browser.close(); browser = null; } }

export class DemoFiles {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true }); }
  private async make(name: string, html: () => string): Promise<{ path: string; name: string; bytes: Buffer }> {
    const p = join(this.dir, name);
    if (!existsSync(p)) await render(html(), p);
    return { path: p, name, bytes: readFileSync(p) };
  }
  drawing(d: DrawingSpec) { return this.make(`${d.number}_${d.rev}.pdf`, () => drawingHtml(d)); }
  text(t: TextDoc, file: string) { return this.make(file, () => textDocHtml(t)); }
  cert(c: CertSpec, file: string) { return this.make(file, () => certHtml(c)); }
}
