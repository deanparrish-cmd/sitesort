/**
 * Seed the Checkatrade demo company (Brookfield & Haigh Construction Ltd)
 * through the SiteSort API, signed in as its admin. Nothing is backdated:
 * every row carries the moment it was really created (Dean, 2026-10-27).
 *
 *   DEMO_EMAIL=... DEMO_PASSWORD=... DEMO_INBOX_DARREN=... DEMO_INBOX_GARY=... DEMO_INBOX_LEE=... \
 *     pnpm --filter @workspace/scripts exec tsx ./src/seed-demo.ts <base-url> [--next-revision]
 *
 * <base-url> is http://localhost:8080 or https://www.sitesort.co.uk.
 * Safe to run again: everything is looked up by name first, so a re-run
 * after a failure carries on and creates nothing twice. A re-run after Gary
 * has accepted his invite makes him the site manager.
 * --next-revision uploads the next later drawing revision (one per run), so
 * the revision history carries real dates spread over the days before the demo.
 *
 * Refuses unless the signed-in company is exactly the demo company with
 * beta access on, and unless every email in its data is on the never-send
 * list (lib/email.ts, #182) or one of the four inboxes given.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DemoFiles, closeRenderer, type DrawingSpec, type TextDoc } from "./demo-files";

const COMPANY = "Brookfield & Haigh Construction Ltd";
const NEVER_SEND = ["brookfieldhaigh.co.uk", "ryecroftmoorgroundworks.co.uk", "airedalescaffolding.co.uk", "thrumbletonbrick.co.uk",
  "scammondenelectrical.co.uk", "blackmoorfootplumbing.co.uk", "wessendenroofing.co.uk", "studiohartley.co.uk", "kirkbylister.co.uk"];

const args = process.argv.slice(2);
const base = (args.find(a => !a.startsWith("--")) ?? "").replace(/\/+$/, "");
const nextRevision = args.includes("--next-revision");
if (!/^(http:\/\/localhost:\d+|https:\/\/www\.sitesort\.co\.uk)$/.test(base)) {
  console.error("Usage: seed-demo.ts <http://localhost:PORT | https://www.sitesort.co.uk> [--next-revision]");
  process.exit(2);
}
const need = (n: string) => { const v = process.env[n]?.trim(); if (!v) { console.error(`Missing ${n}`); process.exit(2); } return v; };
const ADMIN_EMAIL = need("DEMO_EMAIL").toLowerCase();
const PASSWORD = need("DEMO_PASSWORD");
const INBOX = { darren: need("DEMO_INBOX_DARREN").toLowerCase(), gary: need("DEMO_INBOX_GARY").toLowerCase(), lee: need("DEMO_INBOX_LEE").toLowerCase() };

// ---------------------------------------------------------------- data
// Only Darren, Gary and Lee are invited: they have real inboxes. An invite to a
// never-send address is dropped by send() but still recorded as sent, which
// would be an untrue record, so everyone else stays a card with no invite.
type Person = { key: string; first: string; last: string; email: string; phone: string; role?: string; invite?: boolean };
type Firm = { name: string; type: "subcontractor"; trades: string[]; address: string; people: Person[];
  pli?: { to: string; from: string; policy: string; activity: string } };

const firms: Firm[] = [
  { name: "Ryecroft Moor Groundworks Ltd", type: "subcontractor", trades: ["Groundworkers"], address: "Ryecroft Moor Yard, Dewsbury",
    pli: { from: "1 Apr 2026", to: "2027-03-31", policy: "QIC/PL/0381142", activity: "Groundworks, drainage and civil engineering contractors" },
    people: [
      { key: "darren", first: "Darren", last: "Firth", email: INBOX.darren, phone: "07700 900141", role: "Foreman", invite: true },
      { key: "kyle", first: "Kyle", last: "Marsden", email: "kyle.marsden@ryecroftmoorgroundworks.co.uk", phone: "07700 900142", role: "Groundworker" },
    ] },
  { name: "Airedale Scaffolding Ltd", type: "subcontractor", trades: ["Scaffolders"], address: "Canal Side, Shipley",
    pli: { from: "1 Jul 2026", to: "2027-06-30", policy: "QIC/PL/0392207", activity: "Scaffolding contractors" },
    people: [{ key: "wayne", first: "Wayne", last: "Holroyd", email: "wayne.holroyd@airedalescaffolding.co.uk", phone: "07700 900215", role: "Scaffold supervisor" }] },
  { name: "Thrumbleton Brick & Block Ltd", type: "subcontractor", trades: ["Builders"], address: "Mill Yard, Thrumbleton",
    pli: { from: "20 Oct 2025", to: "2026-10-19", policy: "QIC/PL/0417736", activity: "Bricklaying and blockwork contractors" },
    people: [
      { key: "lee", first: "Lee", last: "Ackroyd", email: INBOX.lee, phone: "07700 900318", role: "Bricklayer", invite: true },
      { key: "josh", first: "Josh", last: "Barraclough", email: "josh.barraclough@thrumbletonbrick.co.uk", phone: "07700 900319", role: "Bricklayer" },
    ] },
  { name: "Scammonden Electrical Ltd", type: "subcontractor", trades: ["Electricians"], address: "Scammonden Road, Ripponden",
    pli: { from: "9 Dec 2025", to: "2026-12-08", policy: "QIC/PL/0425519", activity: "Electrical installation contractors" },
    people: [{ key: "martin", first: "Martin", last: "Shaw", email: "martin.shaw@scammondenelectrical.co.uk", phone: "07700 900422", role: "Electrician" }] },
  { name: "Blackmoorfoot Plumbing & Heating Ltd", type: "subcontractor", trades: ["Plumbers", "Heating Engineers"], address: "Station Road, Linthwaite",
    pli: { from: "1 Feb 2026", to: "2027-01-31", policy: "QIC/PL/0398820", activity: "Plumbing and heating contractors" },
    people: [{ key: "steve", first: "Steve", last: "Lumb", email: "steve.lumb@blackmoorfootplumbing.co.uk", phone: "07700 900536", role: "Plumber" }] },
  // Sole trader: covered by his own typed public liability certificate, not a firm record.
  { name: "Wessenden Roofing", type: "subcontractor", trades: ["Roofers"], address: "Wessenden Head Road, Meltham",
    people: [{ key: "james", first: "James", last: "Sutcliffe", email: "james@wessendenroofing.co.uk", phone: "07700 900647", role: "Roofer (sole trader)" }] },
];
const gary: Person = { key: "gary", first: "Gary", last: "Booth", email: INBOX.gary, phone: "07700 900709", role: "Site manager", invite: true };
const sarah = { name: "Sarah Whitworth", email: "sarah.whitworth@brookfieldhaigh.co.uk", role: "project_manager", roleTitle: "Project manager" };

const personCerts = [
  { person: "james", name: "Public liability insurance", certType: "public_liability", expiryDate: "2027-05-31",
    file: { kind: "insurance" as const, holder: "James Sutcliffe t/a Wessenden Roofing", address: "Wessenden Head Road, Meltham", policy: "QIC/PL/0402263", from: "1 Jun 2026", to: "31 May 2027", limit: "£2,000,000", activity: "Roofing contractor" } },
  { person: "wayne", name: "Advanced scaffolder card", certType: "qualification", expiryDate: "2026-11-20",
    file: { kind: "card" as const, holder: "Wayne Holroyd", cardTitle: "Advanced scaffolder card", number: "DEMO-SC-55120", to: "20 Nov 2026", level: "Advanced scaffolder" } },
];

const PROJECT = { name: "Ravensworth Mews", address: "Old Mill Lane, Ossett, WF5", startDate: "2026-09-14", targetEndDate: "2027-08-27" };
const PROJECT2 = { name: "Unit 3 Lowfield Business Park", address: "Lowfield Business Park, Wakefield, WF2", startDate: "2026-11-30", targetEndDate: "2027-02-26" };

// First upload: the revision current when the company starts using SiteSort.
// `next`: later revisions, uploaded one per --next-revision run.
type Dwg = Omit<DrawingSpec, "rev"> & { rev: string; next: string[]; share: ({ type: "all" } | { type: "trade"; trade: string })[] };
const ALL = { type: "all" as const };
const trade = (t: string) => ({ type: "trade" as const, trade: t });
const drawings: Dwg[] = [
  { number: "2417-SHA-XX-ZZ-DR-A-0100", title: "Site Location Plan", rev: "C01", next: [], kind: "location", consultant: "SHA", status: "Construction", share: [ALL] },
  { number: "2417-SHA-XX-ZZ-DR-A-1001", title: "Proposed Site Layout", rev: "C02", next: ["C03"], kind: "layout", consultant: "SHA", status: "Construction", share: [ALL] },
  { number: "2417-SHA-HTA-00-DR-A-2001", title: "House Type A, The Ashworth, Ground Floor Plan", rev: "C01", next: ["C02"], kind: "plan-gf", consultant: "SHA", status: "Construction", share: [trade("Builders"), trade("Electricians"), trade("Plumbers")] },
  { number: "2417-SHA-HTA-01-DR-A-2002", title: "House Type A, First Floor Plan", rev: "C01", next: ["C02"], kind: "plan-ff", consultant: "SHA", status: "Construction", share: [trade("Builders"), trade("Electricians"), trade("Plumbers")] },
  { number: "2417-SHA-HTA-ZZ-DR-A-3001", title: "House Type A, Elevations", rev: "C01", next: [], kind: "elevations", consultant: "SHA", status: "Construction", share: [trade("Builders"), trade("Roofers"), trade("Scaffolders")] },
  { number: "2417-KLC-XX-ZZ-DR-S-0200", title: "Foundation Layout, Plots 1 to 7", rev: "C01", next: ["C02"], kind: "foundations", consultant: "KLC", status: "Construction", share: [trade("Groundworkers"), trade("Builders")] },
  { number: "2417-KLC-XX-ZZ-DR-C-0500", title: "Drainage Layout", rev: "C03", next: ["C04"], kind: "drainage", consultant: "KLC", status: "Construction", share: [trade("Groundworkers"), trade("Plumbers")] },
  { number: "2417-KLC-XX-ZZ-DR-C-0600", title: "External Works and Levels", rev: "P03", next: ["P04"], kind: "levels", consultant: "KLC", status: "Preliminary, not for construction", share: [trade("Groundworkers")] },
];
const dwgName = (d: { number: string; title: string }) => `${d.number} ${d.title}`;

type Doc = { name: string; type: "method_statement" | "safety" | "general"; file: string; pin: boolean; ack: boolean; share: Dwg["share"]; doc: TextDoc };
const docs: Doc[] = [
  { name: "RAMS: Excavation and Drainage, Ryecroft Moor Groundworks", type: "method_statement", file: "rams-excavation-drainage.pdf", pin: true, ack: true, share: [trade("Groundworkers")],
    doc: { title: "RAMS: Excavation and Drainage", ref: "RMG-RAMS-014", rev: "2", author: "Ryecroft Moor Groundworks Ltd", sections: [
      { h: "Scope of works", p: ["Excavation of foul and surface water drainage runs, manholes MH1 to MH7 and connections to plots 1 to 7, as shown on drawing 2417-KLC-XX-ZZ-DR-C-0500. Trenches up to 2.4 m deep in made ground over clay."] },
      { h: "Sequence of works", p: ["1. Locate and mark existing services using CAT and Genny, and hand dig trial holes at every crossing.", "2. Set out runs and levels from the engineer's drawing; agree with the site manager before breaking ground.", "3. Excavate with a 9 t excavator, installing trench boxes before anyone enters any trench deeper than 1.2 m.", "4. Lay bedding, pipes and surround; test each run before backfilling.", "5. Backfill in layers and compact; reinstate surfaces and remove spoil daily."] },
      { h: "Hazards and controls", table: [["Hazard", "Risk", "Control"], ["Collapse of excavation", "High", "Trench boxes over 1.2 m, inspected daily and after rain; recorded in the excavation register"], ["Buried services", "High", "Permit to dig, CAT scan, hand dig within 500 mm of any marked service"], ["Plant and people", "High", "Banksman for every slew and reverse, exclusion zone marked with barriers"], ["Falls into excavation", "Medium", "Edge protection and covers at all times when unattended"], ["Water ingress", "Medium", "Pump on standby; stop work if the trench floods"], ["Contaminated ground", "Low", "Stop and report any unusual smell or colour to the site manager"]] },
      { h: "Personal protective equipment", p: ["Hard hat, hi-vis, safety boots with midsole, gloves and eye protection at all times. Ear defenders when breaking out. RPE (FFP3) when cutting concrete."] },
      { h: "Emergency arrangements", p: ["First aiders: Darren Firth, Gary Booth. First aid kit and eye wash in the site cabin. Nearest A&E: Pinderfields Hospital, Wakefield. In an emergency call 999 and then the site manager."] },
      { h: "Briefing", p: ["Every operative must read this RAMS to the end and sign it off in SiteSort before starting work. Any change to the method needs a revised RAMS, not a verbal agreement."] },
    ] } },
  { name: "RAMS: Scaffold Erection and Dismantle, Airedale Scaffolding", type: "method_statement", file: "rams-scaffold.pdf", pin: true, ack: true, share: [ALL],
    doc: { title: "RAMS: Scaffold Erection and Dismantle", ref: "AS-RAMS-031", rev: "1", author: "Airedale Scaffolding Ltd", sections: [
      { h: "Scope of works", p: ["Erection, adaptation and dismantling of independent tied scaffolds to plots 1 to 3, including loading bays, to the TG20 compliance sheet."] },
      { h: "Sequence of works", p: ["1. Inspect ground and base plates; sole boards on all soft ground.", "2. Erect in lifts with advance guardrails; tie as erected.", "3. Hand over with a scaffold tag and handover certificate; nobody uses an untagged scaffold.", "4. Weekly and after-weather inspections recorded."] },
      { h: "Hazards and controls", table: [["Hazard", "Risk", "Control"], ["Falls from height", "High", "Advance guardrail system, harness clipped where guardrails are not yet in place"], ["Falling materials", "High", "Exclusion zone below, toe boards and brick guards"], ["Overloading", "Medium", "Loading bay rated and signed, no materials stacked on working lifts"], ["Unauthorised alteration", "Medium", "Only Airedale scaffolders alter the scaffold; report damage to the site manager"]] },
      { h: "For everyone on site", p: ["Check the tag before you climb. Green tag: safe to use. Red tag or no tag: keep off and tell the site manager. Never remove a tie, a board or a guardrail."] },
    ] } },
  { name: "Construction Phase Plan", type: "safety", file: "construction-phase-plan.pdf", pin: true, ack: true, share: [],
    doc: { title: "Construction Phase Plan", ref: "BHC-2417-CPP", rev: "3", author: "Sarah Whitworth, Project Manager", sections: [
      { h: "Project description", p: ["Construction of 14 two-storey houses with gardens, an estate road, drainage and external works at Ravensworth Mews, Old Mill Lane, Ossett. Programme: September 2026 to August 2027. Principal contractor: Brookfield & Haigh Construction Ltd."] },
      { h: "Management structure", table: [["Role", "Name"], ["Project manager", "Sarah Whitworth"], ["Site manager", "Gary Booth"], ["Managing director", "Richard Haigh"]] },
      { h: "Site rules", p: ["Everyone signs in and out at the gate using the site QR code. PPE at all times beyond the welfare area. No work without a signed-off RAMS. Speed limit 5 mph. No smoking or vaping except in the marked area."] },
      { h: "Welfare", p: ["Welfare cabin with drying room, canteen and toilets at the site entrance. Drinking water in the canteen."] },
      { h: "Significant risks", p: ["Deep excavations, work at height on scaffolds, lifting operations with the telehandler, hot works on roofs, and vehicle movements on the estate road. Each has its own RAMS or permit."] },
      { h: "Emergency procedures", p: ["Fire assembly point: the site entrance by the welfare cabin. The fire roll is taken from the Site Register. First aiders and the nearest A&E are listed on the site board."] },
    ] } },
  { name: "Site Rules and Induction", type: "safety", file: "site-rules-induction.pdf", pin: true, ack: true, share: [],
    doc: { title: "Site Rules and Induction", ref: "BHC-2417-IND", rev: "2", author: "Gary Booth, Site Manager", sections: [
      { h: "Before you start", p: ["Sign in at the gate with the site QR code every time you arrive, and sign out when you leave. Your firm's public liability insurance must be on file or the gate will hold you until a manager decides."] },
      { h: "Rules", p: ["PPE: hard hat, hi-vis, safety boots, gloves. Eye protection when cutting or drilling.", "Read and sign off your RAMS before starting work.", "Keep walkways clear; store materials in the compound.", "Report every accident, near miss and hazard to the site manager, or log it in the Team Portal as a site issue.", "No alcohol or drugs. Anyone unfit for work will be sent off site."] },
      { h: "Emergencies", p: ["On the fire alarm, stop work, make plant safe and go to the assembly point at the site entrance. Do not leave until the roll has been taken."] },
    ] } },
  { name: "Fire and Emergency Plan", type: "safety", file: "fire-emergency-plan.pdf", pin: true, ack: true, share: [],
    doc: { title: "Fire and Emergency Plan", ref: "BHC-2417-FEP", rev: "1", author: "Gary Booth, Site Manager", sections: [
      { h: "Raising the alarm", p: ["Fire alarm call points at the welfare cabin and the materials compound. Shout FIRE and operate the nearest call point."] },
      { h: "Assembly point", p: ["Site entrance, beside the welfare cabin. The site manager takes the roll from the Site Register."] },
      { h: "Hot works", p: ["Hot works only with a permit. Fire watch for 60 minutes after work stops; extinguisher at the point of work."] },
      { h: "Extinguishers", table: [["Location", "Type"], ["Welfare cabin", "CO2 and water"], ["Materials compound", "Foam"], ["Roof level, plots 1 to 3", "CO2 (during hot works)"]] },
    ] } },
  { name: "COSHH Register", type: "general", file: "coshh-register.pdf", pin: false, ack: false, share: [ALL],
    doc: { title: "COSHH Register", ref: "BHC-2417-COSHH", rev: "1", author: "Gary Booth, Site Manager", sections: [
      { h: "Substances on site", table: [["Substance", "Use", "Hazard", "Controls"], ["Cement and mortar", "Bricklaying", "Skin burns, dermatitis", "Gloves, wash facilities"], ["Silica dust", "Cutting blocks and kerbs", "Lung disease", "Water suppression, FFP3"], ["Diesel", "Plant fuel", "Flammable, skin irritant", "Bunded bowser, spill kit"], ["Expanding foam", "Window fitting", "Skin and eye irritant", "Gloves, goggles, ventilation"], ["Lead flashing", "Roofing", "Toxic if ingested", "Gloves, wash before eating"]] },
    ] } },
  { name: "Delivery and Site Access Plan", type: "general", file: "delivery-access-plan.pdf", pin: false, ack: false, share: [ALL],
    doc: { title: "Delivery and Site Access Plan", ref: "BHC-2417-DAP", rev: "1", author: "Gary Booth, Site Manager", sections: [
      { h: "Delivery hours", p: ["Monday to Friday 08:00 to 16:00. No deliveries during the school run on Old Mill Lane (08:30 to 09:00 and 15:00 to 15:30)."] },
      { h: "Access", p: ["All vehicles enter through the main gate and report to the site manager. A banksman guides every reversing vehicle. Unloading only in the compound."] },
      { h: "Parking", p: ["No parking on Old Mill Lane. Operative parking in the marked area beside the welfare cabin."] },
    ] } },
];

// ---------------------------------------------------------------- api
let token = "";
async function api<T = any>(method: string, path: string, body?: unknown, okStatuses = [200, 201]): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base}/api${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!okStatuses.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 300)}`);
  return { status: res.status, data };
}
async function upload(file: { name: string; bytes: Buffer }): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: "application/pdf" }), file.name);
  const res = await fetch(`${base}/api/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await res.json() as { url?: string };
  if (res.status !== 200 || !data.url) throw new Error(`upload ${file.name} -> ${res.status} ${JSON.stringify(data)}`);
  return data.url.split("?")[0];
}
const created: string[] = [];
const log = (what: string, id: string, isNew: boolean) => { console.log(`${isNew ? "created " : "exists  "} ${what} ${id}`); if (isNew) created.push(`${what} ${id}`); };

// ---------------------------------------------------------------- checks
function checkEmails() {
  const inboxes = new Set([ADMIN_EMAIL, ...Object.values(INBOX)]);
  const all = [sarah.email, gary.email, ...firms.flatMap(f => f.people.map(p => p.email))];
  const bad = all.filter(e => !inboxes.has(e.toLowerCase()) && !NEVER_SEND.some(d => e.toLowerCase().endsWith(`@${d}`)));
  if (bad.length) { console.error(`Refusing: these addresses are neither on the never-send list nor one of your inboxes: ${bad.join(", ")}`); process.exit(2); }
  // Ofcom's drama ranges only: 07700 900000 to 900999, 0113 496 0000 to 0999.
  const phones = [gary.phone, ...firms.flatMap(f => f.people.map(p => p.phone))];
  const realLooking = phones.filter(n => !/^07700 900\d{3}$/.test(n) && !/^0113 496 0\d{3}$/.test(n));
  if (realLooking.length) { console.error(`Refusing: these numbers are outside Ofcom's drama ranges: ${realLooking.join(", ")}`); process.exit(2); }
}

async function main() {
  checkEmails();
  const login = await api<{ token: string }>("POST", "/auth/login", { email: ADMIN_EMAIL, password: PASSWORD });
  token = login.data.token;
  const co = (await api<{ name: string; betaAccess: boolean }>("GET", "/companies/mine")).data;
  if (co.name !== COMPANY) { console.error(`Refusing: signed in to "${co.name}", not "${COMPANY}".`); process.exit(2); }
  if (!co.betaAccess) { console.error("Refusing: beta access is off for this company. Run the beta_access SQL first."); process.exit(2); }
  console.log(`Signed in to ${co.name} on ${base}.`);

  const files = new DemoFiles(join(tmpdir(), "sitesort-demo-files"));
  const projects = (await api<any[]>("GET", "/projects")).data;
  const project = projects.find(p => p.name === PROJECT.name);
  if (nextRevision) {
    if (!project) { console.error("Run the seed first."); process.exit(2); }
    await uploadNextRevision(project.id, files);
    return;
  }

  // Sarah, project manager
  const users = (await api<any[]>("GET", "/users")).data;
  const sarahRow = users.find(u => u.email?.toLowerCase() === sarah.email);
  if (sarahRow) log("user Sarah Whitworth", sarahRow.id, false);
  else { const r = await api("POST", "/users", { name: sarah.name, email: sarah.email, role: sarah.role, roleTitle: sarah.roleTitle }); log("user Sarah Whitworth", r.data.id ?? r.data.user?.id ?? "", true); }
  const sarahId = (sarahRow ?? (await api<any[]>("GET", "/users")).data.find(u => u.email?.toLowerCase() === sarah.email)).id as string;

  // Firms, their people, insurance
  const subs = (await api<any[]>("GET", "/subcontractors")).data;
  const personIds: Record<string, string> = {};
  for (const f of firms) {
    let sub = subs.find(s => s.companyName === f.name && !s.archivedAt);
    const primary = f.people[0];
    if (sub) log(`firm ${f.name}`, sub.id, false);
    else {
      sub = (await api("POST", "/subcontractors", { companyName: f.name, contactFirstName: primary.first, contactLastName: primary.last, contactEmail: primary.email, contactPhone: primary.phone, contactType: f.type, roleTitle: primary.role, trades: f.trades })).data;
      log(`firm ${f.name}`, sub.id, true);
    }
    const people = (await api<any[]>("GET", `/subcontractors/${sub.id}/people`)).data;
    for (const p of f.people) {
      let row = people.find(x => x.email?.toLowerCase() === p.email.toLowerCase());
      if (!row) { row = (await api("POST", `/subcontractors/${sub.id}/people`, { firstName: p.first, lastName: p.last, email: p.email, phone: p.phone, roleTitle: p.role })).data; log(`person ${p.first} ${p.last}`, row.id, true); }
      else log(`person ${p.first} ${p.last}`, row.id, false);
      personIds[p.key] = row.id;
    }
    if (f.pli) {
      const detail = (await api<any>("GET", `/subcontractors/${sub.id}`)).data;
      const has = (detail.insuranceRecords ?? []).some((r: any) => r.type === "public_liability" && !r.archivedAt);
      if (has) log(`public liability ${f.name}`, f.pli.to, false);
      else {
        const toUk = new Date(f.pli.to).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        const file = await files.cert({ kind: "insurance", holder: f.name, address: f.address, policy: f.pli.policy, from: f.pli.from, to: toUk, limit: "£5,000,000", activity: f.pli.activity }, `pli-${f.pli.policy.replace(/\W/g, "")}.pdf`);
        const url = await upload(file);
        const r = await api("POST", `/subcontractors/${sub.id}/insurance`, { type: "public_liability", certificateUrl: url, expiryDate: f.pli.to });
        log(`public liability ${f.name} to ${f.pli.to}`, r.data.id, true);
      }
    }
  }
  for (const c of personCerts) {
    const pid = personIds[c.person];
    const existing = (await api<any[]>("GET", `/people/${pid}/certifications`)).data.find(x => x.name === c.name && !x.archivedAt);
    if (existing) { log(`certificate ${c.name} (${c.person})`, existing.id, false); continue; }
    const url = await upload(await files.cert(c.file, `cert-${c.person}-${c.certType}.pdf`));
    const r = await api("POST", `/people/${pid}/certifications`, { name: c.name, expiryDate: c.expiryDate, documentUrl: url, certType: c.certType, certNumber: c.file.kind === "card" ? c.file.number : c.file.policy });
    log(`certificate ${c.name} (${c.person}) to ${c.expiryDate}`, r.data.id, true);
  }

  // Projects
  async function ensureProject(p: typeof PROJECT) {
    const found = projects.find(x => x.name === p.name);
    if (found) { log(`project ${p.name}`, found.id, false); return found.id as string; }
    const r = await api("POST", "/projects", p);
    log(`project ${p.name}`, r.data.id, true);
    return r.data.id as string;
  }
  const pid = await ensureProject(PROJECT);
  await ensureProject(PROJECT2);

  // Gary, in-house (POST returns the existing card when the email is known)
  const g = await api("POST", `/projects/${pid}/in-house-people`, { firstName: gary.first, lastName: gary.last, email: gary.email, phone: gary.phone, roleTitle: gary.role });
  log("in-house person Gary Booth", g.data.id, g.status === 201);
  personIds.gary = g.data.id;

  // Cards on the project, then portal invites (only where none was ever sent)
  const everyone: Person[] = [gary, ...firms.flatMap(f => f.people)];
  for (const p of everyone) {
    const r = await api("POST", `/projects/${pid}/members/person`, { personId: personIds[p.key], role: p.key === "gary" ? "manager" : "worker" }, [201, 409]);
    log(`card on project ${p.first} ${p.last}`, personIds[p.key], r.status === 201);
  }
  const invites = (await api<any[]>("GET", `/projects/${pid}/invites`)).data;
  for (const p of everyone.filter(x => x.invite)) {
    const had = invites.find(i => i.email?.toLowerCase() === p.email.toLowerCase() && ["pending", "accepted"].includes(i.status));
    if (had) { log(`portal invite ${p.first} ${p.last} (${had.status})`, had.id, false); continue; }
    const r = await api("POST", `/projects/${pid}/portal-invites`, { personId: personIds[p.key], role: p.key === "gary" ? "manager" : "worker" });
    log(`portal invite ${p.first} ${p.last} (email ${r.data.emailStatus ?? r.data.status})`, personIds[p.key], true);
  }

  // Gary becomes site manager once he has a login (after accepting his invite)
  const proj = (await api<any>("GET", `/projects/${pid}`)).data;
  const members = (await api<any[]>("GET", `/projects/${pid}/members`)).data;
  const garyLogin = members.find(m => m.personId === personIds.gary && m.userId)?.userId;
  if (proj.siteManagerId) log("site manager", proj.siteManagerId, false);
  else if (garyLogin) { await api("PATCH", `/projects/${pid}`, { siteManagerId: garyLogin }); log("site manager Gary Booth", garyLogin, true); }
  else console.log("waiting  site manager: Gary hasn't accepted his invite yet; run this again after he has.");

  // Drawings and documents
  const existingDocs = (await api<any[]>("GET", `/projects/${pid}/documents`)).data;
  async function addDoc(name: string, type: string, file: { name: string; bytes: Buffer }, opts: { pin: boolean; ack: boolean; revision?: string; share: Dwg["share"] }) {
    const found = existingDocs.find(d => d.name === name);
    if (found) { log(`document ${name}`, found.id, false); return; }
    const url = await upload(file);
    const r = await api("POST", `/projects/${pid}/documents`, { name, type, fileUrl: url, fileSize: file.bytes.length, requiresAcknowledgment: opts.ack, requirePinSignoff: opts.pin, revision: opts.revision });
    log(`document ${name}${opts.revision ? ` ${opts.revision}` : ""}`, r.data.id, true);
    if (opts.share.length) {
      await api("POST", `/projects/${pid}/portal-shares`, { itemType: "document", itemId: r.data.id, audiences: opts.share, alsoEmail: false });
      log(`  shared with ${opts.share.map(a => a.type === "all" ? "everyone" : a.trade).join(", ")}`, r.data.id, true);
    }
  }
  for (const d of drawings) await addDoc(dwgName(d), "drawing", await files.drawing(d), { pin: true, ack: true, revision: d.rev, share: d.share });
  for (const d of docs) await addDoc(d.name, d.type, await files.text(d.doc, d.file), { pin: d.pin, ack: d.ack, share: d.share });

  // Permits (Hot Works is issued by hand on the day it's needed)
  const today = new Date().toISOString().slice(0, 10);
  const plus = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const permits = (await api<any[]>("GET", `/projects/${pid}/permits`)).data;
  for (const p of [
    { type: "Excavation", description: "Drainage runs MH1 to MH7, Ryecroft Moor Groundworks", startDate: today, expiryDate: plus(28) },
    { type: "Working at Heights", description: "Scaffold to plots 1 to 3, Airedale Scaffolding", startDate: today, expiryDate: plus(60) },
    { type: "Scaffolding Inspection", description: "Weekly inspection, plots 1 to 3 scaffold", startDate: today, expiryDate: plus(7) },
  ]) {
    const found = permits.find(x => x.type === p.type && x.description === p.description && !x.archivedAt);
    if (found) { log(`permit ${p.type}`, found.id, false); continue; }
    const r = await api("POST", `/projects/${pid}/permits`, { ...p, responsibleUserId: sarahId });
    log(`permit ${p.type} to ${p.expiryDate}`, r.data.id, true);
  }

  // Plant and milestones
  const plant = (await api<any[]>("GET", `/projects/${pid}/plant-items`)).data;
  for (const p of [
    { name: "9 t tracked excavator", category: "plant_equipment", status: "on_site", supplierOwnerText: "Hired", location: "Drainage runs", onSiteDate: today },
    { name: "Telehandler, 14 m", category: "plant_equipment", status: "on_site", supplierOwnerText: "Hired", location: "Materials compound", onSiteDate: today },
  ]) {
    const found = plant.find(x => x.name === p.name);
    if (found) { log(`plant ${p.name}`, found.id, false); continue; }
    const r = await api("POST", `/projects/${pid}/plant-items`, p);
    log(`plant ${p.name}`, r.data.id, true);
  }
  const milestones = (await api<any[]>("GET", `/projects/${pid}/milestones`)).data;
  for (const m of [{ title: "Plots 1 to 7 foundations complete", dueDate: "2026-11-27" }, { title: "Plots 1 to 3 wind and watertight", dueDate: "2027-01-29" }]) {
    const found = milestones.find(x => x.title === m.title);
    if (found) { log(`milestone ${m.title}`, found.id, false); continue; }
    const r = await api("POST", `/projects/${pid}/milestones`, m);
    log(`milestone ${m.title}`, r.data.id, true);
  }

  const pending = drawings.flatMap(d => d.next.map(r => `${d.number} ${r}`));
  console.log(`\nDone: ${created.length} created this run. Later revisions waiting for --next-revision: ${pending.join(", ")}.`);
}

// One later revision per run, carrying the replaced revision's share rules.
async function uploadNextRevision(pid: string, files: DemoFiles) {
  const current = (await api<any[]>("GET", `/projects/${pid}/documents`)).data;
  for (const d of drawings) {
    const doc = current.find(x => x.name === dwgName(d) && x.status === "current");
    if (!doc) continue;
    const all = [d.rev, ...d.next];
    const at = all.indexOf(doc.revision);
    const nextRev = at >= 0 ? all[at + 1] : undefined;
    if (!nextRev) continue;
    const rules = (await api<any[]>("GET", `/projects/${pid}/portal-shares?itemType=document&itemId=${doc.id}`)).data.map(r => r.id);
    const file = await files.drawing({ ...d, rev: nextRev });
    const url = await upload(file);
    const r = await api("POST", `/projects/${pid}/documents`, { name: dwgName(d), type: "drawing", fileUrl: url, fileSize: file.bytes.length, requiresAcknowledgment: true, requirePinSignoff: true, revision: nextRev, supersededDocumentId: doc.id, carryShareIds: rules, carryShownShareIds: rules });
    log(`revision ${dwgName(d)} ${doc.revision} -> ${nextRev} (shares carried: ${rules.length})`, r.data.id, true);
    return;
  }
  console.log("No later revisions left to upload.");
}

main().then(() => closeRenderer()).catch(async e => { console.error(`FAILED: ${(e as Error).message}\nCreated before the failure:\n  ${created.join("\n  ") || "(nothing)"}\nRun again to carry on.`); await closeRenderer(); process.exit(1); });
