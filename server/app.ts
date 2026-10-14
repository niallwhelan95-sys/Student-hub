import fs from "node:fs";
import path from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { ZodError } from "zod";
import { AppError } from "./lib/errors";
import { requireClientHeader, requireUser, type AppVariables } from "./auth/middleware";
import { authRoutes } from "./routes/auth";
import { conversationRoutes } from "./routes/conversations";
import { documentRoutes } from "./routes/documents";
import { moduleRoutes } from "./routes/modules";
import { memoryRoutes } from "./routes/memory";
import { writingRoutes } from "./routes/writing";
import { speechRoutes } from "./routes/speech";
import { profileRoutes } from "./routes/profile";
import { plannerRoutes } from "./routes/planner";
import { dashboardRoutes } from "./routes/dashboard";
import { searchRoutes } from "./routes/search";
import { accountRoutes } from "./routes/account";
// Job handlers register themselves on import.
import "./documents/service";
import "./chat/afterTurn";
import "./writing/service";

export function createApp(opts: { staticDir?: string; prepare?: MiddlewareHandler } = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  // Serverless hosts use this to initialise the database / kick background work per request.
  if (opts.prepare) app.use("*", opts.prepare);

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        // Vercel Blob client uploads go straight from the browser to Blob storage.
        connectSrc: ["'self'", "https://vercel.com", "https://*.vercel-storage.com"],
        mediaSrc: ["'self'", "blob:"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      permissionsPolicy: { microphone: ["self"], camera: [], geolocation: [] },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? "Invalid input", code: "bad_request" }, 400);
    console.error("[server] unhandled error", err);
    return c.json({ error: "Something went wrong on the server. Your data is safe — please try again.", code: "internal" }, 500);
  });

  const api = new Hono<{ Variables: AppVariables }>();
  api.use("*", requireClientHeader);
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/auth", authRoutes);

  const authed = new Hono<{ Variables: AppVariables }>();
  authed.use("*", requireUser);
  authed.route("/conversations", conversationRoutes);
  authed.route("/documents", documentRoutes);
  authed.route("/modules", moduleRoutes);
  authed.route("/memory", memoryRoutes);
  authed.route("/writing", writingRoutes);
  authed.route("/speech", speechRoutes);
  authed.route("/profile", profileRoutes);
  authed.route("/planner", plannerRoutes);
  authed.route("/dashboard", dashboardRoutes);
  authed.route("/search", searchRoutes);
  authed.route("/account", accountRoutes);
  api.route("/", authed);

  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "Not found", code: "not_found" }, 404));

  // Production: serve the built SPA with history-API fallback.
  const staticDir = opts.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
    const indexHtml = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
    const rel = path.relative(process.cwd(), staticDir) || ".";
    app.use("/*", serveStatic({ root: rel }));
    app.get("*", (c) => c.html(indexHtml));
  }

  return app;
}
