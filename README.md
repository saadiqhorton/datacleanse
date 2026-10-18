# DataCleanse

DataCleanse is a tool for cleaning CSV files before they are used. Deterministic rules fix the mechanical problems first (date formats, stray whitespace, casing, phone numbers). A person then reviews anything the rules cannot decide, such as likely typos or inconsistent category labels, approves or skips each change, and gets a report of what changed. Optional AI suggestions and "ask your data" questions (answered with a read-only SQL query run on every row) work only when an AI provider is configured; otherwise the app runs in rules-only mode.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Screens

| Route        | Purpose                          |
| ------------ | -------------------------------- |
| `/signin`    | Sign in                          |
| `/files`     | Files in the workspace           |
| `/upload`    | Add CSV files                    |
| `/processing`| Rule-based cleaning run          |
| `/review`    | Approve or skip suggested fixes  |
| `/report`    | What changed and why             |
| `/compare`   | Compare original and cleaned data |
| `/ask`       | Ask questions about your data    |
| `/rules`     | Cleaning rules                   |
| `/settings`  | Settings, including AI status    |
| `/admin`     | Administration                   |
| `/components`| UI component gallery             |

## AI models

AI is optional. Configure it with environment variables; see [`.env.example`](.env.example) for every setting.

- **Cloud (Anthropic):** set `ANTHROPIC_API_KEY`. The default model is `claude-opus-5-5`, set with `AI_MODEL`. Data is sent to Anthropic.
- **Local (Ollama):** run `ollama pull llama3.1`, then set `AI_PROVIDER=local` and `AI_BASE_URL=http://localhost:11434/v1`. Data stays on your machine.
- **Local (LM Studio):** start the local server in LM Studio (default port 1234), then set `AI_PROVIDER=local` and `AI_BASE_URL=http://localhost:1234/v1`. Set `AI_MODEL` to the model id LM Studio shows.
- **Hosted OpenAI-compatible:** set `AI_PROVIDER=openai`, `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`.
- **Off:** set `AI_PROVIDER=off` for rules-only mode.

The AI never receives whole files. It receives only column names, column types, null and distinct counts, top values, and a 20-row sample.

### API endpoints

- `GET /api/ai/status` returns the configured provider, model, and whether a live check of the provider succeeded.
- `POST /api/ai/suggest` takes a file profile and returns suggested fixes. Returns `409` when AI is off.
- `POST /api/ai/ask` takes a question and table profiles and returns a read-only SQL query with an explanation. Returns `409` when AI is off.
