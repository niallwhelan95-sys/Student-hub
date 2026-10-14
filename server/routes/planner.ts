import { Hono } from "hono";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { deadlines, modules, tasks } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody, parseQuery, isUuid } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";

export const plannerRoutes = new Hono<{ Variables: AppVariables }>();

async function checkModule(userId: string, moduleId?: string | null) {
  if (!moduleId) return;
  const [m] = await getDb().select({ id: modules.id }).from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId)));
  if (!m) throw badRequest("Unknown module");
}

// ── Deadlines ────────────────────────────────────────────────────────────────
plannerRoutes.get("/deadlines", async (c) => {
  const user = c.get("user");
  const q = parseQuery(c, z.object({ includeDone: z.enum(["true", "false"]).optional() }));
  const conds = [eq(deadlines.userId, user.id), ne(deadlines.status, "dismissed")];
  if (q.includeDone !== "true") conds.push(ne(deadlines.status, "done"));
  const list = await getDb().select().from(deadlines).where(and(...conds)).orderBy(asc(deadlines.dueAt));
  return c.json({ deadlines: list });
});

const DeadlineBody = z.object({
  title: z.string().trim().min(1).max(200),
  dueAt: z.coerce.date(),
  allDay: z.boolean().optional(),
  kind: z.enum(["assignment", "exam", "milestone", "other"]).optional(),
  moduleId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

plannerRoutes.post("/deadlines", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, DeadlineBody);
  await checkModule(user.id, body.moduleId);
  const [d] = await getDb().insert(deadlines).values({ ...body, userId: user.id, status: "confirmed" }).returning();
  return c.json({ deadline: d }, 201);
});

plannerRoutes.patch("/deadlines/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Deadline");
  const body = await parseBody(c, DeadlineBody.partial().extend({ status: z.enum(["suggested", "confirmed", "done", "dismissed"]).optional() }));
  await checkModule(user.id, body.moduleId);
  const [d] = await getDb().update(deadlines).set(body).where(and(eq(deadlines.id, id), eq(deadlines.userId, user.id))).returning();
  if (!d) throw notFound("Deadline");
  return c.json({ deadline: d });
});

plannerRoutes.delete("/deadlines/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Deadline");
  const [d] = await getDb().delete(deadlines).where(and(eq(deadlines.id, id), eq(deadlines.userId, user.id))).returning({ id: deadlines.id });
  if (!d) throw notFound("Deadline");
  return c.json({ ok: true });
});

// ── Tasks ────────────────────────────────────────────────────────────────────
plannerRoutes.get("/tasks", async (c) => {
  const user = c.get("user");
  const q = parseQuery(c, z.object({ includeDone: z.enum(["true", "false"]).optional() }));
  const conds = [eq(tasks.userId, user.id)];
  if (q.includeDone !== "true") conds.push(ne(tasks.status, "done"));
  const list = await getDb().select().from(tasks).where(and(...conds)).orderBy(asc(tasks.status), asc(tasks.dueAt), asc(tasks.createdAt));
  return c.json({ tasks: list });
});

const TaskBody = z.object({
  title: z.string().trim().min(1).max(300),
  details: z.string().max(5000).nullable().optional(),
  doneWhen: z.string().max(500).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  priority: z.enum(["essential", "optional"]).optional(),
  estimateMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
  moduleId: z.string().uuid().nullable().optional(),
  sourceMessageId: z.string().uuid().nullable().optional(),
});

plannerRoutes.post("/tasks", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, TaskBody);
  await checkModule(user.id, body.moduleId);
  const [t] = await getDb().insert(tasks).values({ ...body, userId: user.id }).returning();
  return c.json({ task: t }, 201);
});

plannerRoutes.patch("/tasks/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Task");
  const body = await parseBody(c, TaskBody.partial().extend({ status: z.enum(["todo", "doing", "done"]).optional() }));
  await checkModule(user.id, body.moduleId);
  const set = { ...body, completedAt: body.status === "done" ? new Date() : body.status ? null : undefined };
  const [t] = await getDb().update(tasks).set(set).where(and(eq(tasks.id, id), eq(tasks.userId, user.id))).returning();
  if (!t) throw notFound("Task");
  return c.json({ task: t });
});

plannerRoutes.delete("/tasks/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) throw notFound("Task");
  const [t] = await getDb().delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, user.id))).returning({ id: tasks.id });
  if (!t) throw notFound("Task");
  return c.json({ ok: true });
});
