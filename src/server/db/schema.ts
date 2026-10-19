/**
 * SQLite schema. Append new migrations to the end; never edit an applied one.
 * Timestamps are epoch milliseconds (INTEGER). Ids are prefixed random strings (see ids.ts).
 */
export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,                       -- scrypt; NULL for magic-link-only accounts
  password_changed_at INTEGER,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  totp_secret TEXT,                         -- base32, encrypted with APP_SECRET
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                      -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  two_factor_passed INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Single-use tokens for magic sign-in links and password resets.
CREATE TABLE login_tokens (
  id TEXT PRIMARY KEY,                      -- sha256 of the emailed token
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL CHECK (purpose IN ('magic_link','password_reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  retention_hours INTEGER NOT NULL DEFAULT 24 CHECK (retention_hours IN (1,24,168)),
  default_mode TEXT NOT NULL DEFAULT 'rules_ai' CHECK (default_mode IN ('rules_ai','rules_only')),
  ai_mode TEXT NOT NULL DEFAULT 'instance' CHECK (ai_mode IN ('instance','own_key','off')),
  own_key_provider TEXT CHECK (own_key_provider IN ('anthropic','openai')),
  own_key_model TEXT,
  own_key_base_url TEXT,
  own_key_secret TEXT,                      -- encrypted with APP_SECRET
  updated_at INTEGER NOT NULL
);

-- Uploaded CSV/TSV files and their cleaning state.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  alias TEXT NOT NULL,                      -- SQL table name used by Ask
  size_bytes INTEGER NOT NULL,
  delimiter TEXT,
  encoding TEXT,
  row_count INTEGER,
  column_count INTEGER,
  storage_path TEXT,                        -- relative to DATA_DIR; NULL once deleted
  cleaned_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('uploaded','processing','needs_review','ready','failed','deleted')),
  error TEXT,
  mode TEXT NOT NULL DEFAULT 'rules_ai' CHECK (mode IN ('rules_ai','rules_only')),
  options_json TEXT NOT NULL DEFAULT '{}',  -- CleanOptions
  rule_set_id TEXT REFERENCES rule_sets(id) ON DELETE SET NULL,
  profile_json TEXT,                        -- FileProfile (columns, stats, PII flags)
  ai_status TEXT NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none','pending','done','unavailable','skipped')),
  rows_out INTEGER,
  approved_by TEXT REFERENCES users(id),
  applied_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX files_user ON files(user_id, created_at DESC);
CREATE INDEX files_expires ON files(expires_at) WHERE deleted_at IS NULL;

-- Every proposed change. Rule changes start approved; AI changes start pending.
CREATE TABLE changes (
  id INTEGER PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,               -- 0-based data row (header excluded)
  column_name TEXT,                         -- NULL for row-level changes (merge)
  kind TEXT NOT NULL CHECK (kind IN ('value','merge','flag')),
  before TEXT,
  after TEXT,
  merge_into_row INTEGER,                   -- kind='merge': row kept
  source TEXT NOT NULL CHECK (source IN ('rule','ai')),
  rule_id TEXT,                             -- RuleAction or rules.id
  reason TEXT NOT NULL,
  confidence REAL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','pending','skipped')),
  decided_by TEXT REFERENCES users(id),
  decided_at INTEGER
);
CREATE INDEX changes_file ON changes(file_id, decision);

CREATE TABLE rule_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  header_match_json TEXT NOT NULL DEFAULT '[]', -- header names; set auto-applies when they all appear
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  rule_set_id TEXT NOT NULL REFERENCES rule_sets(id) ON DELETE CASCADE,
  column_pattern TEXT NOT NULL,             -- glob on header: "*_date", "email", "*" = all text
  action TEXT NOT NULL,                     -- RuleAction
  params_json TEXT NOT NULL DEFAULT '{}',
  on_low_confidence TEXT NOT NULL DEFAULT 'review' CHECK (on_low_confidence IN ('review','apply','skip')),
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT ''
);
CREATE INDEX rules_set ON rules(rule_set_id, position);

-- Background work: cleaning, ask queries, comparisons.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('clean','ask','compare')),
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','blocked','cancelled')),
  step TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,      -- 0..100
  error TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX jobs_status ON jobs(status, created_at);
CREATE INDEX jobs_created ON jobs(created_at DESC);

-- Ask your data conversations.
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE chat_files (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (chat_id, file_id)
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  sql TEXT,
  joins_json TEXT,                          -- proposed joins awaiting confirmation
  result_json TEXT,                         -- { columns, rows, rowsScanned, ms, notes }
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('needs_confirmation','running','done','failed','blocked')),
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_messages_chat ON chat_messages(chat_id, created_at);

CREATE TABLE compares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  left_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  right_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  key_columns_json TEXT NOT NULL,
  result_json TEXT,                         -- CompareResult
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                     -- dotted, e.g. "file.uploaded", "ask.query_rejected"
  detail TEXT NOT NULL DEFAULT ''           -- human readable, shown in Activity/Audit log
);
CREATE INDEX audit_at ON audit_log(at DESC);
CREATE INDEX audit_file ON audit_log(file_id, at);

-- Instance settings editable by admins (override env defaults), e.g. ai.provider.
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE ai_calls (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,                    -- "suggest_fixes" | "plan_query" | ...
  ok INTEGER NOT NULL,
  ms INTEGER NOT NULL
);
CREATE INDEX ai_calls_at ON ai_calls(at);
`,
  /* 2: TOTP replay protection: the last accepted 30-second time step per user */ `
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
`,
];
