// Walks the API's Express router and classifies every route that requires a
// login (has `authenticate` in its chain) as declared (has allow(...)) or not.
import router from "../src/routes";
import { authenticate } from "../src/middlewares/auth";
import { isAuthzMiddleware } from "../src/lib/authz";

export type RouteInfo = { key: string; authenticated: boolean; declared: boolean };

export function listRoutes(): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const handlers = (layer.route.stack ?? []).map((l: any) => l.handle);
        const methods = Object.keys(layer.route.methods ?? {}).filter(m => layer.route.methods[m]).map(m => m.toUpperCase());
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const m of methods) for (const p of paths) {
          out.push({ key: `${m} ${p}`, authenticated: handlers.includes(authenticate), declared: handlers.some(isAuthzMiddleware) });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((router as any).stack);
  return out;
}
