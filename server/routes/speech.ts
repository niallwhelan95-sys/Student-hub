import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { modules } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody } from "../lib/validate";
import { AppError, badRequest, tooMany } from "../lib/errors";
import { rateLimit } from "../lib/ratelimit";
import { serverTranscriptionAvailable, tidyDictation, transcribe } from "../speech/service";

export const speechRoutes = new Hono<{ Variables: AppVariables }>();

speechRoutes.get("/status", (c) => c.json({ serverTranscription: serverTranscriptionAvailable() }));

speechRoutes.post(
  "/transcribe",
  bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: () => {
      throw new AppError(413, "Recording is too large.", "too_large");
    },
  }),
  async (c) => {
    const user = c.get("user");
    if (!rateLimit(`stt:${user.id}`, 30, 60_000)) throw tooMany();
    const form = await c.req.parseBody();
    const audio = form.audio;
    if (!audio || typeof audio === "string") throw badRequest("No audio provided");
    // Module names/codes help the recogniser spell course vocabulary correctly.
    const mods = await getDb().select({ code: modules.code, name: modules.name }).from(modules).where(eq(modules.userId, user.id));
    const hint = mods.map((m) => [m.code, m.name].filter(Boolean).join(" ")).join(", ");
    const result = await transcribe(Buffer.from(await audio.arrayBuffer()), audio.type, hint ? `University modules: ${hint}.` : undefined);
    return c.json(result);
  },
);

speechRoutes.post("/tidy", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, z.object({ text: z.string().min(1).max(50_000), mode: z.enum(["light", "academic"]) }));
  return c.json({ text: await tidyDictation(body.text, body.mode, user.id) });
});
