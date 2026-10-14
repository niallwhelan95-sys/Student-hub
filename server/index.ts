import path from "node:path";
import { serve } from "@hono/node-server";
import { env } from "./env";
import { initDb, closeDb, dbKind } from "./db/client";
import { createApp } from "./app";
import { startWorker, stopWorker } from "./jobs/queue";
import { purgeExpiredSessions } from "./auth/sessions";
import { getAI } from "./ai";
import { getEmbedder } from "./embeddings";
import { serverTranscriptionAvailable } from "./speech/service";

await initDb();
await startWorker();
await purgeExpiredSessions();

const app = createApp({ staticDir: path.resolve("dist/web") });
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  const ai = getAI();
  console.log(`\n  Margin API listening on http://localhost:${info.port}`);
  console.log(`  Database:       ${dbKind() === "pglite" ? `embedded PGlite (${env.PGLITE_DIR})` : "Postgres (DATABASE_URL)"}`);
  console.log(`  AI model:       ${ai.configured ? `${env.AI_CHAT_MODEL} (background: ${env.AI_BACKGROUND_MODEL})` : "NOT CONFIGURED — offline mode (set ANTHROPIC_API_KEY)"}`);
  console.log(`  Embeddings:     ${getEmbedder()?.id ?? "none (keyword search only)"}`);
  console.log(`  Transcription:  ${serverTranscriptionAvailable() ? env.STT_MODEL : "browser speech recognition only (set STT_API_KEY)"}\n`);
});

const shutdown = async () => {
  stopWorker();
  server.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
