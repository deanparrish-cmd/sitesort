import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { probeDb } from "@workspace/db";
import { logger } from "../lib/logger";
import { environmentSummary } from "../lib/environment";

const router: IRouter = Router();

// Liveness — process is up and serving. No dependencies checked.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness — process is up AND the database is reachable. Returns 200 when the
// DB responds, 503 when it does not, so an uptime monitor can tell a real outage
// from a healthy process. This is a plain JSON endpoint (distinct from the SPA
// fallback), so a 200 here proves the API — not just the frontend — is live.
router.get("/health", async (_req, res) => {
  const probe = await probeDb();
  // The real error goes to the logs (it can name the database host). The
  // response carries only the kind and Postgres/Node error code.
  if (!probe.ok) logger.error({ dbFailure: probe.failure }, "health: database check failed");
  res.status(probe.ok ? 200 : 503).json({
    status: probe.ok ? "ok" : "degraded",
    db: probe.ok ? "up" : "down",
    ...(probe.ok ? {} : { dbError: { kind: probe.failure.kind, code: probe.failure.code } }),
    uptime: Math.round(process.uptime()),
    // Which outward-facing features are on here (never any secret values).
    environment: environmentSummary(),
  });
});

export default router;
