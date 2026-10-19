import { db } from "../db";
import { escapeLike, paged, resolvePage, type Paged } from "./paging";

export const AUDIT_PAGE_SIZE = 25;

export interface AuditEntry {
  id: number;
  at: number;
  action: string;
  detail: string;
  /** Null for system entries (retention, job runner) and for deleted accounts. */
  actorEmail: string | null;
}

/**
 * Audit entries newest first. `query` matches action, detail or actor email (case-insensitive,
 * literal). `prefix` keeps actions that start with it, e.g. "auth." or "admin.".
 */
export function listAuditEntries(
  opts: { query?: string; prefix?: string; page?: number; pageSize?: number } = {},
): Paged<AuditEntry> {
  const conn = db();
  const pageSize = opts.pageSize ?? AUDIT_PAGE_SIZE;
  const clauses: string[] = [];
  const args: string[] = [];

  const query = (opts.query ?? "").trim().slice(0, 200);
  if (query) {
    const like = `%${escapeLike(query)}%`;
    clauses.push("(a.action LIKE ? ESCAPE '\\' OR a.detail LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const prefix = (opts.prefix ?? "").trim().slice(0, 100);
  if (prefix) {
    clauses.push("a.action LIKE ? ESCAPE '\\'");
    args.push(`${escapeLike(prefix)}%`);
  }

  const from = `FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
                ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`;
  const { n: total } = conn.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args) as { n: number };
  const { page, offset } = resolvePage(opts.page ?? 1, total, pageSize);
  const rows = conn
    .prepare(
      `SELECT a.id, a.at, a.action, a.detail, u.email AS actor_email ${from}
       ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, offset) as {
    id: number;
    at: number;
    action: string;
    detail: string;
    actor_email: string | null;
  }[];

  return paged(
    rows.map((row) => ({
      id: row.id,
      at: row.at,
      action: row.action,
      detail: row.detail,
      actorEmail: row.actor_email,
    })),
    total,
    page,
    pageSize,
  );
}
