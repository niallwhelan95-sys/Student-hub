# Margin — your personal AI student hub

Margin is a personal academic command centre: an AI chat that **knows your modules**, answers from **your own course materials with citations**, **remembers** what matters across conversations, **learns how you write** so its help still sounds like you, and lets you **speak instead of type**. It is designed to be ADHD-friendly throughout: one clear next step, small tasks, calm UI, nothing that shames you for being behind.

> Status: first working milestone (Phase 1 + 1A). See [docs/STATUS.md](docs/STATUS.md) for exactly what's built, tested, and next.

## Quick start (local)

Requirements: **Node.js 22+** (24 recommended). Nothing else: the database is embedded.

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env` and set `ANTHROPIC_API_KEY` (from https://platform.claude.com). Without it the app runs in a clearly labelled **offline mode**: uploads, search and retrieval all work, but no AI answers are written.

```bash
npm run dev
```

Open http://localhost:5173 and create your account. In the default `first-user` mode, only the first account can register.

The first upload downloads a ~30 MB open embedding model into `data/models/` (one time). Everything you store lives in `data/` (git-ignored).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (port 3001, auto-restart) + web app (port 5173, hot reload) |
| `npm test` | Runs the automated test suite (Vitest) |
| `npm run typecheck` | TypeScript check of server, web and tests |
| `npm run build` | Builds the production web app into `dist/web` |
| `npm start` | Runs the production server (serves the API and the built app on port 3001) |
| `npm run db:migrate` | Applies database migrations (also runs automatically at startup) |

## Configuration

All settings are in `.env`. See [.env.example](.env.example) for the full list with explanations.

| Feature | Setting | Without it |
|---|---|---|
| AI answers, document analysis, memory extraction, writing profile | `ANTHROPIC_API_KEY` | Offline mode: matching passages shown instead of answers |
| Semantic search | `EMBEDDINGS_PROVIDER=local` (default, free, private) or `voyage` + `VOYAGE_API_KEY` | `none` = keyword search only |
| Accurate voice transcription | `STT_API_KEY` (+ `STT_BASE_URL`, `STT_MODEL`). Any OpenAI-compatible endpoint | Falls back to the browser's speech recognition (Chrome, Edge, Safari) |
| Cross-device hosted database | `DATABASE_URL` (Postgres with pgvector: Neon, Supabase…) | Embedded PGlite in `data/db` |

Models default to `claude-opus-5-5`. Set `AI_BACKGROUND_MODEL=claude-haiku-5-5` to make background work (memory extraction, document classification) much cheaper.

## Using it on your phone and other devices

Margin is a responsive installable web app (PWA). To use it everywhere, deploy it once to a server and open that URL on each device. Use **Add to Home Screen** on mobile. All data syncs through the server; nothing important is kept only in the browser.

**Deploying** (summary; details in [docs/STATUS.md](docs/STATUS.md#deployment)):
1. Create a Postgres database with the `vector` extension (Neon and Supabase both offer free tiers) and set `DATABASE_URL`.
2. Deploy the included `Dockerfile` to any container host (Fly.io, Railway, Render, a VPS) with a persistent volume at `/app/data` for uploaded files.
3. Set `NODE_ENV=production`, `APP_URL=https://your-domain`, and your API keys as secrets. Serve over HTTPS.
4. Back up the database and the `/app/data/uploads` volume.

## Privacy and data

- Your data lives on your Margin server. Retrieved passages and your messages are sent to the AI provider only to answer you.
- Uploaded documents are treated as **data, never instructions**. Text inside a file can't override how Margin behaves.
- Voice recordings are transcribed from memory and **never written to disk**.
- Settings → **Export all my data** downloads everything as JSON. **Delete account** removes all of it, including uploaded files.
- Memory is fully inspectable and editable on the Memory page. Uncertain facts wait for your confirmation before they're used.

## Project layout

```
server/            Hono API (TypeScript)
  ai/              Provider-independent AI layer (Claude implementation, prompts, usage tracking)
  auth/            Password hashing, sessions, CSRF + auth middleware
  chat/            Chat turn orchestration, context assembly, post-turn memory extraction
  db/              Drizzle schema, SQL migrations, PGlite/Postgres client
  documents/       File detection, extraction (PDF/DOCX/PPTX/XLSX/CSV/text/code), vision, chunking, analysis
  embeddings/      Local (transformers.js) / Voyage / hash embedders
  jobs/            Durable database-backed job queue
  memory/          Memory storage, de-duplication, retrieval
  retrieval/       Hybrid search (full-text + vector, rank fusion)
  speech/          Speech-to-text proxy and voice-preserving tidy-up
  writing/         Own-writing cleaning, stylometrics, writing profiles, exemplar retrieval
  routes/          HTTP routes
web/src/           React app (Vite, Tailwind, React Query)
tests/             Vitest suites (API-level, against an in-memory database)
docs/STATUS.md     Architecture, decisions, status, known issues, next steps
```
