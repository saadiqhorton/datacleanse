import crypto from "node:crypto";
import { env } from "./env";

function key(purpose: string) {
  return crypto.createHash("sha256").update(`${purpose}:${env.appSecret}`).digest();
}

/** AES-256-GCM for secrets at rest (TOTP secrets, user API keys). */
export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key("enc"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string) {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key("enc"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** HMAC-signed, expiring value, e.g. download links: sign("file_x:cleaned", 15 * 60_000). */
export function sign(payload: string, ttlMs: number) {
  const exp = Date.now() + ttlMs;
  const mac = crypto.createHmac("sha256", key("sign")).update(`${payload}.${exp}`).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${exp}.${mac}`;
}

/** Returns the payload, or null if tampered or expired. */
export function verify(token: string): string | null {
  const [p, expStr, mac] = token.split(".");
  if (!p || !expStr || !mac) return null;
  const payload = Buffer.from(p, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", key("sign")).update(`${payload}.${expStr}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > Number(expStr)) return null;
  return payload;
}
