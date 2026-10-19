# DataCleanse

DataCleanse cleans CSV files. Deterministic rules fix the mechanical problems first: dates, stray whitespace, casing and phone numbers. Anything the rules cannot decide, such as a likely typo or an inconsistent label, goes to a person, who approves or skips each change. You download the cleaned CSV and a change report (PDF and CSV). AI is optional. With it, the app suggests fixes for ambiguous values and answers questions about your files in plain English.

## How it works

1. **Upload.** Add CSV files and choose **Rules + AI** or **Rules only**.
2. **Scan.** The file's format and size are checked, then it is scanned for malware.
3. **Profile.** Columns get types, null counts, distinct counts and most common values.
4. **Rules.** Cleaning rules run. A rule set is picked from the file's headers, or you choose one. Rule sets live on `/rules`.
5. **AI suggestions.** If AI is on, the model reviews the first 20 rows and suggests fixes for ambiguous values only. If AI is off or unavailable, this step is skipped and the file continues.
6. **Review.** Approve or skip each change. Anything still pending when you apply is skipped.
7. **Apply and report.** The cleaned CSV is written, and the change report is built.

Other features:

- **Compare** (`/compare`): match two files row by row on key columns, auto-detected or chosen, and export the result as CSV.
- **Ask** (`/ask`): add up to 20 files to a chat and ask questions. The AI writes one read-only `SELECT`. DuckDB runs it on the server against every row. The query must finish within 10 seconds and returns at most 1,000 rows. If a question spans two files, the app proposes join columns for you to confirm first.
- **Rules from a sentence:** describe a rule in English on `/rules` and, with AI on, the model drafts it and previews the matches on your latest file.
- **Settings** (`/settings`): profile, two-factor sign-in (authenticator app), privacy and data, AI provider, JSON data export and account deletion. Privacy sets how long files are kept: 1 hour, 24 hours (default) or 7 days.
- **Admin console** (`/admin`): Overview, Jobs, Users, Audit log and Configuration (instance AI settings). The first account created becomes the admin.

Expired files are deleted from disk by the retention sweep, which runs at startup and every five minutes. The database keeps the file's change history.

### Screens

| Route | Purpose |
| --- | --- |
| `/signup`, `/signin`, `/reset-password` | Accounts: password, 2FA, or an emailed sign-in link |
| `/files` | Your files. Review, delete or retry |
| `/upload` | Add CSVs and choose the cleaning mode |
| `/processing/[fileId]` | Progress of a cleaning run |
| `/review/[fileId]` | Approve or skip each change, then apply |
| `/report`, `/report/[fileId]` | Change report and downloads (report PDF, change log CSV, cleaned CSV, original) |
| `/compare` | Compare two files |
| `/ask`, `/ask/[chatId]` | Ask questions about your files |
| `/rules` | Rule sets |
| `/settings` | Profile, security, privacy and data, AI provider |
| `/admin/*` | Admin console |
| `/components` | UI component gallery |

## Quick start

DataCleanse is a single-user, self-hosted app. The first account you create is the owner; after that,
sign-ups close (set `ALLOW_SIGNUPS=1` to reopen them). Sign-in is email + password via
[Better Auth](https://better-auth.com/docs/authentication/email-password).

**With Docker**

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and create your account. Data lives in the
`datacleanse-data` volume.

**With Node.js 22**

```bash
npm install
cp .env.example .env.local   # optional
npm run build && npm start    # or `npm run dev` while developing
```

AI is off until you configure it. DataCleanse doesn't run models itself: point it at a model server
you already run (Ollama, LM Studio, llama.cpp, vLLM) or a cloud API, in `.env.local` / `docker-compose.yml`
or later in **Admin > Configuration**. Inside Docker, reach a model server on your machine at
`http://host.docker.internal:<port>/v1` (for Ollama: `http://host.docker.internal:11434/v1`), not `localhost`.

**Where data lives.** `DATA_DIR` defaults to `./.data`, relative to the folder you start the server from:

- `app.db`: SQLite database (accounts, files, jobs, change history, settings, audit log). It runs in WAL mode, so `app.db-wal` and `app.db-shm` sit beside it.
- `files/<userId>/<fileId>/`: `original.csv` and, once cleaned, `cleaned.csv`.

To reset a development instance, stop the server and delete the folder.

## AI models

AI is optional. The instance provider comes from environment variables. An admin can override it in **Admin > Configuration**, where saved values are stored in the database and the API key is encrypted with `APP_SECRET`. Full list: [`.env.example`](.env.example).

| Option | Set | Where data goes |
| --- | --- | --- |
| Local, Ollama | `AI_PROVIDER=local`, `AI_BASE_URL=http://localhost:11434/v1` (default), `AI_MODEL=llama3.1` (default). Uses your own Ollama; pull the model there first. | Your machine |
| Local, LM Studio | `AI_PROVIDER=local`, `AI_BASE_URL=http://localhost:1234/v1`, `AI_MODEL` = the model id LM Studio shows | Your machine |
| Local, llama.cpp server or vLLM | `AI_PROVIDER=local`, `AI_BASE_URL` = that server's `/v1` URL | Wherever that server runs |
| Anthropic | `ANTHROPIC_API_KEY`. Model defaults to `claude-opus-5-5`, set with `AI_MODEL`. `AI_PROVIDER` is optional here. | Anthropic |
| Hosted OpenAI-compatible | `AI_PROVIDER=openai`, `AI_BASE_URL` (default `https://api.openai.com/v1`), `AI_API_KEY`, `AI_MODEL` (default `gpt-4o-mini`) | That provider |
| Off | `AI_PROVIDER=off` | Nowhere. Rules only |

`AI_PROVIDER=local` is treated as local, so it does not warn you when `AI_BASE_URL` points at another machine. Keep the URL on localhost unless you trust that machine.

**Per-user mode.** Each user chooses one option in **Settings > AI provider**:

- **Instance model** (default): uses the instance provider above.
- **Your API key**: an Anthropic key or any OpenAI-compatible endpoint, with its own model. The key is encrypted with `APP_SECRET` and never shown again.
- **Off**: rules only for this user.

Admins and users can test the connection from their AI settings. `GET /api/ai/status` returns the provider, model and a live check. `POST /api/ai/suggest` and `POST /api/ai/ask` return `409` when AI is off.

### What the AI sees

Nothing leaves the machine when the endpoint is local. The rest of this section describes what is sent to whichever model is configured.

- **Review suggestions:** the file name, row count, column names and types, null and distinct counts, and the first 20 rows of the file. Most common values are not sent, and nothing past row 20 is.
- **Ask, planning the query:** table names, row counts, column names and types, null and distinct counts, and up to 10 most common values per column (each cut to 80 characters). The file names are not sent.
- **Ask, writing the answer:** your question, the SQL the AI wrote, column names, up to 50 result rows, and row counts. The full result, and the rest of the data, stay on the server. The answer may only use numbers from that result.
- **Rule drafting:** the sentence you typed, column names (up to 200), and up to 10 most common values per column from your most recent file.

Cell values are sent as data. Prompts tell the model to ignore instructions inside them.

## Production

```bash
npm run build
npm start                 # runs in production mode; use `npm start -- -p 8080` for another port
```

Before you go live:

- **`APP_SECRET`**: set to a random value of at least 32 characters. It signs download links (valid for 15 minutes) and encrypts saved API keys and 2FA secrets. Changing it later makes those saved secrets unreadable.
- **`APP_URL`**: set to the public address, so links in emails point to the right place.
- **`SMTP_URL`**: needed in production for magic-link sign-in, invites and password resets. Without it those emails are refused (the server log records the failure). Set `MAIL_LOG=1` to print them to the server log instead, but only if everyone who can read the log may sign in as any user.
- **HTTPS**: session cookies are `Secure` in production, so browsers send them only over HTTPS (localhost is the usual exception). Put the app behind a TLS reverse proxy. Raise the proxy's request-body limit to match `MAX_UPLOAD_MB` (default 200).
- **`CLAMD_ADDRESS`**: optional, but recommended for uploads from outside your organization. When set, every upload is scanned by clamd, and an upload is rejected if clamd cannot be reached.
- **One instance only.** The database is SQLite and the job runner runs inside the Node process. Run a single process per `DATA_DIR`. `JOB_CONCURRENCY` (default 2) sets how many cleaning jobs run at once within it.
- **Backups:** back up `DATA_DIR`. Copy `app.db` while the server is stopped, or use `sqlite3 app.db ".backup 'backup.db'"` while it runs, because the database uses WAL mode and copying the main file alone can miss recent writes.

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | Unit and integration tests in `src/**/*.test.ts`, plus `scripts/smoke-ai.ts` |
| `npm run test:ai` | The AI provider layer, against a fake OpenAI-compatible server. No real model needed. |
| `npm run build && npm run test:e2e` | Playwright tests against a production build. Each spec starts its own server with a fresh `DATA_DIR`. The AI specs use the fake model server in `e2e/support/fake-ai.ts`. If Playwright's browser is missing, run `npx playwright install chromium`. |
| `npm run lint` | ESLint |

## Project layout

```
src/
  app/                  Routes, one folder per screen; api/ holds JSON routes
    admin/  ask/  compare/  files/  processing/  report/  review/  rules/  settings/  upload/
  components/           Shared UI and layout
  lib/ai/               Provider clients (Anthropic, OpenAI-compatible), AI prompts and schemas
  server/               Server-only code
    ai/                 Instance and per-user AI settings, provider resolution
    ask/  query/        Ask flow; read-only SQL checks and DuckDB runner
    auth/               Accounts, sessions, 2FA, sign-in links
    cleaning/           Rules engine
    csv/                Read, profile, malware scan, write
    files/              Upload, storage, downloads, retention
    jobs/               Job queue and the clean job
    reports/            PDF and CSV change reports
    db/                 SQLite schema and migrations
    env.ts  email.ts    Environment settings; mail sending
  instrumentation.ts    Starts the job runner and the retention sweep
  proxy.ts              Sends signed-out visitors to /signin
e2e/                    Playwright specs, fixtures, fake model server
scripts/smoke-ai.ts     AI smoke test (npm run test:ai)
```
