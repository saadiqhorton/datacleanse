import { audit } from "../audit";
import { db } from "../db";
import { getUserById } from "../auth/users";
import { getUserAISettings } from "../ai/config";
import { SettingsError } from "./errors";
import { getPrivacySettings } from "./privacy";
import { getPasswordInfo } from "./security";

export const EXPORT_FORMAT = "datacleanse-export";
export const EXPORT_VERSION = 1;

/**
 * Everything the account holds, as plain JSON. Secrets are left out on purpose: no password hash,
 * API key, session ids or tokens. Only whether they are set is included.
 */
export interface AccountExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  account: {
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: string;
    passwordSet: boolean;
    passwordChangedAt: string | null;
  };
  settings: {
    retentionHours: number;
    defaultCleaningMode: string;
    aiMode: string;
    ownKey: { provider: string; model: string; baseURL: string | null; keySaved: boolean } | null;
  };
  ruleSets: {
    id: string;
    name: string;
    headerMatch: unknown;
    createdAt: string;
    updatedAt: string;
    rules: {
      columnPattern: string;
      action: string;
      params: unknown;
      onLowConfidence: string;
      enabled: boolean;
      position: number;
      description: string;
    }[];
  }[];
  files: {
    id: string;
    originalName: string;
    alias: string;
    sizeBytes: number;
    delimiter: string | null;
    encoding: string | null;
    rowCount: number | null;
    columnCount: number | null;
    status: string;
    mode: string;
    ruleSetId: string | null;
    aiStatus: string;
    rowsOut: number | null;
    createdAt: string;
    expiresAt: string;
    appliedAt: string | null;
    deletedAt: string | null;
  }[];
  changeReports: {
    fileId: string;
    originalName: string;
    total: number;
    bySource: Record<string, number>;
    byDecision: Record<string, number>;
  }[];
  auditEntries: { at: string; action: string; detail: string; fileId: string | null }[];
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function parseJson(text: string | null | undefined, fallback: unknown): unknown {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Builds the export for one user. Reads only rows that belong to userId. */
export function buildAccountExport(userId: string, now = Date.now()): AccountExport {
  const user = getUserById(userId);
  if (!user) throw new SettingsError("Account not found.");
  const conn = db();
  const privacy = getPrivacySettings(userId);
  const ai = getUserAISettings(userId);
  const password = getPasswordInfo(userId);

  const ruleSetRows = conn
    .prepare("SELECT id, name, header_match_json, created_at, updated_at FROM rule_sets WHERE user_id = ? ORDER BY created_at")
    .all(userId) as {
    id: string;
    name: string;
    header_match_json: string;
    created_at: number;
    updated_at: number;
  }[];
  const ruleRows = conn
    .prepare(
      `SELECT r.rule_set_id, r.column_pattern, r.action, r.params_json, r.on_low_confidence, r.enabled, r.position, r.description
       FROM rules r JOIN rule_sets s ON s.id = r.rule_set_id
       WHERE s.user_id = ? ORDER BY r.rule_set_id, r.position`,
    )
    .all(userId) as {
    rule_set_id: string;
    column_pattern: string;
    action: string;
    params_json: string;
    on_low_confidence: string;
    enabled: number;
    position: number;
    description: string;
  }[];

  const fileRows = conn
    .prepare(
      `SELECT id, original_name, alias, size_bytes, delimiter, encoding, row_count, column_count, status, mode,
              rule_set_id, ai_status, rows_out, created_at, expires_at, applied_at, deleted_at
       FROM files WHERE user_id = ? ORDER BY created_at`,
    )
    .all(userId) as {
    id: string;
    original_name: string;
    alias: string;
    size_bytes: number;
    delimiter: string | null;
    encoding: string | null;
    row_count: number | null;
    column_count: number | null;
    status: string;
    mode: string;
    rule_set_id: string | null;
    ai_status: string;
    rows_out: number | null;
    created_at: number;
    expires_at: number;
    applied_at: number | null;
    deleted_at: number | null;
  }[];

  const changeRows = conn
    .prepare(
      `SELECT f.id AS file_id, f.original_name, c.source, c.decision, COUNT(*) AS n
       FROM changes c JOIN files f ON f.id = c.file_id
       WHERE f.user_id = ? GROUP BY f.id, c.source, c.decision ORDER BY f.created_at`,
    )
    .all(userId) as { file_id: string; original_name: string; source: string; decision: string; n: number }[];

  const auditRows = conn
    .prepare("SELECT at, action, detail, file_id FROM audit_log WHERE actor_user_id = ? ORDER BY at, id")
    .all(userId) as { at: number; action: string; detail: string; file_id: string | null }[];

  const rulesBySet = new Map<string, AccountExport["ruleSets"][number]["rules"]>();
  for (const r of ruleRows) {
    const list = rulesBySet.get(r.rule_set_id) ?? [];
    list.push({
      columnPattern: r.column_pattern,
      action: r.action,
      params: parseJson(r.params_json, {}),
      onLowConfidence: r.on_low_confidence,
      enabled: r.enabled === 1,
      position: r.position,
      description: r.description,
    });
    rulesBySet.set(r.rule_set_id, list);
  }

  const reports = new Map<string, AccountExport["changeReports"][number]>();
  for (const row of changeRows) {
    const report =
      reports.get(row.file_id) ??
      { fileId: row.file_id, originalName: row.original_name, total: 0, bySource: {}, byDecision: {} };
    report.total += row.n;
    report.bySource[row.source] = (report.bySource[row.source] ?? 0) + row.n;
    report.byDecision[row.decision] = (report.byDecision[row.decision] ?? 0) + row.n;
    reports.set(row.file_id, report);
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: new Date(user.createdAt).toISOString(),
      passwordSet: password !== null,
      passwordChangedAt: iso(password?.changedAt ?? null),
    },
    settings: {
      retentionHours: privacy.retentionHours,
      defaultCleaningMode: privacy.defaultMode,
      aiMode: ai.aiMode,
      ownKey: ai.ownKey
        ? {
            provider: ai.ownKey.provider,
            model: ai.ownKey.model,
            baseURL: ai.ownKey.baseURL ?? null,
            keySaved: ai.ownKey.hasKey,
          }
        : null,
    },
    ruleSets: ruleSetRows.map((s) => ({
      id: s.id,
      name: s.name,
      headerMatch: parseJson(s.header_match_json, []),
      createdAt: new Date(s.created_at).toISOString(),
      updatedAt: new Date(s.updated_at).toISOString(),
      rules: rulesBySet.get(s.id) ?? [],
    })),
    files: fileRows.map((f) => ({
      id: f.id,
      originalName: f.original_name,
      alias: f.alias,
      sizeBytes: f.size_bytes,
      delimiter: f.delimiter,
      encoding: f.encoding,
      rowCount: f.row_count,
      columnCount: f.column_count,
      status: f.status,
      mode: f.mode,
      ruleSetId: f.rule_set_id,
      aiStatus: f.ai_status,
      rowsOut: f.rows_out,
      createdAt: new Date(f.created_at).toISOString(),
      expiresAt: new Date(f.expires_at).toISOString(),
      appliedAt: iso(f.applied_at),
      deletedAt: iso(f.deleted_at),
    })),
    changeReports: [...reports.values()],
    auditEntries: auditRows.map((a) => ({
      at: new Date(a.at).toISOString(),
      action: a.action,
      detail: a.detail,
      fileId: a.file_id,
    })),
  };
}

/** Builds the export and records it in the audit log. */
export function exportAccount(userId: string, now = Date.now()): AccountExport {
  const payload = buildAccountExport(userId, now);
  audit("account.exported", "Exported account data.", { actor: userId });
  return payload;
}
