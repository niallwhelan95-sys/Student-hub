import { Hono } from "hono";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { memories, modules } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody, parseQuery, isUuid } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { MEMORY_CATEGORIES, saveMemory, updateMemoryContent } from "../memory/service";

export const memoryRoutes = new Hono<{ Variables: AppVariables }>();

const strip = <T extends { embedding?: unknown; embeddingModel?: unknown }>({ embedding: _e, embeddingModel: _m, ...rest }: T) => rest;

memoryRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = parseQuery(c, z.object({ status: z.enum(["active", "proposed", "archived", "all"]).optional() }));
  const conds = [eq(memories.userId, user.id)];
  if (!q.status) conds.push(ne(memories.status, "archived"));
  else if (q.status !== "all") conds.push(eq(memories.status, q.status));
  const list = await getDb().select().from(memories).where(and(...conds)).orderBy(desc(memories.pinned), desc(memories.updatedAt)).limit(1000);
  return c.json({ memories: list.map(strip) });
});

const Body = z.object({
  content: z.string().trim().min(3).max(1000),
  category: z.enum(MEMORY_CATEGORIES),
  moduleId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
  stability: z.enum(["stable", "temporary"]).optional(),
  sourceMessageId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

async function checkModule(userId: string, moduleId?: string | null) {
  if (!moduleId) return;
  const [m] = await getDb().select({ id: modules.id }).from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId)));
  if (!m) throw badRequest("Unknown module");
}

/** Explicit "remember this" — always active, marked as user-provided. */
memoryRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, Body);
  await checkModule(user.id, body.moduleId);
  const { memory, created } = await saveMemory({ ...body, userId: user.id, origin: "user", status: "active", confidence: 1 });
  return c.json({ memory: strip(memory), created }, created ? 201 : 200);
});

memoryRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Memory");
  const body = await parseBody(
    c,
    Body.partial().extend({ status: z.enum(["active", "proposed", "archived"]).optional() }).omit({ sourceMessageId: true, conversationId: true }),
  );
  await checkModule(user.id, body.moduleId);
  const updated = await updateMemoryContent(user.id, id, body);
  if (!updated) throw notFound("Memory");
  return c.json({ memory: strip(updated) });
});

memoryRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Memory");
  const [m] = await getDb().delete(memories).where(and(eq(memories.id, id), eq(memories.userId, user.id))).returning({ id: memories.id });
  if (!m) throw notFound("Memory");
  return c.json({ ok: true });
});
