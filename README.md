# FastTrackr

**FastTrackr** is a web application for managing household financial data. It imports structured data from spreadsheets, optionally enriches records using transcribed advisor-call audio and AI-assisted extraction, and surfaces **reviewable change proposals** with full **provenance** (where each value came from).

This repository is a **single-user, demo-oriented** full-stack app: there is **no authentication**. It is intended for evaluators, collaborators, or new contributors who need to run the app locally and understand what it does without prior context.

---

## What you can do

- **Import spreadsheets** (CSV, XLS, XLSX), including multi-sheet workbooks, with header aliasing and normalization into households, members, and accounts.
- **Import audio** of advisor conversations: transcription (OpenAI Whisper) plus structured fact extraction (GPT-4o) that proposes field updates tied to transcript segments.
- **Review changes** instead of silent overwrites: conflicting or uncertain updates become proposals you can accept or dismiss in the UI.
- **Browse households** and drill into members, accounts, bank/beneficiary details, enrichment history, and sources.
- **View insights** dashboards with charts driven by a single server-side metrics contract.

---

## Tech stack

| Layer | Technology |
|--------|------------|
| App framework | [Next.js](https://nextjs.org/) 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Charts | Recharts |
| API | Next.js Route Handlers + service layer under `src/lib/` |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM, Drizzle Kit (`db:push` workflow) |
| Spreadsheets | SheetJS (`xlsx`) |
| AI | OpenAI API: Whisper (`whisper-1`) for audio, GPT-4o for structured extraction |

---

## Prerequisites

- **Node.js** `>= 20.9.0` (required by Next.js 16)
- **npm** (or compatible package manager; commands below use `npm`)
- A running **PostgreSQL** instance you can connect to with a URL
- An **OpenAI API key** with access to the models used for transcription and chat completion

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example env file and edit values:

```bash
cp .env.example .env.local
```

See [Environment variables](#environment-variables) for details.

### 3. Apply the database schema

This project uses Drizzle Kit to push the schema to your database (see `drizzle.config.ts`):

```bash
npm run db:push
```

### 4. Seed sample data (optional)

The seed script imports the bundled sample CSV (`Master Client Info Sample Data.csv`) via the same spreadsheet pipeline used in production code paths:

```bash
npm run seed
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (see `.env.example` for format). Used by the app and Drizzle Kit. |
| `OPENAI_API_KEY` | Yes for audio/AI features | Secret key for OpenAI API calls (Whisper + GPT-4o). |
| `DB_CONNECT_TIMEOUT_MS` | No | Database client connect timeout in milliseconds. Defaults to `30000` if unset. |

**Security:** Never commit `.env.local` or real secrets. `.env.example` is the template only.

---

## NPM scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start Next.js in development mode |
| `npm run build` | Production build |
| `npm run start` | Run production server (after `build`) |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migrations from schema (when using migration files) |
| `npm run db:push` | Push `src/lib/db/schema.ts` to the database |
| `npm run seed` | Import sample spreadsheet data via `scripts/seed.ts` |

---

## Application map

### Pages (UI)

| Route | Purpose |
|-------|---------|
| `/` | Household list: cards with member/account counts, net worth/income-style metrics, completeness |
| `/households/[id]` | Household detail: overview, members, accounts, bank & beneficiaries, changes, enrichment, sources |
| `/upload` | Upload flows for spreadsheets and audio |
| `/insights` | Charts and dashboards (income vs expenses, net worth breakdown, account distribution, members per household, and related views) |

### API (Route Handlers)

The app exposes a small set of **JSON route handlers** under `src/app/api/`. Everything else—listing households, household detail, insights metrics, and edits in the UI—is loaded or applied through **async Server Components** and the **repository/cache layer** in `src/lib/`, not through additional REST endpoints.

**HTTP routes (used by the client):**

- **Imports:** `POST /api/imports/spreadsheet`, `POST /api/imports/audio`
- **Change proposals:** `POST /api/changes/[id]/accept`, `POST /api/changes/[id]/dismiss`

New households and entities are created or updated through those import flows and the review UI; there are no separate `GET`/`PATCH` JSON APIs for households, members, accounts, imports metadata, or insights.

Exact request/response shapes are defined in the route files and shared types under `src/lib/`.

---

## How it works (high level)

### Spreadsheet ingestion

Rows are interpreted as **household → member → account** data. Values are normalized (currency, dates, tax IDs as strings, etc.) and matched to existing entities where possible. Updates that conflict with existing non-null data are turned into **`change_proposals`** rather than overwriting silently.

### Audio enrichment

1. **Transcribe** audio with Whisper (segment-level timestamps).
2. **Extract** structured facts with GPT-4o, linked to segment indices.
3. **Propose** field changes; high-confidence facts may be auto-applied depending on logic in the import pipeline.
4. **Audit** in the UI: proposals and applied values tie back to **transcript segments** and **source artifacts**.

### Insights

Metrics are computed **on the server** from normalized entities and exposed through a single insights contract so charts and summaries stay consistent.

---

## Repository layout (selected)

```
src/
  app/                 # Next.js App Router: pages + API routes
  lib/
    db/                # Drizzle schema, client, repository
    import/            # Spreadsheet + audio import pipelines
scripts/
  seed.ts              # Sample data import
drizzle.config.ts      # Drizzle Kit configuration
```

---

## Product assumptions and limitations

These are intentional boundaries for this demo:

- **Single user, no authentication** — do not expose untrusted networks without adding auth and hardening.
- **Audio import** expects an **existing household** to attach enrichment to.
- **SSN handling:** only the **last four digits** are retained/stored as designed.
- **Sparse imports:** some fields may be missing; charts and cards show partial or empty states where appropriate.
- **Human review:** ambiguous spreadsheet or AI-extracted values may require review in the **Changes** tab.

---

## Data and third-party services

- **OpenAI:** Audio and text are sent to OpenAI for transcription and extraction when you use those features. Review OpenAI’s data policies and your organization’s compliance requirements before using real client data.
- **PostgreSQL:** All durable application state lives in your database; back it up according to your needs.

---

## Troubleshooting

- **`db:push` fails:** Confirm `DATABASE_URL` in `.env.local`, PostgreSQL is reachable, and the user has permission to create/alter tables.
- **Audio or AI features fail:** Verify `OPENAI_API_KEY`, billing/quotas, and model availability for your account.
- **Seed fails:** Ensure `Master Client Info Sample Data.csv` exists at the project root (it is referenced by `scripts/seed.ts`).
- **Port in use:** Run dev on another port, e.g. `npx next dev -p 3001`.

---

## License

This project is marked **private** in `package.json`. Add a root `LICENSE` file if you redistribute or open-source it.
