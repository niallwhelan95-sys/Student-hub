import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, rows } from "../db/client";
import {
  conversations,
  deadlines,
  documents,
  memories,
  messages,
  modules,
  studentProfiles,
  tasks,
  users,
  writingProfiles,
  writingSamples,
} from "../db/schema";
import { clearSessionCookie, type AppVariables } from "../auth/middleware";
import { verifyPassword } from "../auth/password";
import { deleteUserSessions } from "../auth/sessions";
import { parseBody } from "../lib/validate";
import { AppError } from "../lib/errors";
import { getStorage } from "../storage";

export const accountRoutes = new Hono<{ Variables: AppVariables }>();

/** Full export of the student's data as JSON (original files are downloadable individually). */
accountRoutes.get("/export", async (c) => {
  const user = c.get("user");
  const db = getDb();
  const strip = <T extends Record<string, unknown>>(list: T[]) => list.map(({ embedding: _e, embeddingModel: _m, ...r }) => r);
  const [profile, mods, convs, msgs, docs, mems, dls, tks, samples, profiles] = await Promise.all([
    db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id)),
    db.select().from(modules).where(eq(modules.userId, user.id)),
    db.select().from(conversations).where(eq(conversations.userId, user.id)),
    db.select().from(messages).where(eq(messages.userId, user.id)),
    db.select().from(documents).where(eq(documents.userId, user.id)),
    db.select().from(memories).where(eq(memories.userId, user.id)),
    db.select().from(deadlines).where(eq(deadlines.userId, user.id)),
    db.select().from(tasks).where(eq(tasks.userId, user.id)),
    db.select().from(writingSamples).where(eq(writingSamples.userId, user.id)),
    db.select().from(writingProfiles).where(eq(writingProfiles.userId, user.id)),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { email: user.email, displayName: user.displayName },
    profile: profile[0] ?? null,
    modules: mods,
    conversations: convs,
    messages: msgs,
    documents: docs.map(({ storageKey: _k, ...d }) => d),
    memories: strip(mems),
    deadlines: dls,
    tasks: tks,
    writingSamples: samples,
    writingProfiles: profiles,
  };
  return c.body(JSON.stringify(payload, null, 2), 200, {
    "content-type": "application/json",
    "content-disposition": `attachment; filename="margin-export-${new Date().toISOString().slice(0, 10)}.json"`,
  });
});

accountRoutes.get("/usage", async (c) => {
  const user = c.get("user");
  const usage = await rows<{ purpose: string; model: string; calls: number; input: number; output: number; cache_read: number }>(sql`
    SELECT purpose, model, count(*)::int AS calls, sum(input_tokens)::int AS input, sum(output_tokens)::int AS output,
      sum(cache_read_tokens)::int AS cache_read
    FROM ai_usage WHERE user_id = ${user.id} AND created_at > now() - interval '30 days'
    GROUP BY purpose, model ORDER BY sum(input_tokens) DESC`);
  return c.json({ usage });
});

/** Permanently delete the account, all data and all uploaded files. Requires the password. */
accountRoutes.delete("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, z.object({ password: z.string().min(1), confirm: z.literal("DELETE") }));
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(body.password, row.passwordHash))) throw new AppError(401, "Password is incorrect.", "invalid_credentials");
  const files = await db.select({ key: documents.storageKey }).from(documents).where(eq(documents.userId, user.id));
  await deleteUserSessions(user.id);
  await db.delete(users).where(eq(users.id, user.id)); // cascades to all owned rows
  for (const f of files) await getStorage().remove(f.key).catch(() => {});
  clearSessionCookie(c);
  return c.json({ ok: true });
});
