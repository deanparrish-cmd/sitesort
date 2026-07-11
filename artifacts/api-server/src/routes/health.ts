import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkDbConnection } from "@workspace/db";

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
  const dbUp = await checkDbConnection();
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? "ok" : "degraded",
    db: dbUp ? "up" : "down",
    uptime: Math.round(process.uptime()),
  });
});

export default router;
