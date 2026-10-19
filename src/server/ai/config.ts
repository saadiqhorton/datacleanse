/**
 * AI settings at two levels:
 *
 *  - Instance: the provider the whole deployment uses. Environment variables (see lib/ai/config.ts)
 *    are the defaults; rows in app_config ("ai.provider", "ai.model", "ai.base_url", "ai.api_key")
 *    set by an admin override them.
 *  - User: each user's ai_mode. "instance" uses the instance provider, "own_key" uses the user's own
 *    Anthropic or OpenAI-compatible key, "off" uses rules only.
 *
 * API keys are encrypted with APP_SECRET (crypto.ts). Only getInstanceAIConfig() and getUserAIConfig()
 * return a decrypted key, and they are for building providers. Everything meant for display goes
 * through describeInstanceAI() or getUserAISettings(), which return hasKey instead.
 */
import { DEFAULT_BASE_URLS, DEFAULT_MODELS, isLocal, readAIConfig, type AIConfig } from "../../lib/ai/config";
import { audit } from "../audit";
import { decrypt, encrypt } from "../crypto";
import { db } from "../db";

export const INSTANCE_PROVIDERS = ["anthropic", "openai", "local", "off"] as const;
export type InstanceProvider = (typeof INSTANCE_PROVIDERS)[number];

export const AI_MODES = ["instance", "own_key", "off"] as const;
export type AIMode = (typeof AI_MODES)[number];

export const OWN_KEY_PROVIDERS = ["anthropic", "openai"] as const;
export type OwnKeyProvider = (typeof OWN_KEY_PROVIDERS)[number];

/** Validation failure with a message that is safe to show to the person who made the change. */
export class AISettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AISettingsError";
  }
}

const MAX_MODEL_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_KEY_LENGTH = 500;

const KEYS = {
  provider: "ai.provider",
  model: "ai.model",
  baseURL: "ai.base_url",
  apiKey: "ai.api_key", // encrypted
} as const;

// ---------------------------------------------------------------------------
// Instance level
// ---------------------------------------------------------------------------

export interface InstanceAIDescription {
  provider: InstanceProvider;
  model: string;
  baseURL?: string;
  /** Whether data sent to the model stays on this machine. */
  local: boolean;
  /** Whether a key is configured (admin-set, or from the environment). The key itself is never returned. */
  hasKey: boolean;
}

export interface InstanceAIInput {
  provider: InstanceProvider;
  /** Blank or missing falls back to the provider's default model. */
  model?: string;
  /** Missing or blank clears the custom base URL, so the provider default applies. */
  baseURL?: string;
  /** undefined keeps the stored key, "" clears it, anything else replaces it. */
  apiKey?: string;
}

/**
 * The effective instance configuration: environment defaults overridden by app_config rows.
 * Pass `env` in tests; it defaults to process.env.
 */
export function getInstanceAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const sources = instanceSources(env);
  if (sources.provider === "off") return { provider: "off", model: "" };
  const apiKey = sources.sealedKey !== undefined ? decrypt(sources.sealedKey) : sources.envKey;
  return {
    provider: sources.provider,
    model: sources.model,
    ...(sources.baseURL ? { baseURL: sources.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Safe to show on the admin page: no key material, only whether one is set. */
export function describeInstanceAI(env: NodeJS.ProcessEnv = process.env): InstanceAIDescription {
  const sources = instanceSources(env);
  const hasKey =
    sources.sealedKey !== undefined ||
    Boolean(sources.envKey) ||
    (sources.provider === "anthropic" && Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN));
  const config = shapeOf(sources);
  return {
    provider: sources.provider,
    model: sources.model,
    ...(sources.baseURL ? { baseURL: sources.baseURL } : {}),
    local: isLocal(config),
    hasKey,
  };
}

/**
 * Stores the instance provider. The whole provider state is replaced: a missing baseURL clears the stored
 * one, so send the current value back when only the model changes. apiKey follows the rules on InstanceAIInput.
 * Writes an admin.ai_provider_changed audit entry. Returns the new description.
 */
export function setInstanceAIConfig(input: InstanceAIInput, actorId: string | null): InstanceAIDescription {
  if (!(INSTANCE_PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new AISettingsError("Choose a provider: Anthropic, OpenAI-compatible, local model or off.");
  }
  const provider = input.provider;
  const model = provider === "off" ? "" : cleanModel(input.model) || DEFAULT_MODELS[provider];
  const baseURL = normalizeBaseURL(input.baseURL);
  const apiKey = input.apiKey === undefined ? undefined : input.apiKey.trim();
  if (apiKey !== undefined && apiKey.length > MAX_KEY_LENGTH) {
    throw new AISettingsError("The API key is too long.");
  }

  const now = Date.now();
  db().transaction(() => {
    upsertAppConfig(KEYS.provider, provider, now, actorId);
    upsertAppConfig(KEYS.model, model, now, actorId);
    if (baseURL) upsertAppConfig(KEYS.baseURL, baseURL, now, actorId);
    else deleteAppConfig(KEYS.baseURL);
    if (apiKey === "") deleteAppConfig(KEYS.apiKey);
    else if (apiKey !== undefined) upsertAppConfig(KEYS.apiKey, encrypt(apiKey), now, actorId);
  })();

  const keyNote = apiKey === undefined ? "" : apiKey === "" ? ", API key cleared" : ", API key updated";
  audit("admin.ai_provider_changed", `${describeChange(provider, model, baseURL)}${keyNote}`, { actor: actorId });
  return describeInstanceAI();
}

interface InstanceSources {
  provider: InstanceProvider;
  model: string;
  baseURL?: string;
  /** Encrypted key from app_config, if an admin set one. */
  sealedKey?: string;
  /** Key from the environment, used only when the provider has not been overridden. */
  envKey?: string;
}

function instanceSources(env: NodeJS.ProcessEnv): InstanceSources {
  const base = readAIConfig(env);
  const stored = readAppConfigRows();

  const storedProvider = stored.get(KEYS.provider);
  const provider = storedProvider !== undefined ? parseStoredProvider(storedProvider) : base.provider;
  const sameProvider = provider === base.provider;

  if (provider === "off") return { provider, model: "" };

  const model = stored.get(KEYS.model) || (sameProvider ? base.model : DEFAULT_MODELS[provider]);

  const storedBase = stored.get(KEYS.baseURL);
  const defaultBase = provider === "openai" || provider === "local" ? DEFAULT_BASE_URLS[provider] : undefined;
  const baseURL = storedBase ? normalizeBaseURL(storedBase) : sameProvider ? base.baseURL : defaultBase;

  const sealedKey = stored.get(KEYS.apiKey) || undefined;
  const envKey = sameProvider ? base.apiKey : undefined;

  return {
    provider,
    model,
    ...(baseURL ? { baseURL } : {}),
    ...(sealedKey ? { sealedKey } : {}),
    ...(envKey ? { envKey } : {}),
  };
}

/** Builds the AIConfig shape from sources, without decrypting, for the local flag only. */
function shapeOf(sources: InstanceSources): AIConfig {
  return sources.provider === "off"
    ? { provider: "off", model: "" }
    : { provider: sources.provider, model: sources.model, ...(sources.baseURL ? { baseURL: sources.baseURL } : {}) };
}

function readAppConfigRows() {
  const rows = db()
    .prepare("SELECT key, value FROM app_config WHERE key IN (?, ?, ?, ?)")
    .all(KEYS.provider, KEYS.model, KEYS.baseURL, KEYS.apiKey) as { key: string; value: string }[];
  return new Map(rows.map((r) => [r.key, r.value]));
}

function parseStoredProvider(value: string): InstanceProvider {
  if ((INSTANCE_PROVIDERS as readonly string[]).includes(value)) return value as InstanceProvider;
  throw new Error(`app_config ${KEYS.provider} must be one of ${INSTANCE_PROVIDERS.join(", ")}`);
}

function upsertAppConfig(key: string, value: string, now: number, actorId: string | null) {
  db()
    .prepare(
      `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(key, value, now, actorId);
}

function deleteAppConfig(key: string) {
  db().prepare("DELETE FROM app_config WHERE key = ?").run(key);
}

function describeChange(provider: InstanceProvider, model: string, baseURL?: string) {
  const host = baseURL ? ` at ${new URL(baseURL).host}` : "";
  switch (provider) {
    case "off":
      return "Admin changed AI provider to off";
    case "local":
      return `Admin changed AI provider to local model (${model})${host}`;
    case "anthropic":
      return `Admin changed AI provider to Anthropic (${model})${host}`;
    case "openai":
      return `Admin changed AI provider to OpenAI-compatible API (${model})${host}`;
  }
}

// ---------------------------------------------------------------------------
// User level
// ---------------------------------------------------------------------------

export interface OwnKeySettings {
  provider: OwnKeyProvider;
  model: string;
  baseURL?: string;
  hasKey: boolean;
}

export interface UserAISettings {
  aiMode: AIMode;
  /** Null until the user has saved an own-key configuration. */
  ownKey: OwnKeySettings | null;
}

export interface OwnKeyInput {
  provider: OwnKeyProvider;
  model: string;
  /** Missing or blank uses the provider's default endpoint. */
  baseURL?: string;
  /** undefined keeps the saved key (only while provider and base URL are unchanged), "" clears it. */
  apiKey?: string;
}

export interface UserAISettingsInput {
  aiMode: AIMode;
  ownKey?: OwnKeyInput;
}

interface UserSettingsRow {
  ai_mode: AIMode;
  own_key_provider: OwnKeyProvider | null;
  own_key_model: string | null;
  own_key_base_url: string | null;
  own_key_secret: string | null;
}

const USER_AI_COLUMNS =
  "ai_mode, own_key_provider, own_key_model, own_key_base_url, own_key_secret";

function readUserRow(userId: string): UserSettingsRow | undefined {
  return db()
    .prepare(`SELECT ${USER_AI_COLUMNS} FROM user_settings WHERE user_id = ?`)
    .get(userId) as UserSettingsRow | undefined;
}

export function getUserAISettings(userId: string): UserAISettings {
  return toUserSettings(readUserRow(userId));
}

function toUserSettings(row: UserSettingsRow | undefined): UserAISettings {
  if (!row) return { aiMode: "instance", ownKey: null };
  return {
    aiMode: row.ai_mode,
    ownKey: row.own_key_provider
      ? {
          provider: row.own_key_provider,
          model: row.own_key_model ?? "",
          ...(row.own_key_base_url ? { baseURL: row.own_key_base_url } : {}),
          hasKey: row.own_key_secret !== null,
        }
      : null,
  };
}

/**
 * Saves the user's AI mode and, optionally, their own-key configuration. The key is encrypted at rest and
 * never returned. Changing the provider or base URL requires the key to be entered again, so a saved key is
 * never sent to a different endpoint.
 */
export function setUserAISettings(userId: string, input: UserAISettingsInput): UserAISettings {
  if (!(AI_MODES as readonly string[]).includes(input.aiMode)) {
    throw new AISettingsError("Choose an AI mode: instance, own key or off.");
  }
  const current = readUserRow(userId);

  let provider = current?.own_key_provider ?? null;
  let model = current?.own_key_model ?? null;
  let baseURL = current?.own_key_base_url ?? null;
  let secret = current?.own_key_secret ?? null;

  if (input.ownKey) {
    const own = input.ownKey;
    if (!(OWN_KEY_PROVIDERS as readonly string[]).includes(own.provider)) {
      throw new AISettingsError("Your key must be for Anthropic or an OpenAI-compatible API.");
    }
    const nextModel = cleanModel(own.model);
    if (!nextModel) throw new AISettingsError("Enter the model name for your key.");
    const nextBase = normalizeBaseURL(own.baseURL) ?? null;
    const endpointChanged = provider !== own.provider || baseURL !== nextBase;

    if (own.apiKey === undefined) {
      // Keep the saved key, but never send it to a different provider or endpoint.
      if (endpointChanged && secret !== null) {
        throw new AISettingsError("Enter your API key again when you change the provider or base URL.");
      }
    } else {
      const trimmed = own.apiKey.trim();
      if (trimmed.length > MAX_KEY_LENGTH) throw new AISettingsError("The API key is too long.");
      secret = trimmed ? encrypt(trimmed) : null;
    }

    provider = own.provider;
    model = nextModel;
    baseURL = nextBase;
  }

  if (input.aiMode === "own_key" && (!provider || !secret)) {
    throw new AISettingsError("Add your provider, model and API key before using your own key.");
  }

  db()
    .prepare(
      `INSERT INTO user_settings (user_id, ai_mode, own_key_provider, own_key_model, own_key_base_url, own_key_secret, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ai_mode = excluded.ai_mode,
         own_key_provider = excluded.own_key_provider,
         own_key_model = excluded.own_key_model,
         own_key_base_url = excluded.own_key_base_url,
         own_key_secret = excluded.own_key_secret,
         updated_at = excluded.updated_at`,
    )
    .run(userId, input.aiMode, provider, model, baseURL, secret, Date.now());

  audit(
    "user.ai_settings_changed",
    input.ownKey ? `AI mode set to ${input.aiMode}; own key ${provider} (${model})` : `AI mode set to ${input.aiMode}`,
    { actor: userId },
  );
  return getUserAISettings(userId);
}

/**
 * The user's own-key provider config, with the key decrypted. Only for building a provider.
 * Returns null when no key is saved. Throws if the stored key cannot be decrypted (for example after APP_SECRET changed).
 */
export function getUserAIConfig(userId: string): AIConfig | null {
  const row = readUserRow(userId);
  if (!row?.own_key_provider || !row.own_key_secret || !row.own_key_model) return null;
  const apiKey = decrypt(row.own_key_secret);
  const baseURL =
    row.own_key_base_url ?? (row.own_key_provider === "openai" ? DEFAULT_BASE_URLS.openai : undefined);
  return {
    provider: row.own_key_provider,
    model: row.own_key_model,
    ...(baseURL ? { baseURL } : {}),
    apiKey,
  };
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

function cleanModel(value: string | undefined): string {
  const model = (value ?? "").trim();
  if (model.length > MAX_MODEL_LENGTH || /[\u0000-\u001f]/.test(model)) {
    throw new AISettingsError("The model name is not valid.");
  }
  return model;
}

/** Returns a normalized http(s) URL without a trailing slash, or undefined when blank. */
function normalizeBaseURL(value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  if (raw.length > MAX_URL_LENGTH) throw new AISettingsError("The base URL is too long.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AISettingsError("The base URL must be a full http:// or https:// address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AISettingsError("The base URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new AISettingsError("Leave credentials out of the base URL; use the API key field instead.");
  }
  return url.toString().replace(/\/+$/, "");
}
