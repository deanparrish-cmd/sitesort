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

export function isInsuranceCert(c: { name: string }): boolean {
  return /insur/i.test(c.name);
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
  }));
}

// Insurance evidence = company-level insurance records PLUS any filed
// insurance-named person certification (both carry an expiryDate).
export function combinedInsuranceStatus(insurance: Array<{ expiryDate: string }>, certs: Array<{ name: string; expiryDate: string }>): InsuranceStatus {
  return computeInsuranceStatus([...insurance, ...certs.filter(isInsuranceCert)]);
}

// One entry point: is this subcontractor currently insured, counting BOTH
// company-level insurance_records and any linked person's filed insurance
// certification? This is exactly what the Contacts directory's "Insurance
// OK" badge shows — anything reading insurance status for the SAME
// subcontractor (e.g. a check-in gate) must call this, not re-derive it.
export async function subcontractorInsuranceStatus(subcontractorId: string, companyId: string): Promise<InsuranceStatus> {
  const insurance = await db.select({ expiryDate: insuranceRecordsTable.expiryDate }).from(insuranceRecordsTable)
    .where(and(eq(insuranceRecordsTable.subcontractorId, subcontractorId), isNull(insuranceRecordsTable.archivedAt)));
  const certs = await certificationsForSubcontractor(subcontractorId, companyId);
  return combinedInsuranceStatus(insurance, certs);
}
