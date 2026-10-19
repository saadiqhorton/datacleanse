import { db } from "./db";

/** Append to the audit log. actor null = system (retention, job runner). */
export function audit(action: string, detail: string, opts: { actor?: string | null; fileId?: string | null } = {}) {
  db()
    .prepare("INSERT INTO audit_log (at, actor_user_id, file_id, action, detail) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), opts.actor ?? null, opts.fileId ?? null, action, detail);
}
