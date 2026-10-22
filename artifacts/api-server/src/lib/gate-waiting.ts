import { pool } from "@workspace/db";

// Who is waiting at the gate, for one login (2026-10-22). Counts what the
// portal Site Register lists under "Waiting at the gate" (a pending hold:
// routes/qr.ts checkinState), on every project where this login runs the
// gate: the project's site manager, or a member with PM cover (the same rule
// as registerHolderIds). Drives the app-icon badge and the in-app counts, so
// the badge, the Home tile and the register always agree.
export type GateWaiting = {
  holder: boolean; // runs the gate on at least one project
  total: number;
  projects: { projectId: string; name: string; count: number }[];
};

export async function gateWaitingFor(userId: string): Promise<GateWaiting> {
  const { rows } = await pool.query(
    `SELECT p.id, p.name,
            (SELECT count(*)::int FROM site_checkins c
              WHERE c.project_id = p.id AND c.hold_status = 'pending'
                AND (c.checked_in_at > now() - interval '48 hours' OR c.checked_out_at IS NULL)) AS n
       FROM projects p
      WHERE EXISTS (SELECT 1 FROM project_members m
                     WHERE m.project_id = p.id AND m.user_id = $1
                       AND (m.is_project_manager OR p.site_manager_id = $1))`,
    [userId],
  );
  const projects = rows.map((r: { id: string; name: string; n: number }) => ({ projectId: r.id, name: r.name, count: r.n }));
  return { holder: projects.length > 0, total: projects.reduce((s, p) => s + p.count, 0), projects: projects.filter(p => p.count > 0) };
}
