import crypto from "node:crypto";

/** Prefixed random id, e.g. newId("file") -> "file_3k9x2m7q1p0z". */
export function newId(prefix: string, bytes = 9) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url").toLowerCase().replace(/[-_]/g, "x")}`;
}

/** Opaque URL-safe secret token (cookies, emailed links). Store only sha256(token). */
export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
