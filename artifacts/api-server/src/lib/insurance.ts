// Single source of truth for "is this subcontractor/person insured" — used by
// BOTH the Contacts directory's insurance badge (subcontractors.ts) and the
// site-board check-in gate (qr.ts). Before this, qr.ts re-implemented only
// HALF of the contact card's logic — a raw `insurance_records` (company-level)
// query with no awareness of a filed insurance-named PERSON certification —
// so a contact showing "Insurance OK" on their card (via a filed person cert)
// could still be turned away at check-in with "no valid insurance on file".
// See Bug: check-in blocks a contact whose card shows valid insurance.
import { db } from "@workspace/db";
import { insuranceRecordsTable, personCertificationsTable, peopleTable } from "@workspace/db/schema";
import { eq, and, isNull, inArray, or, sql, desc } from "drizzle-orm";
import { expiryStatus } from "./expiry";

export type InsuranceStatus = "valid" | "expiring_soon" | "expired" | "none";

// Insurance uses "valid" where the shared expiry helper says "active"; the
// bands (expiring_soon <=30d, expired) are identical — reuse the one
// canonical helper (F1) so certs agree with permits/compliance/QR.
export function computeRecordStatus(expiryDate: string): "valid" | "expiring_soon" | "expired" {
  const s = expiryStatus(expiryDate);
  return s === "active" ? "valid" : s;
}

export function computeInsuranceStatus(records: Array<{ expiryDate: string }>): InsuranceStatus {
  if (records.length === 0) return "none";
  const statuses = records.map(r => computeRecordStatus(r.expiryDate));
  if (statuses.some(s => s === "expired")) return "expired";
  if (statuses.some(s => s === "expiring_soon")) return "expiring_soon";
  return "valid";
}

// ---- Typed certificates (Dean, 2026-10-22) ---------------------------------
// The gate used to decide insurance by whether a certificate's typed NAME
// contained "insur": "Public liability" didn't count (a covered man held),
// "Car insurance" did (anyone waved through). A certificate now has a TYPE,
// set or confirmed by a PM; until then (cert_type NULL) it never counts as
// insurance. Existing ones get a suggestion from the name, never applied
// silently: a wrong guess puts someone on site who shouldn't be there.
export const CERT_TYPES = ["public_liability", "employers_liability", "other_insurance", "qualification"] as const;
export type CertType = typeof CERT_TYPES[number];
export const INSURANCE_CERT_TYPES = new Set<string>(["public_liability", "employers_liability", "other_insurance"]);
export const CERT_TYPE_LABEL: Record<CertType, string> = {
  public_liability: "Public liability insurance",
  employers_liability: "Employer's liability insurance",
  other_insurance: "Other insurance",
  qualification: "Qualification or card",
};
export function suggestCertType(name: string): CertType {
  const n = name.toLowerCase();
  if (/employer/.test(n)) return "employers_liability";
  if (/public|\bpli\b|\bpl\b|liabil/.test(n)) return "public_liability";
  if (/insur/.test(n)) return "other_insurance";
  return "qualification";
}
export function isInsuranceCert(c: { certType?: string | null }): boolean {
  return !!c.certType && INSURANCE_CERT_TYPES.has(c.certType);
}

// Certifications filed against this contact's people (e.g. an approved
// Insurance document filed via "Add to contact" in Team activity).
export async function certificationsForSubcontractor(subcontractorId: string, companyId: string) {
  // People directly linked to this subcontractor.
  const linked = await db.select({
    id: peopleTable.id, userId: peopleTable.userId, email: peopleTable.email,
  }).from(peopleTable)
    .where(and(eq(peopleTable.subcontractorId, subcontractorId), eq(peopleTable.companyId, companyId)));
  if (linked.length === 0) return [];
  // Duplicate person rows can exist for the same human (same user account or
  // email) where only one is linked to the subcontractor. Certs filed onto a
  // duplicate must still count, so expand to siblings.
  const userIds = linked.map(p => p.userId).filter((v): v is string => !!v);
  const emails = linked.map(p => p.email?.trim().toLowerCase()).filter((v): v is string => !!v);
  const siblingConds = [] as ReturnType<typeof eq>[];
  if (userIds.length) siblingConds.push(inArray(peopleTable.userId, userIds));
  if (emails.length) siblingConds.push(inArray(sql`lower(trim(${peopleTable.email}))`, emails));
  const siblings = siblingConds.length
    ? await db.select({ id: peopleTable.id }).from(peopleTable)
        .where(and(eq(peopleTable.companyId, companyId), or(...siblingConds)))
    : [];
  const personIds = Array.from(new Set([...linked.map(p => p.id), ...siblings.map(p => p.id)]));
  const rows = await db.select({
    id: personCertificationsTable.id,
    personId: personCertificationsTable.personId,
    name: personCertificationsTable.name,
    certType: personCertificationsTable.certType,
    certNumber: personCertificationsTable.certNumber,
    expiryDate: personCertificationsTable.expiryDate,
    documentUrl: personCertificationsTable.documentUrl,
    createdAt: personCertificationsTable.createdAt,
  }).from(personCertificationsTable)
    .innerJoin(peopleTable, eq(peopleTable.id, personCertificationsTable.personId))
    // companyId re-check is defense-in-depth: callers already verify the
    // subcontractor belongs to the caller's company.
    .where(and(inArray(personCertificationsTable.personId, personIds), eq(peopleTable.companyId, companyId), isNull(personCertificationsTable.archivedAt)))
    .orderBy(desc(personCertificationsTable.createdAt));
  return rows.map(c => ({
    id: c.id,
    personId: c.personId,
    name: c.name,
    certNumber: c.certNumber ?? null,
    expiryDate: c.expiryDate,
    status: computeRecordStatus(c.expiryDate),
    documentUrl: c.documentUrl ?? null,
    createdAt: c.createdAt.toISOString(),
    certType: (c.certType ?? null) as CertType | null,
    suggestedType: c.certType ? null : suggestCertType(c.name),
  }));
}

// ---- The one rule (gate, Contacts directory, Team tab card, register) ------
// Covered = an in-date PUBLIC LIABILITY, from the firm's insurance records or a
// person certificate whose type is confirmed as public liability. Only the
// LATEST public liability counts (latest expiry), so last year's certificate
// that nobody archived no longer holds a firm that has renewed (Dean,
// 2026-10-22). Other insurance types are shown but don't decide the gate.
export type GateVerdict = {
  status: InsuranceStatus;          // of the latest public liability
  holds: boolean;                   // the gate holds them (none or expired)
  reason: string;                   // the gate's verdict in words, for the card
  publicLiabilityExpiry: string | null;
  unconfirmedCerts: number;         // certificates on the firm's people with no confirmed type
};
// "2027-01-01" -> "1 Jan 2027" (a date only, no time zone shift).
function ukDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export function verdictFrom(
  insurance: Array<{ type: string; expiryDate: string }>,
  certs: Array<{ certType?: string | null; expiryDate: string }>,
): GateVerdict {
  const pli = [
    ...insurance.filter(r => r.type === "public_liability"),
    ...certs.filter(c => c.certType === "public_liability"),
  ].map(r => r.expiryDate).sort();
  const unconfirmedCerts = certs.filter(c => !c.certType).length;
  const latest = pli.length ? pli[pli.length - 1] : null;
  const waiting = unconfirmedCerts ? ` ${unconfirmedCerts} certificate${unconfirmedCerts === 1 ? " is" : "s are"} waiting for a manager to confirm the type.` : "";
  if (!latest) return { status: "none", holds: true, reason: `Gate: will hold. No public liability insurance on file.${waiting}`, publicLiabilityExpiry: null, unconfirmedCerts };
  const status = computeRecordStatus(latest);
  const when = ukDate(latest);
  if (status === "expired") return { status, holds: true, reason: `Gate: will hold. Public liability expired ${when}.${waiting}`, publicLiabilityExpiry: latest, unconfirmedCerts };
  return { status, holds: false, reason: status === "expiring_soon" ? `Gate: lets on. Public liability expires ${when}, soon.` : `Gate: lets on. Public liability to ${when}.`, publicLiabilityExpiry: latest, unconfirmedCerts };
}

// Kept for callers that only need the status.
export function combinedInsuranceStatus(insurance: Array<{ type: string; expiryDate: string }>, certs: Array<{ certType?: string | null; expiryDate: string }>): InsuranceStatus {
  return verdictFrom(insurance, certs).status;
}

export async function subcontractorInsuranceVerdict(subcontractorId: string, companyId: string): Promise<GateVerdict> {
  const insurance = await db.select({ type: insuranceRecordsTable.type, expiryDate: insuranceRecordsTable.expiryDate }).from(insuranceRecordsTable)
    .where(and(eq(insuranceRecordsTable.subcontractorId, subcontractorId), isNull(insuranceRecordsTable.archivedAt)));
  const certs = await certificationsForSubcontractor(subcontractorId, companyId);
  return verdictFrom(insurance, certs);
}

// The gate's entry point (qr.ts): same verdict, status only.
export async function subcontractorInsuranceStatus(subcontractorId: string, companyId: string): Promise<InsuranceStatus> {
  return (await subcontractorInsuranceVerdict(subcontractorId, companyId)).status;
}
