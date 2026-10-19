import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let generatedSecret: string | null = null;

/** Server configuration from environment variables. Read lazily so tests can override. */
export const env = {
  get dataDir() {
    return path.resolve(process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data"));
  },
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  /**
   * Signs download links and encrypts secrets at rest. Uses APP_SECRET when set (≥ 32 chars); otherwise a
   * random secret is generated once and kept in DATA_DIR/.app-secret (owner-only), so it survives restarts.
   */
  get appSecret() {
    const s = process.env.APP_SECRET;
    if (s) {
      if (s.length < 32) throw new Error("APP_SECRET must be at least 32 characters.");
      return s;
    }
    if (!generatedSecret) generatedSecret = loadOrCreateSecret(path.join(this.dataDir, ".app-secret"));
    return generatedSecret;
  },
  get maxUploadBytes() {
    return Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024;
  },
  get smtpUrl() {
    return process.env.SMTP_URL || "";
  },
  get mailFrom() {
    return process.env.MAIL_FROM || "DataCleanse <no-reply@localhost>";
  },
  /** Optional clamd for malware scanning, e.g. "127.0.0.1:3310". */
  get clamdAddress() {
    return process.env.CLAMD_ADDRESS || "";
  },
  get jobConcurrency() {
    return Math.max(1, Number(process.env.JOB_CONCURRENCY || 2));
  },
};

function loadOrCreateSecret(file: string) {
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // not created yet
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const secret = crypto.randomBytes(48).toString("base64url");
  try {
    // "wx" fails if another process created it first; then read theirs.
    fs.writeFileSync(file, secret + "\n", { mode: 0o600, flag: "wx" });
    return secret;
  } catch {
    return fs.readFileSync(file, "utf8").trim();
  }
}
