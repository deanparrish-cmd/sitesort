import { createHmac, timingSafeEqual } from "crypto";

// Check-in photos are workers' faces. Unlike other uploads (capability URLs,
// see routes/upload.ts) they are served only with a short-lived signature, so
// a URL that leaks (copied, forwarded, left in a browser history) stops
// working within a couple of hours. Every check-in photo has always been
// stored as "checkin-<uuid>.<ext>", which is how we recognise them.
const PROTECTED = /^checkin-[^/?#]+$/;
const URL_RE = /^\/(?:api\/)?uploads\/(checkin-[^/?#]+)(?:\?.*)?$/;
const WINDOW_S = 60 * 60;

function key(): Buffer {
  return createHmac("sha256", process.env.JWT_SECRET as string).update("signed-upload-v1").digest();
}
function mac(filename: string, exp: number): string {
  return createHmac("sha256", key()).update(`${filename}:${exp}`).digest("base64url");
}

export function isProtectedUpload(filename: string): boolean {
  return PROTECTED.test(filename);
}

// Expiry is rounded up to the next hour boundary plus one hour, so the URL is
// stable within an hour (no image re-download on every refetch) and valid for
// 1 to 2 hours after it was handed out.
export function signUploadUrl<T extends string | null | undefined>(url: T, now: number = Date.now()): T {
  if (typeof url !== "string") return url;
  const m = url.match(URL_RE);
  if (!m) return url;
  const exp = (Math.ceil(now / 1000 / WINDOW_S) + 1) * WINDOW_S;
  return `/api/uploads/${m[1]}?exp=${exp}&sig=${mac(m[1], exp)}` as T;
}

export function verifyUploadSignature(filename: string, exp: unknown, sig: unknown, now: number = Date.now()): boolean {
  if (typeof exp !== "string" || typeof sig !== "string" || !/^\d+$/.test(exp)) return false;
  const e = Number(exp);
  if (e * 1000 < now) return false;
  const expected = Buffer.from(mac(filename, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
