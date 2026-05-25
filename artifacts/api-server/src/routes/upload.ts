import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { authenticate } from "../middlewares/auth";
import { getBucket, objectKey } from "../lib/gcs";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.dwg", "image/vnd.dwg", "application/acad",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(dwg|dxf|rvt|ifc)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

router.post("/upload", authenticate, upload.single("file"), async (req: Request, res: Response) => {
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

    if (metadata.contentType) res.setHeader("Content-Type", metadata.contentType);
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    res.setHeader("Cache-Control", "private, max-age=300");

    const original = metadata.metadata?.originalName as string | undefined;
    if (original) {
      const safe = original.replace(/"/g, "");
      res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
    }

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
