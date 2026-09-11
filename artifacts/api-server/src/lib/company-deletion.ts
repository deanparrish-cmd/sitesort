import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { companiesTable, projectsTable, subcontractorsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// node-postgres/drizzle doesn't auto-serialise JS arrays for ANY(); pass an
// explicit Postgres array literal instead (ids are UUIDs — no escaping concerns).
function pgArr(ids: string[]): string {
  return `{${ids.join(",")}}`;
}

// The full hard-delete cascade for one company: every project-scoped,
// subcontractor-scoped, person-scoped and company-scoped row, then the
// company's own user accounts (deleted, or scrubbed if they still own
// non-nullable content in another tenant), then projects/subcontractors/the
// company row itself. Runs entirely on the given `tx`, so a caller that's
// already inside a transaction (e.g. deleting the last user of a company)
// can invoke this as part of that same atomic unit — no nested transaction.
//
// Returns the company's Stripe customer id (read before it's deleted) so the
// caller can cancel any live subscription AFTER this commits — see
// stripe-cancellation.ts's own comment on why that ordering matters.
export async function runCompanyDeletionQueries(tx: Tx, companyId: string): Promise<{
  companyName: string;
  stripeCustomerId: string | null;
  scrubbedUsers: number;
}> {
  const rows = await tx.select({ name: companiesTable.name, stripeCustomerId: companiesTable.stripeCustomerId })
    .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!rows[0]) throw new Error(`company not found: ${companyId}`);
  const { name: companyName, stripeCustomerId } = rows[0];

  // Belt-and-braces: clear betaAccess explicitly before the row goes. Harmless
  // under a hard delete, but means nothing is ever left flagged beta if a
  // future change ever needs to inspect state mid-cascade.
  await tx.update(companiesTable).set({ betaAccess: false }).where(eq(companiesTable.id, companyId));

  const projects = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.companyId, companyId));
  const P = projects.map(p => p.id);
  const subs = await tx.select({ id: subcontractorsTable.id }).from(subcontractorsTable).where(eq(subcontractorsTable.companyId, companyId));
  const S = subs.map(s => s.id);
  const companyUsers = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.companyId, companyId));
  const U = companyUsers.map(u => u.id);

  // Fallback home for scrubbed accounts: another company the user belongs to
  // — captured BEFORE we delete company_members rows below.
  const fallbackCompany = new Map<string, string>();
  if (U.length) {
    const others = await tx.execute(sql`
      select user_id, company_id from company_members
      where user_id = any(${pgArr(U)}::text[]) and company_id <> ${companyId}`);
    for (const r of others.rows as { user_id: string; company_id: string }[]) {
      if (!fallbackCompany.has(r.user_id)) fallbackCompany.set(r.user_id, r.company_id);
    }
  }

  const scrubbed: string[] = [];

  // ── 1. Project-scoped data (children first) ──────────────────────────
  if (P.length) {
    await tx.execute(sql`delete from plant_item_attachments where plant_item_id in (select id from plant_items where project_id = any(${pgArr(P)}::text[]))`);
    await tx.execute(sql`delete from plant_item_distributions where plant_item_id in (select id from plant_items where project_id = any(${pgArr(P)}::text[]))`);
    await tx.execute(sql`delete from document_distributions where document_id in (select id from documents where project_id = any(${pgArr(P)}::text[]))`);
    await tx.execute(sql`delete from acknowledgment_audit_log where document_id in (select id from documents where project_id = any(${pgArr(P)}::text[]))`);
    await tx.execute(sql`delete from message_reactions where message_id in (select id from messages where project_id = any(${pgArr(P)}::text[]))`);
    await tx.execute(sql`delete from channel_message_reactions where channel_message_id in (select id from channel_messages where project_id = any(${pgArr(P)}::text[]))`);
    for (const t of [
      "activity_log", "calendar_events", "channel_reads", "channel_messages",
      "daily_notes", "daily_reports", "documents", "invoices", "messages",
      "milestones", "pending_pushes", "permits", "photos", "plant_items",
      "portal_member_documents", "portal_sessions", "portal_shares",
      "portal_submission_notes", "project_closeouts", "project_invites",
      "project_members", "push_subscriptions", "qr_board_pins", "qr_codes",
      "share_logs", "site_checkins", "subcontractor_documents",
      "subcontractor_notes",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(t)} where project_id = any(${pgArr(P)}::text[])`);
    }
  }

  // ── 2. Subcontractor-scoped ──────────────────────────────────────────
  if (S.length) {
    await tx.execute(sql`delete from insurance_records where subcontractor_id = any(${pgArr(S)}::text[])`);
    await tx.execute(sql`delete from subcontractor_notes where subcontractor_id = any(${pgArr(S)}::text[])`);
    await tx.execute(sql`delete from subcontractor_documents where subcontractor_id = any(${pgArr(S)}::text[])`);
    await tx.execute(sql`delete from project_members where subcontractor_id = any(${pgArr(S)}::text[])`);
    // Cross-tenant safety: nullable references from surviving rows.
    await tx.execute(sql`update plant_items set supplier_contact_id = null where supplier_contact_id = any(${pgArr(S)}::text[])`);
    await tx.execute(sql`update people set subcontractor_id = null where subcontractor_id = any(${pgArr(S)}::text[])`);
  }

  // ── 3. People (the company's contact records) ────────────────────────
  await tx.execute(sql`delete from person_certifications where person_id in (select id from people where company_id = ${companyId})`);
  for (const t of ["portal_member_documents", "portal_shares", "project_invites", "project_members"]) {
    await tx.execute(sql`delete from ${sql.identifier(t)} where person_id in (select id from people where company_id = ${companyId})`);
  }
  await tx.execute(sql`delete from people where company_id = ${companyId}`);

  // ── 4. Remaining company-scoped rows ─────────────────────────────────
  await tx.execute(sql`delete from message_reactions where message_id in (select id from messages where company_id = ${companyId})`);
  await tx.execute(sql`delete from channel_message_reactions where channel_message_id in (select id from channel_messages where company_id = ${companyId})`);
  for (const t of ["calendar_events", "channel_messages", "messages", "invoices", "project_invites", "share_logs", "company_members"]) {
    await tx.execute(sql`delete from ${sql.identifier(t)} where company_id = ${companyId}`);
  }

  // ── 5. This company's user accounts — clean their footprints anywhere ─
  if (U.length) {
    // Rows that are purely about the user (any tenant): safe to delete.
    for (const t of [
      "notifications", "credential_reset_tokens", "channel_reads",
      "channel_message_reactions", "message_reactions", "pin_audit_log",
      "push_subscriptions", "pending_pushes", "portal_sessions",
      "document_distributions", "plant_item_distributions",
      "acknowledgment_audit_log", "portal_member_documents",
      "project_members", "company_members",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(t)} where user_id = any(${pgArr(U)}::text[])`);
    }
    await tx.execute(sql`delete from user_notes where user_id = any(${pgArr(U)}::text[]) or author_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`delete from person_certifications where created_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`delete from project_invites where invited_by_user_id = any(${pgArr(U)}::text[])`);
    // Nullable references in other tenants' content: detach, don't delete.
    await tx.execute(sql`update people set user_id = null where user_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update photos set assigned_to_user_id = null where assigned_to_user_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update photos set submitted_by = null where submitted_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update photos set archived_by = null where archived_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update photos set photo_removed_by = null where photo_removed_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update daily_reports set submitted_by = null where submitted_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update daily_reports set authored_by = null where authored_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update plant_items set last_updated_by = null where last_updated_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update plant_items set archived_by = null where archived_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update plant_items set portal_draft_updated_by = null where portal_draft_updated_by = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update insurance_records set assigned_to_user_id = null where assigned_to_user_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update portal_shares set shared_by_user_id = null where shared_by_user_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update share_logs set sent_by_user_id = null where sent_by_user_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update portal_member_documents set reviewed_by_user_id = null where reviewed_by_user_id = any(${pgArr(U)}::text[])`);
    await tx.execute(sql`update project_invites set accepted_user_id = null where accepted_user_id = any(${pgArr(U)}::text[])`);

    // Try to delete each account; if it still owns NON-nullable content in
    // another tenant (messages they sent, files they uploaded…), scrub it
    // instead so the email is freed without destroying that tenant's data.
    for (const uid of U) {
      try {
        await tx.execute(sql`savepoint del_user`);
        await tx.execute(sql`delete from users where id = ${uid}`);
        await tx.execute(sql`release savepoint del_user`);
      } catch {
        await tx.execute(sql`rollback to savepoint del_user`);
        const home = fallbackCompany.get(uid);
        const tombstone = `deleted-${uid}@removed.invalid`;
        if (home) {
          await tx.execute(sql`update users set email = ${tombstone}, password_hash = ${randomBytes(32).toString("hex")}, portal_only = true, company_id = ${home} where id = ${uid}`);
        } else {
          // No surviving membership to re-home to — keep their current
          // company_id valid by leaving the company row in place is not an
          // option (we're deleting it), so park them on the oldest company.
          await tx.execute(sql`update users set email = ${tombstone}, password_hash = ${randomBytes(32).toString("hex")}, portal_only = true, company_id = (select id from companies where id <> ${companyId} order by created_at asc limit 1) where id = ${uid}`);
        }
        scrubbed.push(uid);
      }
    }
  }

  // ── 6. Projects, subcontractors, company ─────────────────────────────
  if (P.length) await tx.execute(sql`delete from projects where id = any(${pgArr(P)}::text[])`);
  if (S.length) await tx.execute(sql`delete from subcontractors where id = any(${pgArr(S)}::text[])`);
  await tx.execute(sql`delete from companies where id = ${companyId}`);

  return { companyName, stripeCustomerId, scrubbedUsers: scrubbed.length };
}
