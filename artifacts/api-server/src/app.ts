import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../../sitesort/dist/public");

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Stripe webhook needs the raw body for signature verification — must come before express.json()
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Unmatched /api/* routes must return JSON 404 — NOT fall through to the SPA
// catch-all below (which would serve index.html with a 200, masking real 404s
// and making a missing endpoint look like a broken login).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found", message: "API route not found" });
});

// Serve the React frontend for all non-API routes (SPA catch-all)
app.use(express.static(frontendDist));
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Global error handler (must be last, 4 args). Express 5 forwards both sync
// throws and rejected async handlers here, so a route bug returns a logged JSON
// 500 instead of a hung/crashed request. Without this, unhandled route errors
// surfaced inconsistently and were hard to trace.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err }, "Unhandled error in request");
  if (res.headersSent) return;
  res.status(500).json({ error: "server_error", message: "Something went wrong" });
});

export default app;
