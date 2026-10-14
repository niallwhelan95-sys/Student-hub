/**
 * Vercel entry point (zero-config Hono): this file's default export is deployed as the
 * function serving every non-static request. The built web app lives in `public/` and is
 * served by Vercel's CDN; `vercel.json` rewrites app routes to index.html (SPA).
 *
 * Local development and Docker use `server/index.ts` instead.
 */
import { createApp } from "./server/app";
import { initDb } from "./server/db/client";
import { kickJobs } from "./server/jobs/queue";

const app = createApp({
  prepare: async (c, next) => {
    try {
      await initDb(); // shared across concurrent first requests; runs migrations under an advisory lock
    } catch (err) {
      console.error("[vercel] database initialisation failed", err);
      return c.json({ error: err instanceof Error ? err.message : "Database unavailable", code: "db_unavailable" }, 503);
    }
    kickJobs(); // picks up retries / abandoned jobs via waitUntil
    await next();
  },
});

export default app;
