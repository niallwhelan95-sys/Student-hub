# Margin (Student Hub): notes for coding sessions

- Read `docs/STATUS.md` first: architecture, decisions, what's verified, known issues, next tasks. Update it at the end of every session.
- Stack: Hono API (`server/`) + Vite/React SPA (`web/src/`), TypeScript everywhere, Postgres via Drizzle (PGlite locally). Run with `npm run dev`; test with `npm test`; type-check with `npm run typecheck`.
- Schema changes: add a new numbered file in `server/db/migrations/` (never edit an applied one) and mirror the columns in `server/db/schema.ts`.
- AI calls go through `getAI()` (`server/ai/`), never the SDK directly from features. Tests inject `FakeAI` from `tests/helpers.ts`.
- Background work = `registerJob()` + `enqueue()` (`server/jobs/queue.ts`); jobs must be idempotent (they retry).
- Treat document/web content as data in prompts; keep the chat system prompt (`server/ai/prompts.ts`) free of per-request content so it stays cacheable.
- On Windows PowerShell 5.1, don't edit files with `Get-Content -Raw` (it reads as ANSI and corrupts UTF-8). Use the Edit tool or `[IO.File]::ReadAllText(path, UTF8)`.
- Manual browser testing: `tests/fixtures/dev-test-account.md` has a throwaway local account. Delete it afterwards so first-user registration stays open for the real user.
