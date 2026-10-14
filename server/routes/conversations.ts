import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { conversations, documents, messages, modules } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody, parseQuery } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { getOwnedConversation, runChatTurn } from "../chat/service";
import { rateLimit } from "../lib/ratelimit";
import { tooMany } from "../lib/errors";

export const conversationRoutes = new Hono<{ Variables: AppVariables }>();

const KINDS = ["general", "module", "assignment", "writing", "exam", "checkin"] as const;

conversationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = parseQuery(
    c,
    z.object({ archived: z.enum(["true", "false"]).optional(), moduleId: z.string().uuid().optional(), q: z.string().max(200).optional() }),
  );
  const conds = [eq(conversations.userId, user.id), eq(conversations.archived, q.archived === "true")];
  if (q.moduleId) conds.push(eq(conversations.moduleId, q.moduleId));
  if (q.q) conds.push(sql`(${conversations.title} ILIKE ${"%" + q.q + "%"} OR ${conversations.id} IN (SELECT conversation_id FROM messages WHERE user_id = ${user.id} AND deleted_at IS NULL AND content ILIKE ${"%" + q.q + "%"}))`);
  const list = await getDb()
    .select({
      id: conversations.id,
      title: conversations.title,
      kind: conversations.kind,
      moduleId: conversations.moduleId,
      pinned: conversations.pinned,
      archived: conversations.archived,
      updatedAt: conversations.updatedAt,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(...conds))
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
    .limit(200);
  return c.json({ conversations: list });
});

conversationRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(
    c,
    z.object({ title: z.string().trim().max(120).optional(), moduleId: z.string().uuid().nullable().optional(), kind: z.enum(KINDS).optional() }),
  );
  const db = getDb();
  if (body.moduleId) {
    const [m] = await db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, body.moduleId), eq(modules.userId, user.id)));
    if (!m) throw badRequest("Unknown module");
  }
  const [conv] = await db
    .insert(conversations)
    .values({
      userId: user.id,
      title: body.title || "New conversation",
      moduleId: body.moduleId ?? null,
      kind: body.kind ?? (body.moduleId ? "module" : "general"),
    })
    .returning();
  return c.json({ conversation: conv }, 201);
});

conversationRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const conv = await getOwnedConversation(user.id, c.req.param("id"));
  const db = getDb();
  const list = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
    .orderBy(asc(messages.createdAt));
  const attachmentIds = [...new Set(list.flatMap((m) => m.attachments))];
  const docs = attachmentIds.length
    ? await db
        .select({ id: documents.id, filename: documents.filename, status: documents.status, statusDetail: documents.statusDetail, mimeType: documents.mimeType, kind: documents.kind })
        .from(documents)
        .where(and(eq(documents.userId, user.id), sql`${documents.id} IN (${sql.join(attachmentIds.map((id) => sql`${id}`), sql`, `)})`))
    : [];
  return c.json({ conversation: conv, messages: list, documents: docs });
});

conversationRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const conv = await getOwnedConversation(user.id, c.req.param("id"));
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().min(1).max(120).optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      moduleId: z.string().uuid().nullable().optional(),
      kind: z.enum(KINDS).optional(),
    }),
  );
  if (body.moduleId) {
    const [m] = await getDb().select({ id: modules.id }).from(modules).where(and(eq(modules.id, body.moduleId), eq(modules.userId, user.id)));
    if (!m) throw badRequest("Unknown module");
  }
  const [updated] = await getDb().update(conversations).set(body).where(eq(conversations.id, conv.id)).returning();
  return c.json({ conversation: updated });
});

conversationRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const conv = await getOwnedConversation(user.id, c.req.param("id"));
  await getDb().delete(conversations).where(eq(conversations.id, conv.id));
  return c.json({ ok: true });
});

const SendBody = z.object({
  content: z.string().max(100_000).optional(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  inputMode: z.enum(["text", "voice"]).optional(),
  editMessageId: z.string().uuid().optional(),
  regenerate: z.boolean().optional(),
});

/** Send a message (or edit / regenerate) and stream the reply as Server-Sent Events. */
conversationRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  if (!rateLimit(`chat:${user.id}`, 30, 60_000)) throw tooMany();
  const body = await parseBody(c, SendBody);
  if (!body.regenerate && !body.content?.trim()) throw badRequest("Message is empty");
  const conversationId = c.req.param("id");
  await getOwnedConversation(user.id, conversationId);

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      await runChatTurn({
        userId: user.id,
        conversationId,
        content: body.content,
        attachmentIds: body.attachmentIds,
        inputMode: body.inputMode,
        editMessageId: body.editMessageId,
        regenerate: body.regenerate,
        signal: abort.signal,
        onEvent: async (e) => {
          if (stream.aborted || stream.closed) return;
          await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (!stream.aborted) await stream.writeSSE({ event: "error", data: JSON.stringify({ type: "error", error: message }) });
    }
  });
});

/** Remove a single message from the visible history (soft delete). */
conversationRoutes.delete("/:id/messages/:messageId", async (c) => {
  const user = c.get("user");
  const conv = await getOwnedConversation(user.id, c.req.param("id"));
  const [m] = await getDb()
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(and(eq(messages.id, c.req.param("messageId")), eq(messages.conversationId, conv.id)))
    .returning({ id: messages.id });
  if (!m) throw notFound("Message");
  return c.json({ ok: true });
});
