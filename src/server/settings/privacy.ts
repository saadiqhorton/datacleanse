import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { SettingsError, firstIssue } from "./errors";

/** Allowed "keep files for" values, in hours. Matches the CHECK constraint on user_settings. */
export const RETENTION_HOURS = [1, 24, 168] as const;
export type RetentionHours = (typeof RETENTION_HOURS)[number];

export const CLEANING_MODES = ["rules_ai", "rules_only"] as const;
export type CleaningMode = (typeof CLEANING_MODES)[number];

export const RETENTION_LABELS: Record<RetentionHours, string> = {
  1: "1 hour",
  24: "24 hours",
  168: "7 days",
};

export const CLEANING_MODE_LABELS: Record<CleaningMode, string> = {
  rules_ai: "Rules + AI",
  rules_only: "Rules only",
};

export interface PrivacySettings {
  retentionHours: RetentionHours;
  defaultMode: CleaningMode;
}

const DEFAULTS: PrivacySettings = { retentionHours: 24, defaultMode: "rules_ai" };

const RETENTION_MESSAGE = "Choose 1 hour, 24 hours or 7 days.";

/** Form values arrive as strings; anything but 1, 24 or 168 is rejected. */
export const retentionSchema = z.coerce
  .number({ error: RETENTION_MESSAGE })
  .pipe(
    z.union([z.literal(1), z.literal(24), z.literal(168)], { error: RETENTION_MESSAGE }),
  );

export const cleaningModeSchema = z.enum(CLEANING_MODES, { error: "Choose Rules + AI or Rules only." });

export const privacyUpdateSchema = z
  .object({
    retentionHours: retentionSchema.optional(),
    defaultMode: cleaningModeSchema.optional(),
  })
  .refine((v) => v.retentionHours !== undefined || v.defaultMode !== undefined, {
    error: "Nothing to save.",
  });

/** Raw values as received (form strings or numbers). Validated by privacyUpdateSchema. */
export type PrivacyUpdate = { retentionHours?: unknown; defaultMode?: unknown };

/** Current privacy settings. Users without a settings row get the defaults. */
export function getPrivacySettings(userId: string): PrivacySettings {
  const row = db()
    .prepare("SELECT retention_hours, default_mode FROM user_settings WHERE user_id = ?")
    .get(userId) as { retention_hours: RetentionHours; default_mode: CleaningMode } | undefined;
  if (!row) return { ...DEFAULTS };
  return { retentionHours: row.retention_hours, defaultMode: row.default_mode };
}

/**
 * How long new uploads are kept, in hours. Upload code should read this when it sets files.expires_at.
 */
export function getRetentionHours(userId: string): RetentionHours {
  return getPrivacySettings(userId).retentionHours;
}

/**
 * Saves one or both privacy settings. Applies to files uploaded after the change; existing files keep
 * their expires_at. Writes one audit entry when a value actually changes.
 */
export function updatePrivacySettings(userId: string, raw: PrivacyUpdate): PrivacySettings {
  const parsed = privacyUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new SettingsError(firstIssue(parsed.error));

  const before = getPrivacySettings(userId);
  const next: PrivacySettings = {
    retentionHours: parsed.data.retentionHours ?? before.retentionHours,
    defaultMode: parsed.data.defaultMode ?? before.defaultMode,
  };
  if (next.retentionHours === before.retentionHours && next.defaultMode === before.defaultMode) return next;

  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO user_settings (user_id, retention_hours, default_mode, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         retention_hours = excluded.retention_hours,
         default_mode = excluded.default_mode,
         updated_at = excluded.updated_at`,
    )
    .run(userId, next.retentionHours, next.defaultMode, now);

  const changes: string[] = [];
  if (next.retentionHours !== before.retentionHours) {
    changes.push(`Keep files for ${RETENTION_LABELS[next.retentionHours]}`);
  }
  if (next.defaultMode !== before.defaultMode) {
    changes.push(`Default cleaning mode ${CLEANING_MODE_LABELS[next.defaultMode]}`);
  }
  audit("settings.updated", `${changes.join("; ")}.`, { actor: userId });
  return next;
}
