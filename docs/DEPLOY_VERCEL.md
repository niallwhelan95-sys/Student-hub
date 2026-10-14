# Deploying Margin to Vercel

**Status: prepared but NOT yet deployed or tested on Vercel.** The code is verified locally (52 tests pass). The first real deploy may need small tweaks.

## 1. Create the services (all have free tiers)
1. **Postgres with pgvector**: Neon (or Supabase). Copy the connection string, which becomes `DATABASE_URL`. Run `CREATE EXTENSION vector;` once if the provider doesn't do it automatically.
2. **Vercel Blob (private store)**: in your Vercel project, Storage → Create → Blob → **Private**. This adds `BLOB_READ_WRITE_TOKEN` automatically. The private store is required; the access mode can't be changed later.

## 2. Import the project
Vercel dashboard → Add New → Project → import `niallwhelan95-sys/Student-hub`. `vercel.json` already sets the install command, build command (`npm run build:vercel`, output to `public/`) and the SPA rewrite.

## 3. Environment variables
| Variable | Value |
|---|---|
| `DATABASE_URL` | your Postgres string (required) |
| `ANTHROPIC_API_KEY` | your key (required for AI) |
| `AI_BACKGROUND_MODEL` | optional, e.g. `claude-haiku-5-5` |
| `VOYAGE_API_KEY` | optional: semantic search (otherwise keyword-only on Vercel) |
| `STT_API_KEY` | optional: accurate voice transcription |
| `REGISTRATION_MODE` | `first-user`: create your account first, then set `closed` |

## 4. What changes on Vercel
- Uploads go browser → private Blob (no 4.5 MB limit), then are registered and processed.
- Background jobs run after each response via `waitUntil`; leftovers are retried on later requests.
- Local embedding model and embedded DB are not used (they're removed from the install).
- Rate limiting is per function instance (fine for one user).

## 5. Known risks
- Zero-config Hono entry (`server.ts`) and the install-time deletion trick are unverified on a real build.
- Long chat answers rely on streaming within the function duration limit (300s default).
- Scanned-PDF vision on big files may hit duration limits.
