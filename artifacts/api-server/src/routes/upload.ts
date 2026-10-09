import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { authenticate } from "../middlewares/auth";
import { allow, INTERNAL_STAFF } from "../lib/authz";
import { getBucket, objectKey } from "../lib/gcs";
import { isRetiredUpload, shareableUploads, verifyUploadSignature } from "../lib/signed-uploads";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (CAD files can be large)
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.dwg", "image/vnd.dwg", "application/acad",
      "application/dxf", "image/vnd.dxf", "model/vnd.dwf", "drawing/x-dwf",
      "application/vnd.ms-project",
    ];
    // Validate by EXTENSION as well as MIME: browsers commonly send CAD files
    // (and MS Project schedules) as application/octet-stream, so the mimetype
    // list alone would reject them.
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(dwg|dxf|dwf|rvt|ifc|mpp)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

router.post("/upload", authenticate, allow(INTERNAL_STAFF), (req: Request, res: Response, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      // multer errors (file type, size limit) must be caught here — they bypass the route handler
      res.status(400).json({ error: "upload_error", message: err.message ?? "Upload failed" });
      return;
    }
    next();
  });
}, async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "validation_error", message: "No file provided" });
    return;
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    const key = objectKey(filename);
    const file = getBucket().file(key);

    await file.save(req.file.buffer, {
      contentType: req.file.mimetype,
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=300",
        metadata: {
          originalName: req.file.originalname,
          uploadedBy: req.user?.id ?? "",
          companyId: req.user?.companyId ?? "",
        },
      },
    });

    res.json({
      url: `/api/uploads/${filename}`,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (err) {
    req.log?.error({ err }, "object storage upload failed");
    res.status(500).json({ error: "upload_failed", message: err instanceof Error ? err.message : "Upload failed" });
  }
});

// Login-only by default: a file is served only with the short-lived signature
// the server adds to upload links in its JSON responses (lib/signed-uploads.ts),
// so whoever was allowed to see the record can open its file, and a leaked link
// stops working. Drawings, project documents and permits are still served from
// the bare link until per-share links replace them.
router.get("/uploads/:filename", async (req: Request, res: Response) => {
  const { filename } = req.params;
  if (!filename || filename.includes("/") || filename.includes("..")) {
    res.status(400).json({ error: "invalid_filename" });
    return;
  }
  if (!verifyUploadSignature(filename, req.query.exp, req.query.sig)) {
    let shareable = false;
    try {
      shareable = (await shareableUploads([filename])).has(filename);
    } catch (err) {
      req.log?.error({ err }, "shareable-upload check failed");
      res.status(503).json({ error: "unavailable", message: "This file can't be opened right now. Try again shortly." });
      return;
    }
    if (!shareable) {
      res.status(403).json({ error: "link_expired", message: "This link has expired or needs a login. Open it again from SiteSort." });
      return;
    }
  }

  try {
    if (await isRetiredUpload(filename)) {
      res.status(410).json({ error: "gone", message: "This file is no longer available." });
      return;
    }
  } catch (err) {
    // Fail closed: if we can't tell whether it's a retired file, don't serve it.
    req.log?.error({ err }, "retired-upload check failed");
    res.status(503).json({ error: "unavailable", message: "This file can't be opened right now. Try again shortly." });
    return;
  }

  try {
    const file = getBucket().file(objectKey(filename));
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const [metadata] = await file.getMetadata();

    // Never let stored active content (HTML/SVG/XML/JS) render inline on our
    // origin — that would be a stored-XSS vector. Serve those as downloads.
    const ct = (metadata.contentType ?? "").toLowerCase();
    const activeContent = /html|svg|xml|javascript|ecmascript/.test(ct);
    if (metadata.contentType && !activeContent) res.setHeader("Content-Type", metadata.contentType);
    if (activeContent) res.setHeader("Content-Type", "application/octet-stream");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const original = metadata.metadata?.originalName as string | undefined;
    const disposition = activeContent ? "attachment" : "inline";
    const safe = original ? original.replace(/"/g, "") : "";
    res.setHeader("Content-Disposition", safe ? `${disposition}; filename="${safe}"` : disposition);

    file.createReadStream()
      .on("error", err => {
        req.log?.error({ err }, "object storage stream error");
        if (!res.headersSent) res.status(500).json({ error: "stream_failed" });
        else res.destroy();
      })
      .pipe(res);
  } catch (err) {
    req.log?.error({ err }, "object storage serve failed");
    res.status(500).json({ error: "serve_failed" });
  }
});

export default router;
