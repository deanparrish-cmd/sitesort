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
    logger.info("ensureSchema: company_members table ready + backfilled");
  } catch (err) {
    // Don't crash the server — membership lookups fall back to the home company.
    logger.error({ err }, "ensureSchema failed (continuing with home-company fallback)");
  }
}
