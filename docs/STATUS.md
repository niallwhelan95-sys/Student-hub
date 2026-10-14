# Margin: project status

_Last updated: 2026-10-14 (end of session 1)._ This is the living record: read it first when resuming work.

## 1. Product in one paragraph

A personal academic command centre for one student (multi-user capable). Chat is the primary interface; around it sit modules, a document library, a planner, inspectable memory, and a writing-voice profile. Core differentiators: answers **grounded in the student's own materials with verifiable citations**, **persistent structured memory** the student controls, **writing help that preserves the student's voice**, **first-class voice dictation**, and **ADHD-friendly design** (one next step, small tasks, low clutter, never shaming).

## 2. Architecture

```
Browser (React SPA, PWA) ──HTTP/SSE──▶ Hono API (Node 24, TypeScript)
                                         ├─ Postgres (PGlite embedded locally │ hosted Postgres+pgvector in prod)
                                         │    relational data + tsvector full-text + pgvector embeddings + jobs table
                                         ├─ File storage (local disk; S3-style adapter interface ready)
                                         ├─ Job worker (in-process, DB-backed, retries/backoff, survives restarts)
                                         ├─ AI provider layer → Anthropic Claude (streaming, structured outputs, vision, PDF)
                                         ├─ Embeddings → local transformers.js (bge-small-en-v1.5) │ Voyage │ none
                                         └─ Speech-to-text → any OpenAI-compatible /audio/transcriptions (optional)
```

**Key decisions (and why)**
| Decision | Reason |
|---|---|
| Hono + Vite/React SPA, single repo, single process | Simple to run, debug and deploy. Long-lived process suits background document jobs (serverless would not). |
| Postgres everywhere, PGlite locally | One schema and query layer for dev and prod. No Docker needed locally. Full-text and pgvector in one database. |
| Hand-written SQL migrations + tiny runner (`server/db/client.ts`) | Generated tsvector columns and the `vector` extension are awkward in ORM generators. Forward-only and auditable. |
| Dimensionless `vector` column + `embedding_model` per row | Switch embedding providers without schema changes; stale vectors are filtered out by model id. Exact scan is fine at personal scale. |
| Hybrid retrieval (FTS OR-query + vector, reciprocal-rank fusion, relevance floor, per-document cap, module boost) | Keyword search catches exact terms (codes, names). Vectors catch paraphrase. The floor keeps unrelated material out. |
| Retrieved context injected into the **latest user turn**, not the system prompt | The system prompt and history stay byte-stable, so prompt caching works across turns (cache breakpoints on system + last history turn). |
| Own citation scheme `[S1]` / `[M1]`, validated server-side | Only ids actually offered can become citations. Fabricated refs render as struck-through "unverified". |
| Memory extraction after each turn (background) → `active` vs `proposed` | Explicit or clearly stated stable facts are used immediately. Uncertain ones wait for confirmation and are never used as facts. |
| Writing profile = measured stylometrics + AI qualitative profile + student's own notes + retrieved exemplar passages | Works with little data, explainable, cheap; no fine-tuning. Student corrections override inferences. Spoken samples weighted as supplementary. |
| Dictation: MediaRecorder → server STT (preferred) → Web Speech API fallback | Server STT is more accurate and works on all modern browsers. The fallback means it works without keys. Audio is kept in memory only; failed transcriptions keep the recording for retry. |
| Default model `claude-opus-5-5` with `fallbacks: "default"` (server-side refusal fallback) | Highest quality default. Background model is separately configurable for cost (`AI_BACKGROUND_MODEL`). |
| Deterministic "next step" on the dashboard | Instant, free and explainable. AI is the follow-up action ("Help me get started"), not the decision-maker. |

**Security**: scrypt password hashing; random session tokens stored only as SHA-256; httpOnly SameSite=Lax cookies (Secure in prod); CSRF defence via a required custom header on all mutating API calls; per-user authorisation on every query; content-sniffed uploads (executables and disguised files rejected); upload and body size limits; rate limits on auth, chat and STT; strict CSP and security headers; originals served as attachments with `nosniff`; prompt-injection guard (documents are always framed as data; injected tag names are neutralised); account export and full deletion.

## 3. Implemented and verified

Verified = automated test **and/or** exercised in the browser this session (noted).

- **Auth**: register (first-user mode), login, logout, session renewal, account export, account deletion with file cleanup. _Tests + browser._
- **Chat**: create/rename/pin/archive/delete conversations; streaming answers over SSE; stop; regenerate; edit-and-resend; markdown, tables, code with copy, LaTeX; validated citations with popover and deep link to the exact passage; "where we left off" working-context card; provisional titles; per-message actions (save to memory, make task, add deadline, download .md). _Tests + browser (offline mode)._
- **Documents**: PDF (per-page), DOCX (by heading), PPTX (per slide + speaker notes), XLSX (per sheet, tables), CSV, text/markdown/HTML, code, notebooks; images and scanned PDFs via Claude vision (needs API key); content-based type detection; duplicate detection (same bytes reused); revision detection (same name stem); processing status and honest partial/failed states; reprocess; module assignment and suggested module; AI classification, summary, key points, criteria, outcomes, word limit, referencing; detected dates become **suggested** deadlines needing confirmation. _Tests; markdown upload, retrieval and citations in browser._
- **Retrieval**: hybrid search with module preference; attached small documents included whole; large ones searched. _Tests + browser._
- **Memory**: post-turn extraction (title, working context, memories), active vs proposed, temporary memories with expiry, de-duplication, supersession, cross-conversation recall, Memory page (confirm, edit, pin, archive, delete, add). _Tests (with scripted AI)._
- **Writing voice**: samples by paste, calibration exercise (typed or dictated), or from a library document; cleaning (references, citations, quotes, feedback, cover fields); stylometrics; AI profile per context + general; student notes override; enable/disable/reset/rebuild; exemplar retrieval in writing requests only. _Tests; calibration + stats profile in browser._
- **Dictation**: mic in chat, dashboard quick-capture and writing samples; live level meter and timer; review-before-send; "Tidy up" / "Make it written prose" with undo; uncertain-passage hints (Whisper models); retry on failure without losing audio; clear permission and unsupported-browser errors; voice messages flagged. _Server route tested with mocked STT; UI renders and detects capabilities in browser. **Not yet tested with a real microphone** (see Known issues)._
- **Onboarding**: 4 short skippable steps (studies, modules, assistance level + supports, writing calibration), never blocking. _Browser._
- **Dashboard**: one next step, quick capture (text/voice → ask or task), deadlines, tasks, modules, recent chats, processing indicator. _Tests (next-step logic) + browser._
- **Planner**: confirm/edit/dismiss suggested deadlines with source excerpt; deadlines and tasks CRUD; essential vs optional; "done when"; estimates; "Help me start". _Tests._
- **Modules**: list, create, edit, archive, delete; module page tabs (overview with AI module profile incl. "still missing", materials, conversations, planner, memory). _Browser (create, upload, chat)._
- **Search**: global search across documents (hybrid), conversations (highlighted snippets), memories; type and module filters. _Tests (isolation)._
- **Settings**: profile, assistance level, supports, detail, accessibility notes; per-device theme/text size/motion/enter-to-send; connection status; usage (30 days); export; delete. _Browser._
- **PWA**: manifest, icons, service worker (app shell only, API never cached). _Build verified; install not tested on a phone yet._
- **Responsive and accessible**: mobile drawer, safe areas, keyboard focus styles, skip link, labelled controls, reduced motion. _Mobile layout checked in browser._

**Test suite**: `npm test`, 6 files / 46 tests, all passing. Covers detection, extraction (generated PDF/DOCX/PPTX/XLSX/CSV fixtures), chunking, upload→process→retrieve, duplicates/revisions, malicious uploads, vision-unavailable state, AI analysis → suggested deadlines, deletion; grounded chat with citation validation, prompt caching flags, persistence, memory extraction and cross-conversation recall, edit/regenerate, offline mode, provider failure; auth, CSRF, cross-user isolation, export/delete; stylometry, cleaning, writing intent, profile build with/without AI, corrections, disabling; STT route (mocked), voice messages; planner and next step; restart persistence.

## 4. Known issues and limitations

- **No API keys configured yet** → all AI paths verified with a scripted fake provider, not the live API. First thing to do: add `ANTHROPIC_API_KEY` and run a real chat, a document analysis and a writing-profile rebuild.
- **Dictation not tested with a real microphone.** The built-in test browser couldn't grant mic access. Test in Chrome/Edge/Safari on desktop and on a phone, with and without `STT_API_KEY`.
- Web Speech fallback: Chrome/Edge send audio to their own speech service. Firefox has no support. Embedded browsers often expose the API but fail (handled with a clear message).
- PDF tables and multi-column layouts come out as flat text. Diagrams inside text PDFs and PPTX images aren't analysed visually (a warning is shown).
- Scanned PDFs over 100 pages / 30 MB aren't transcribed (clear message). HEIC photos must be converted (clear message).
- Single-process rate limiter and job worker: fine for a personal deployment. A shared store is needed if horizontally scaled.
- JS bundle is ~900 KB (gzip 267 KB). Route-level code splitting would help slow mobile connections.
- Dockerfile written but **not built/tested** (Docker isn't installed on this machine).
- Timezone: deadlines without a time are stored as 23:59 server-local time. Add a per-user timezone setting before relying on reminders.

## 5. Environment and configuration

See `.env.example`. Needed from you:
1. **`ANTHROPIC_API_KEY`** (required for AI features). Optionally `AI_BACKGROUND_MODEL=claude-haiku-5-5` to cut background costs.
2. **`STT_API_KEY`** (optional, recommended): an OpenAI key (`gpt-4o-mini-transcribe`), or Groq (`STT_BASE_URL=https://api.groq.com/openai/v1`, `STT_MODEL=whisper-large-v3-turbo`, cheap and fast, with confidence hints).
3. For multi-device use: a hosted Postgres with pgvector (`DATABASE_URL`) and a host for the container.

## 6. Deployment

1. Postgres with `vector` (Neon/Supabase): set `DATABASE_URL`. Migrations run at boot.
2. Build and run the `Dockerfile`, with a persistent volume at `/app/data` (uploads + model cache).
3. Secrets: `ANTHROPIC_API_KEY`, `STT_API_KEY`. Set `NODE_ENV=production`, `APP_URL`. **HTTPS is required** (secure cookies, microphone access).
4. Backups: database snapshots (provider) + nightly copy of `/app/data/uploads`.
5. Keep `REGISTRATION_MODE=first-user` (or `closed` after creating your account).

## 7. Outstanding integrations (Phase 4, not started)

Canvas/Moodle LMS, OneDrive, Outlook/calendar sync, university library search, additional AI providers (the `AIProvider` interface is ready), push notifications.

## 8. Next recommended tasks (in order)

1. **Live verification with real keys**: chat quality, citations, memory extraction, document analysis, writing profile, vision on a screenshot and a scanned PDF. Tune prompts from real use.
2. **Real-device dictation testing** (desktop Chrome/Safari, iOS Safari, Android Chrome) with and without server STT.
3. **Assignment workspaces (Phase 2)**: `assignments` table (brief, rubric, outline, sections with status, decisions, word count, referencing, next action); section-by-section mode; rubric alignment review; guided / collaborative / drafting modes per assignment; "explain what you changed" diff view for revisions.
4. **Weekly check-in** flow (structured, uses stored module state, skippable questions) + configurable reminders (web push).
5. Writing: original-vs-revised comparison view; learn from repeated user edits (with confirmation); per-context profiles surfaced in chat.
6. Research sources library with citation integrity states (located / accessed / verified), Harvard/APA formatting.
7. Exam preparation (Phase 3): flashcards, spaced repetition, adaptive quizzes from module material.
8. Performance: code splitting; HNSW index once a corpus grows past ~50k chunks per embedding model.
