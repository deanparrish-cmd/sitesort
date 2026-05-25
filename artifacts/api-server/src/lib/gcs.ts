import { Storage } from "@google-cloud/storage";

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

export function objectKey(filename: string): string {
  const { prefix } = parsePrivateDir();
  return prefix ? `${prefix}/uploads/${filename}` : `uploads/${filename}`;
}

export function getBucket() {
  const { bucket } = parsePrivateDir();
  return gcsClient.bucket(bucket);
}
