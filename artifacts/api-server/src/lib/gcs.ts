import { Storage, File, Bucket } from "@google-cloud/storage";
import { IS_DEPLOYED } from "./environment";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const gcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parsePrivateDir(): { bucket: string; prefix: string } {
  const raw = process.env.PRIVATE_OBJECT_DIR;
  if (!raw) throw new Error("PRIVATE_OBJECT_DIR is not set — object storage not provisioned");
  const trimmed = raw.replace(/^\/+/, "");
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucket: trimmed, prefix: "" };
  return { bucket: trimmed.slice(0, slash), prefix: trimmed.slice(slash + 1).replace(/\/$/, "") };
}

// Production's key for an upload.
function prodKey(filename: string): string {
  const { prefix } = parsePrivateDir();
  return prefix ? `${prefix}/uploads/${filename}` : `uploads/${filename}`;
}

// The workspace shares this bucket (and its credentials) with production. Outside
// the deployed app, new uploads go to their own folder, so production never
// serves a dev file and a dev write can never land on a production file.
function workspaceKey(filename: string): string {
  const { prefix } = parsePrivateDir();
  return prefix ? `${prefix}/workspace-uploads/${filename}` : `workspace-uploads/${filename}`;
}

export function getBucket() {
  const { bucket } = parsePrivateDir();
  return gcsClient.bucket(bucket);
}

// Where to write a new upload.
export function uploadFile(filename: string): File {
  return getBucket().file(IS_DEPLOYED ? prodKey(filename) : workspaceKey(filename));
}

// Where to read an upload from. The workspace reads its own folder first, then
// production's (its database holds copies of production rows), read-only.
export async function findUpload(filename: string): Promise<File> {
  if (IS_DEPLOYED) return getBucket().file(prodKey(filename));
  const own = getBucket().file(workspaceKey(filename));
  const [exists] = await own.exists();
  return exists ? own : getBucket().file(prodKey(filename));
}

// Production's copy of an upload, for deleting a file in the deployed app.
export function productionUpload(filename: string): File {
  return getBucket().file(prodKey(filename));
}

// Outside the deployed app, file deletion (and anything else that changes or
// removes an existing file, or writes outside the workspace folder) is refused
// by the storage client itself, whatever code calls it: tests, scripts, a
// one-off command. Soft-delete in the bucket is the only other safety net.
function refuse(what: string): never {
  throw new Error(`${what} is disabled outside the deployed app (shared production bucket)`);
}
function inWorkspaceFolder(file: File): boolean {
  return file.name.includes("/workspace-uploads/") || file.name.startsWith("workspace-uploads/");
}
if (!IS_DEPLOYED) {
  const fp = File.prototype as unknown as Record<string, unknown>;
  for (const m of ["delete", "move", "rename", "setMetadata", "setStorageClass", "makePrivate", "makePublic"]) {
    fp[m] = function () { refuse(`File ${m}`); };
  }
  const save = File.prototype.save;
  const createWriteStream = File.prototype.createWriteStream;
  fp.save = function (this: File, ...args: unknown[]) {
    if (!inWorkspaceFolder(this)) refuse("Writing outside the workspace folder");
    return (save as (...a: unknown[]) => unknown).apply(this, args);
  };
  fp.createWriteStream = function (this: File, ...args: unknown[]) {
    if (!inWorkspaceFolder(this)) refuse("Writing outside the workspace folder");
    return (createWriteStream as (...a: unknown[]) => unknown).apply(this, args);
  };
  const bp = Bucket.prototype as unknown as Record<string, unknown>;
  for (const m of ["deleteFiles", "delete", "setMetadata", "makePrivate", "makePublic", "upload"]) {
    bp[m] = function () { refuse(`Bucket ${m}`); };
  }
}
