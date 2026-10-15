import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

// Uploaded files are login-only by default (Part A of the file-link work):
// served only with a short-lived signature, which the server adds to every
// upload link in a JSON response (signUploadsInResponses below). Whoever is
// allowed to receive the response is allowed to open the file; a link that
// leaks (copied, forwarded, left in a browser history) stops working.
//
// Drawings, project documents and permits are no exception (Part B): they go
// outside SiteSort only through per-share links (lib/share-links.ts).
//
// Check-in photos (workers' faces, "checkin-<uuid>.<ext>") get the shortest
// window, 1 to 2 hours; other files last a working day, 12 to 24 hours, so a
// page left open all day still opens its files.
const CHECKIN = /^checkin-[^/?#]+$/;
const URL_RE = /^\/(?:api\/)?uploads\/([^/?#]+)(?:\?[^#]*)?$/;
const CHECKIN_WINDOW_S = 60 * 60;
const FILE_WINDOW_S = 12 * 60 * 60;

function key(): Buffer {
  return createHmac("sha256", process.env.JWT_SECRET as string).update("signed-upload-v1").digest();
}
function mac(filename: string, exp: number): string {
  return createHmac("sha256", key()).update(`${filename}:${exp}`).digest("base64url");
}

export function isCheckinUpload(filename: string): boolean {
  return CHECKIN.test(filename);
}

// The filename inside an upload link ("/api/uploads/x.pdf", legacy
// "/uploads/x.pdf", with or without a signature), or null.
export function uploadFilename(url: string): string | null {
  return url.match(URL_RE)?.[1] ?? null;
}

// Expiry is rounded up to the next window boundary plus one window, so the URL
// is stable within a window (no re-download on every refetch) and valid for 1
// to 2 windows after it was handed out.
export function signUploadUrl<T extends string | null | undefined>(url: T, now: number = Date.now()): T {
  if (typeof url !== "string") return url;
  const name = uploadFilename(url);
  if (!name) return url;
  const w = isCheckinUpload(name) ? CHECKIN_WINDOW_S : FILE_WINDOW_S;
  const exp = (Math.ceil(now / 1000 / w) + 1) * w;
  return `/api/uploads/${name}?exp=${exp}&sig=${mac(name, exp)}` as T;
}

export function verifyUploadSignature(filename: string, exp: unknown, sig: unknown, now: number = Date.now()): boolean {
  if (typeof exp !== "string" || typeof sig !== "string" || !/^\d+$/.test(exp)) return false;
  const e = Number(exp);
  if (e * 1000 < now) return false;
  const expected = Buffer.from(mac(filename, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function mapUploadStrings(value: unknown, fn: (s: string, name: string) => string, depth = 0): unknown {
  if (depth > 40 || value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length < 2048) {
      const name = uploadFilename(value);
      if (name) return fn(value, name);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(v => mapUploadStrings(v, fn, depth + 1));
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = mapUploadStrings(v, fn, depth + 1);
  return out;
}

// Signs every upload link in a JSON response.
export function signUploadsIn<T>(body: T, now: number = Date.now()): T {
  return mapUploadStrings(body, s => signUploadUrl(s, now)) as T;
}

// Signed links come back in request bodies when a screen saves what it was
// shown (an uploaded certificate, an edited record). Store the bare link only.
export function stripUploadSignatures<T>(body: T): T {
  return mapUploadStrings(body, (_s, name) => `/api/uploads/${name}`) as T;
}

export function signUploadsInResponses(req: Request, res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) req.body = stripUploadSignatures(req.body);
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(signUploadsIn(body))) as Response["json"];
  next();
}

// Files that belong to a removed feature are never served again. The invoices
// feature was removed (bebe715) but its table and uploaded attachments remain
// in the database and storage, with no screen to see or manage them. Their
// links answer 410 instead of serving financial documents on a permanent URL.
// (The invoices table is no longer in the Drizzle schema, hence raw SQL.)
// If the table doesn't exist (a fresh database), nothing is retired; checked once.
let invoicesTableExists: Promise<boolean> | null = null;
export async function isRetiredUpload(filename: string): Promise<boolean> {
  invoicesTableExists ??= db.execute(sql`SELECT to_regclass('public.invoices') IS NOT NULL AS present`)
    .then(r => Boolean((r.rows[0] as { present?: boolean } | undefined)?.present))
    .catch(err => { invoicesTableExists = null; throw err; });
  if (!(await invoicesTableExists)) return false;
  try {
    const rows = await db.execute(sql`
      SELECT 1 FROM invoices
      WHERE attachment_url IN (${"/api/uploads/" + filename}, ${"/uploads/" + filename})
      LIMIT 1`);
    return rows.rows.length > 0;
  } catch (err) {
    // The table was dropped after we checked (lib/invoice-removal.ts, possibly
    // by another instance): nothing is retired any more, and the files are gone.
    if ((err as { code?: string })?.code === "42P01" || (err as { cause?: { code?: string } })?.cause?.code === "42P01") {
      invoicesTableExists = Promise.resolve(false);
      return false;
    }
    throw err;
  }
}
