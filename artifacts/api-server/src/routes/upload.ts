import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { authenticate } from "../middlewares/auth";
import { getBucket, objectKey } from "../lib/gcs";

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
    ];
    // Validate by EXTENSION as well as MIME: browsers commonly send CAD files as
    // application/octet-stream, so the mimetype list alone would reject them.
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(dwg|dxf|dwf|rvt|ifc)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

router.post("/upload", authenticate, (req: Request, res: Response, next) => {
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

// File access is gated by the unguessable random UUID in the filename
// (capability-URL model, same as Dropbox/Drive share links). Browser <img> and
// <a> tags can't send Authorization headers, so requiring a Bearer token here
// would break avatars, project photos, and document downloads across the app.
// TODO post-launch: switch to short-lived signed GCS URLs minted by an
// authenticated /api/uploads/:filename/url endpoint, then update the frontend
// to resolve URLs through it.
router.get("/uploads/:filename", async (req: Request, res: Response) => {
  const { filename } = req.params;
  if (!filename || filename.includes("/") || filename.includes("..")) {
    res.status(400).json({ error: "invalid_filename" });
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
