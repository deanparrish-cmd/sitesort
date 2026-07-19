import { randomUUID } from "crypto";
import path from "path";
import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { getBucket, objectKey } from "./gcs";

// Shared upload path for every portal-scoped WRITE endpoint (My Documents,
// Log an Issue, Plant & Materials attachments). Portal-scoped JWTs are
// hard-blocked from the generic /api/upload endpoint (see middlewares/auth.ts),
// so each portal write handler that accepts a file does its own multipart
// handling straight to object storage — this module is the one place that
// config lives, instead of being copy-pasted per endpoint.
//
// Self-uploads go straight to memory then object storage, 15MB cap (matches
// dashboard upload limits for member-scale files, not CAD drawings). Strict
// allowlist: documents/images only — no HTML/SVG/scripts, which could execute
// in a manager's browser when reviewed (stored-XSS vector).
const MEMBER_UPLOAD_EXTS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx"]);
const MEMBER_UPLOAD_MIMES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const memberUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!MEMBER_UPLOAD_EXTS.has(ext) || !MEMBER_UPLOAD_MIMES.has(file.mimetype)) {
      cb(new Error("Only PDF, image (PNG/JPG/WebP/HEIC), Word or Excel files can be uploaded."));
      return;
    }
    cb(null, true);
  },
});

// Wraps memberUpload.single(fieldName) so a multer error (bad type/too large)
// becomes a clean 400 JSON response instead of an uncaught throw. Reused by
// every portal write endpoint that accepts one file.
export function memberUploadSingle(fieldName: string) {
  return function (req: Request, res: Response, next: NextFunction): void {
    memberUpload.single(fieldName)(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: "upload_error", message: err.message ?? "Upload failed" });
        return;
      }
      next();
    });
  };
}

// Streams an already-validated multer file straight to object storage and
// returns the URL to store on the owning row. Original filename is kept only
// as GCS object metadata, never as the served path (avoids collisions/traversal).
export async function saveMemberUpload(file: Express.Multer.File, uploadedBy: string, companyId: string): Promise<{ fileUrl: string; fileSize: number }> {
  const ext = path.extname(file.originalname).toLowerCase();
  const filename = `${randomUUID()}${ext}`;
  await getBucket().file(objectKey(filename)).save(file.buffer, {
    contentType: file.mimetype,
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=300",
      metadata: { originalName: file.originalname, uploadedBy, companyId },
    },
  });
  return { fileUrl: `/api/uploads/${filename}`, fileSize: file.size };
}
