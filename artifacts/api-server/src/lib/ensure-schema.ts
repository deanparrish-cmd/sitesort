import { pool } from "@workspace/db";
import { logger } from "./logger";

// Idempotent boot migration. The PRODUCTION database is separate from the dev
// workspace and `drizzle push` is NOT part of the deploy, so a newly-deployed
// build could query company_members before that table exists. Creating it (and
// backfilling one membership per existing user) on every boot guarantees the
// membership-aware login path always has its table. Safe to run repeatedly.
export async function ensureSchema(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_members (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'site_worker',
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT company_members_user_company_unique UNIQUE (user_id, company_id)
      )
    `);
    await pool.query(`
      INSERT INTO company_members (id, user_id, company_id, role)
      SELECT gen_random_uuid()::text, id, company_id, role FROM users
      ON CONFLICT (user_id, company_id) DO NOTHING
    `);
    // Tracks which expiry-reminder emails (30/21/14/7/1 days + expired daily) have
    // been sent, so the daily job fires each milestone exactly once. New table →
    // must exist in prod before the reminder job runs, hence created here too.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expiry_reminder_logs (
        id text PRIMARY KEY,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        milestone text NOT NULL,
        sent_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT expiry_reminder_logs_entity_milestone_uq UNIQUE (entity_type, entity_id, milestone)
      )
    `);
    // Dedup ledger for Stripe webhook deliveries — the webhook claims each event
    // id here (ON CONFLICT DO NOTHING) and skips duplicates/retries so a redelivered
    // event can't create duplicate subscriptions/charges. New table → must exist in
    // prod before the webhook runs, hence created here too.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id text PRIMARY KEY,
        type text NOT NULL,
        received_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Optional photo attached to a daily-note "site update" (B1 fix). New column →
    // must exist in prod before the daily-notes insert references it.
    await pool.query(`ALTER TABLE daily_notes ADD COLUMN IF NOT EXISTS photo_url text`);
    // Assignment & accountability (F1) — assignee + due date on site issues (photos).
    await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS assigned_to_user_id text`);
    await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS due_date date`);
    // F1 Phase 2 — permits reuse responsible_user_id as the assignee; add the
    // (optional) action deadline. Overdue is derived (due_date < today && not archived).
    await pool.query(`ALTER TABLE permits ADD COLUMN IF NOT EXISTS due_date date`);
    // F1 Phase 3 — insurance certs get an explicit assignee + (optional) action
    // deadline (no pre-existing responsible field). Overdue is derived likewise.
    await pool.query(`ALTER TABLE insurance_records ADD COLUMN IF NOT EXISTS assigned_to_user_id text`);
    await pool.query(`ALTER TABLE insurance_records ADD COLUMN IF NOT EXISTS due_date date`);
    // Email verification — registration now sends a verification link and only
    // marks the account verified once it's clicked, so the register handler writes
    // these columns. email_verified already exists in prod (the login gate reads
    // it, so the ALTER no-ops and existing verified users are untouched); the
    // token/expiry columns may not, hence add them here before register uses them.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token text`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expiry timestamp`);
    logger.info("ensureSchema: company_members + expiry_reminder_logs + stripe_webhook_events + daily_notes.photo_url + photos/permits/insurance assignment cols + users email-verification cols ready");
  } catch (err) {
    // Don't crash the server — membership lookups fall back to the home company.
    logger.error({ err }, "ensureSchema failed (continuing with home-company fallback)");
  }
}
