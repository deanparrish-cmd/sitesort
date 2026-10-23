// Who someone at the QR gate is, and what the gate does with them (#163, made
// the one shared answer in #164). The gate (routes/qr.ts), the Team tab and the
// routes that put someone on a project all read gate standing from here, so a
// warning on the Team tab can never disagree with the barrier (that is how
// #162 shipped a card saying "will hold" while the gate cleared the man).
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, subcontractorsTable, companyMembersTable, peopleTable, companiesTable, projectsTable } from "@workspace/db/schema";
import { eq, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { memberFirm, subcontractorInsuranceVerdict } from "./insurance";

// INSURANCE (#114, made fail-closed 2026-10-22): every record says what the
// gate does with it (`gate`):
//   firm    judge these firms' public liability (the shared rule).
//   staff   a KNOWN member of the company's own staff: let on with no
//           insurance check, and the check-in says so ("Cleared as in-house
//           staff, no insurance check").
//   unknown no firm, but not known staff either: HELD (firm_unknown).
// Staff is a positive fact, never a fallback: a person card the company added
// with no firm, or a dashboard admin / PM of the project's own company, AND
// nothing links that human to a firm (any of their cards on this project, or
// any card of their login at this company). A login that holds an in-house
// card at the company counts as staff on any of its projects (#164). Before this, any record without a
// card on it skipped the check: a login whose in-house card was matched while
// the same human's firm card said "will hold" was cleared (Dean, prod,
// 2026-10-22, Amy and Annabelle).
export type Gate = { kind: "firm"; subIds: string[] } | { kind: "staff" } | { kind: "unknown" };
export type Registered = {
  key: string;
  kind: "user" | "contact" | "person";
  names: string[];            // accepted spellings of the name
  company: string | null;     // canonical company text
  companyRequired: boolean;
  gate: Gate;
  memberRowIds: string[];     // the project_members rows this record came from
};
// Stricter first: a record that runs an insurance check wins, then one that
// holds, then staff. Used wherever several records could stand for one human.
const GATE_RANK = { firm: 0, unknown: 1, staff: 2 } as const;
const KIND_RANK = { user: 0, contact: 1, person: 2 } as const;
export const byGate = (a: Registered, b: Registered) => GATE_RANK[a.gate.kind] - GATE_RANK[b.gate.kind] || KIND_RANK[a.kind] - KIND_RANK[b.kind];
const firmGate = (subIds: Iterable<string>): Gate | null => { const ids = [...new Set(subIds)]; return ids.length ? { kind: "firm", subIds: ids } : null; };

export async function loadRegistered(projectId: string): Promise<Registered[]> {
  const out: Registered[] = [];
  const proj = (await db.select({ name: companiesTable.name, companyId: projectsTable.companyId }).from(projectsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, projectsTable.companyId))
    .where(eq(projectsTable.id, projectId)).limit(1))[0];
  const own = proj?.name ?? null;
  const companyId = proj?.companyId ?? null;

  // Every card on the project, with its primary person, keyed once.
  const contacts = await db.select({ rowId: projectMembersTable.id, id: subcontractorsTable.id, contactName: subcontractorsTable.contactName, companyName: subcontractorsTable.companyName })
    .from(projectMembersTable)
    .innerJoin(subcontractorsTable, eq(subcontractorsTable.id, projectMembersTable.subcontractorId))
    .where(eq(projectMembersTable.projectId, projectId));

  // People on the project (and the firm each belongs to, if any).
  const people = await db.select({
    rowId: projectMembersTable.id, id: peopleTable.id, name: peopleTable.name, subId: peopleTable.subcontractorId, subCompany: subcontractorsTable.companyName,
    companyId: peopleTable.companyId, userId: peopleTable.userId, rowFirm: projectMembersTable.subcontractorId,
  })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
    .leftJoin(subcontractorsTable, eq(subcontractorsTable.id, peopleTable.subcontractorId))
    .where(and(eq(projectMembersTable.projectId, projectId), isNull(peopleTable.archivedAt)));

  // Users on the project, with the firm their row belongs to (memberFirm: the
  // person's firm, else the row's own; the same rule the Team tab card uses).
  const users = await db.select({
    rowId: projectMembersTable.id, id: usersTable.id, name: usersTable.name, portalOnly: usersTable.portalOnly,
    personId: projectMembersTable.personId, personName: peopleTable.name, personCompanyId: peopleTable.companyId,
    rowFirm: projectMembersTable.subcontractorId, personFirm: peopleTable.subcontractorId,
  })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, projectMembersTable.userId))
    .leftJoin(peopleTable, eq(peopleTable.id, projectMembersTable.personId))
    .where(eq(projectMembersTable.projectId, projectId));

  // Every firm each login is known at: its rows on this project, and any card
  // of that login at this company (on any project), archived cards aside.
  const loginIds = [...new Set([...users.map(u => u.id), ...people.map(p => p.userId).filter((v): v is string => !!v)])];
  const loginFirms = new Map<string, Set<string>>();
  const addFirm = (userId: string | null | undefined, firm: string | null | undefined) => {
    if (!userId || !firm) return;
    if (!loginFirms.has(userId)) loginFirms.set(userId, new Set());
    loginFirms.get(userId)!.add(firm);
  };
  for (const u of users) addFirm(u.id, memberFirm(u.rowFirm, u.personFirm));
  for (const p of people) addFirm(p.userId, memberFirm(p.rowFirm, p.subId));
  // Logins that hold an in-house card (no firm) at this company: staff.
  const inHouseLogins = new Set<string>();
  if (loginIds.length && companyId) {
    const cards = await db.select({ userId: peopleTable.userId, firm: peopleTable.subcontractorId }).from(peopleTable)
      .where(and(inArray(peopleTable.userId, loginIds), eq(peopleTable.companyId, companyId), isNull(peopleTable.archivedAt)));
    for (const c of cards) {
      if (c.firm) addFirm(c.userId, c.firm);
      else if (c.userId) inHouseLogins.add(c.userId);
    }
  }
  // Dashboard admins / PMs of the project's own company: staff by account.
  const staffLogins = new Set<string>(loginIds.length && companyId
    ? (await db.select({ userId: companyMembersTable.userId }).from(companyMembersTable)
        .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
        .where(and(eq(companyMembersTable.companyId, companyId), inArray(companyMembersTable.userId, loginIds),
          inArray(companyMembersTable.role, ["admin", "project_manager"]), eq(usersTable.portalOnly, false)))).map(r => r.userId)
    : []);

  const userSubIds = users.map(u => memberFirm(u.rowFirm, u.personFirm)).filter((v): v is string => !!v);
  const subIds = [...new Set([...contacts.map(c => c.id), ...userSubIds])];
  const subs = subIds.length
    ? await db.select({ id: subcontractorsTable.id, companyName: subcontractorsTable.companyName }).from(subcontractorsTable).where(inArray(subcontractorsTable.id, subIds))
    : [];
  const subCompany = new Map(subs.map(x => [x.id, x.companyName]));
  const primaries = subIds.length
    ? await db.select({ id: peopleTable.id, subId: peopleTable.subcontractorId, name: peopleTable.name })
        .from(peopleTable)
        .where(and(inArray(peopleTable.subcontractorId, subIds), eq(peopleTable.isPrimaryContact, true), isNull(peopleTable.archivedAt)))
    : [];
  const primaryBySub = new Map(primaries.map(p => [p.subId as string, p]));
  const cardKey = (subId: string) => { const prim = primaryBySub.get(subId); return prim ? `person:${prim.id}` : `sub:${subId}`; };

  // No firm on the record itself: the login's firms if it has any, else staff
  // only when positively known, else unknown (held).
  const noFirmGate = (userId: string | null | undefined, inHouseCard: boolean): Gate =>
    (userId ? firmGate(loginFirms.get(userId) ?? []) : null)
      ?? ((inHouseCard || (!!userId && (staffLogins.has(userId) || inHouseLogins.has(userId)))) ? { kind: "staff" } : { kind: "unknown" });

  for (const u of users) {
    const names = [...new Set([u.name, u.personName].filter((n): n is string => !!n))];
    const firm = memberFirm(u.rowFirm, u.personFirm);
    if (firm) {
      // A subcontractor's own login: same identity, company and insurance as their card.
      out.push({ key: u.personId ? `person:${u.personId}` : cardKey(firm), kind: "user", names, company: subCompany.get(firm) ?? null, companyRequired: true, gate: { kind: "firm", subIds: [firm] }, memberRowIds: [u.rowId] });
    } else {
      // In-house card = a person row this company added with no firm.
      const inHouseCard = !!u.personId && !!companyId && u.personCompanyId === companyId;
      out.push({ key: `user:${u.id}`, kind: "user", names, company: own, companyRequired: !!own, gate: noFirmGate(u.id, inHouseCard), memberRowIds: [u.rowId] });
    }
  }
  for (const c of contacts) {
    const prim = primaryBySub.get(c.id);
    // Accept the contact card's spelling AND its linked primary person's, and
    // key both to the person so they group as one human.
    out.push({ key: cardKey(c.id), kind: "contact", names: [c.contactName, ...(prim ? [prim.name] : [])], company: c.companyName, companyRequired: true, gate: { kind: "firm", subIds: [c.id] }, memberRowIds: [c.rowId] });
  }
  for (const p of people) {
    const firm = memberFirm(p.rowFirm, p.subId);
    if (firm) out.push({ key: `person:${p.id}`, kind: "person", names: [p.name], company: p.subCompany ?? subCompany.get(firm) ?? null, companyRequired: true, gate: { kind: "firm", subIds: [firm] }, memberRowIds: [p.rowId] });
    else out.push({ key: `person:${p.id}`, kind: "person", names: [p.name], company: own, companyRequired: !!own, gate: noFirmGate(p.userId, !!companyId && p.companyId === companyId), memberRowIds: [p.rowId] });
  }
  // One human, one verdict: every record sharing a key takes the strictest
  // gate among them, so which record a lookup lands on can't change it.
  const strictest = new Map<string, Gate>();
  for (const r of out) {
    const cur = strictest.get(r.key);
    if (!cur || GATE_RANK[r.gate.kind] < GATE_RANK[cur.kind]) strictest.set(r.key, r.gate);
    else if (cur.kind === "firm" && r.gate.kind === "firm") strictest.set(r.key, { kind: "firm", subIds: [...new Set([...cur.subIds, ...r.gate.subIds])] });
  }
  for (const r of out) r.gate = strictest.get(r.key)!;
  return out;
}

// The record a key stands for (remembered phone, "Is this you?" tap):
// strictest first, same as every other lookup.
export function recordForKey(records: Registered[], key: string): Registered | null {
  return records.filter(r => r.key === key).sort(byGate)[0] ?? null;
}

// ---- Gate standing per team row (Team tab, Add to project, invites) -------
// The strictest gate among the records a row produced: exactly what the gate
// would do for that person.
export async function gateStandingByMember(projectId: string): Promise<Map<string, Gate>> {
  const out = new Map<string, Gate>();
  for (const r of await loadRegistered(projectId)) {
    for (const rowId of r.memberRowIds) {
      const cur = out.get(rowId);
      if (!cur || GATE_RANK[r.gate.kind] < GATE_RANK[cur.kind]) out.set(rowId, r.gate);
    }
  }
  return out;
}

// The gate standing in words, for the people who can fix it. `holds` = the
// gate will hold this person today.
export type GateStanding = { kind: "firm" | "staff" | "held"; holds: boolean; text: string };
export const HELD_NO_CARD_TEXT = "Held at the gate: no card or firm. They'll be held until you give them a card or a firm.";
export const STAFF_TEXT = "Let on as in-house staff, no insurance check.";
export async function describeGate(gate: Gate | undefined, companyId: string): Promise<GateStanding> {
  if (!gate || gate.kind === "unknown") return { kind: "held", holds: true, text: HELD_NO_CARD_TEXT };
  if (gate.kind === "staff") return { kind: "staff", holds: false, text: STAFF_TEXT };
  // Same verdict as the gate: every firm must be covered; the first that holds
  // says why, else the one expiring soonest.
  const verdicts = await Promise.all(gate.subIds.map(id => subcontractorInsuranceVerdict(id, companyId)));
  const holding = verdicts.find(v => v.holds);
  const shown = holding ?? [...verdicts].sort((a, b) => String(a.publicLiabilityExpiry).localeCompare(String(b.publicLiabilityExpiry)))[0];
  return { kind: "firm", holds: !!holding, text: shown.reason };
}
export async function gateStandingFor(projectId: string, memberRowId: string): Promise<GateStanding> {
  const project = (await db.select({ companyId: projectsTable.companyId }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1))[0];
  return describeGate((await gateStandingByMember(projectId)).get(memberRowId), project?.companyId ?? "");
}
