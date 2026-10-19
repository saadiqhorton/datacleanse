import path from "node:path";

/** Server configuration from environment variables. Read lazily so tests can override. */
export const env = {
  get dataDir() {
    return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), ".data"));
  },
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  /** Used to sign download links and encrypt user API keys. Required in production. */
  get appSecret() {
    const s = process.env.APP_SECRET;
    if (s && s.length >= 32) return s;
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_SECRET must be set to at least 32 characters in production.");
    }
    return "dev-only-secret-do-not-use-in-production-0123456789";
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
