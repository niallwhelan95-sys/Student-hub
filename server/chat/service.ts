import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { conversations, documents, messages, type Citation } from "../db/schema";
import { getAI, describeAIError, AIUnavailableError, type Turn } from "../ai";
import { CHAT_SYSTEM_PROMPT } from "../ai/prompts";
import { enqueue } from "../jobs/queue";
import { estimateTokens, truncate } from "../lib/text";
import { badRequest, notFound } from "../lib/errors";
import { buildContext, usedCitations, type BuiltContext } from "./context";

export type Message = typeof messages.$inferSelect;

export type ChatEvent =
  | { type: "user_message"; message: Message }
  | { type: "context"; sources: number; memories: number; writingProfile: boolean; pending: string[] }
  | { type: "assistant_start"; id: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: Message }
  | { type: "error"; error: string; message?: Message };

const HISTORY_TOKEN_BUDGET = 40_000;

/** Provisional title from the first message, so the sidebar is useful immediately (the AI may refine it). */
export function provisionalTitle(text: string): string {
  const firstLine = text.replace(/\s+/g, " ").trim();
  if (firstLine.length <= 60) return firstLine;
  const cut = firstLine.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

export async function getOwnedConversation(userId: string, conversationId: string) {
  const [conv] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!conv) throw notFound("Conversation");
  return conv;
}

function liveMessages(conversationId: string) {
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(asc(messages.createdAt));
}

/** Most recent turns that fit the budget, starting on a user turn (the API requires it). */
export function selectHistory(history: Message[], budget = HISTORY_TOKEN_BUDGET): Turn[] {
  const usable = history.filter((m) => m.status !== "error" && m.content.trim());
  const picked: Message[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const t = estimateTokens(usable[i].content);
    if (used + t > budget) break;
    used += t;
    picked.unshift(usable[i]);
  }
  while (picked.length && picked[0].role !== "user") picked.shift();
  return picked.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

function offlineAnswer(ctx: BuiltContext): string {
  const lines = [
    "**No AI model is connected yet**, so I can't write an answer. Margin is still searching your library — here's what matched your message:",
    "",
  ];
  const docs = [...ctx.citations.values()].filter((c) => c.kind === "document").slice(0, 6);
  if (docs.length) for (const c of docs) lines.push(`- [${c.ref}] **${c.title}**${c.location ? ` · ${c.location}` : ""} — ${truncate(c.excerpt.replace(/\s+/g, " "), 220)}`);
  else lines.push("- Nothing in your uploaded documents matched.");
  const mems = [...ctx.citations.values()].filter((c) => c.kind === "memory").slice(0, 4);
  if (mems.length) {
    lines.push("", "Related things you've told me:");
    for (const c of mems) lines.push(`- [${c.ref}] ${c.excerpt}`);
  }
  if (ctx.pendingDocuments.length) lines.push("", `Still processing: ${ctx.pendingDocuments.join(", ")}.`);
  lines.push("", "_To enable answers, add `ANTHROPIC_API_KEY` to your `.env` file and restart the server._");
  return lines.join("\n");
}

export async function runChatTurn(params: {
  userId: string;
  conversationId: string;
  content?: string;
  attachmentIds?: string[];
  inputMode?: "text" | "voice";
  editMessageId?: string;
  regenerate?: boolean;
  signal?: AbortSignal;
  onEvent: (e: ChatEvent) => void | Promise<void>;
}): Promise<void> {
  const { userId, onEvent } = params;
  const db = getDb();
  const conversation = await getOwnedConversation(userId, params.conversationId);
  const all = await liveMessages(conversation.id);

  // ── Decide which user message we are answering ───────────────────────────
  let userMessage: Message;
  if (params.regenerate) {
    const lastUser = [...all].reverse().find((m) => m.role === "user");
    if (!lastUser) throw badRequest("Nothing to regenerate");
    const after = all.filter((m) => m.createdAt > lastUser.createdAt);
    if (after.length) await db.update(messages).set({ deletedAt: new Date() }).where(inArray(messages.id, after.map((m) => m.id)));
    userMessage = lastUser;
  } else {
    const text = (params.content ?? "").trim();
    if (!text) throw badRequest("Message is empty");
    if (text.length > 100_000) throw badRequest("Message is too long");
    let attachments = [...new Set(params.attachmentIds ?? [])].slice(0, 10);
    if (attachments.length) {
      const owned = await db
        .select({ id: documents.id, conversationId: documents.conversationId })
        .from(documents)
        .where(and(eq(documents.userId, userId), inArray(documents.id, attachments)));
      attachments = owned.map((d) => d.id);
      const unlinked = owned.filter((d) => !d.conversationId).map((d) => d.id);
      if (unlinked.length) await db.update(documents).set({ conversationId: conversation.id }).where(inArray(documents.id, unlinked));
    }
    if (params.editMessageId) {
      const target = all.find((m) => m.id === params.editMessageId && m.role === "user");
      if (!target) throw notFound("Message");
      if (!attachments.length) attachments = target.attachments;
      await db
        .update(messages)
        .set({ deletedAt: new Date() })
        .where(and(eq(messages.conversationId, conversation.id), gte(messages.createdAt, target.createdAt), isNull(messages.deletedAt)));
    }
    [userMessage] = await db
      .insert(messages)
      .values({ conversationId: conversation.id, userId, role: "user", content: text, attachments, inputMode: params.inputMode ?? "text" })
      .returning();
  }
  await onEvent({ type: "user_message", message: userMessage });
  if (conversation.title === "New conversation" && !all.some((m) => m.role === "user" && m.id !== userMessage.id)) {
    await db.update(conversations).set({ title: provisionalTitle(userMessage.content) }).where(eq(conversations.id, conversation.id));
  }

  // ── Assemble context ──────────────────────────────────────────────────────
  const fresh = await liveMessages(conversation.id);
  const before = fresh.filter((m) => m.createdAt < userMessage.createdAt);
  const previousUserText = [...before].reverse().find((m) => m.role === "user")?.content ?? null;
  const conversationAttachments = [...new Set(fresh.flatMap((m) => m.attachments))].slice(-10);
  const ctx = await buildContext({
    userId,
    conversation,
    query: userMessage.content,
    previousUserText,
    attachmentIds: [...new Set([...userMessage.attachments, ...conversationAttachments])],
  });
  await onEvent({
    type: "context",
    sources: ctx.passages.length,
    memories: ctx.memories.length,
    writingProfile: ctx.usedWritingProfile,
    pending: ctx.pendingDocuments,
  });

  const [assistant] = await db
    .insert(messages)
    .values({ conversationId: conversation.id, userId, role: "assistant", content: "", status: "streaming" })
    .returning();
  await onEvent({ type: "assistant_start", id: assistant.id });

  const finish = async (patch: Partial<Message> & { content: string; status: string }, citations: Citation[]) => {
    const [saved] = await db
      .update(messages)
      .set({ ...patch, citations })
      .where(eq(messages.id, assistant.id))
      .returning();
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
    return saved;
  };

  const ai = getAI();
  if (!ai.configured) {
    const text = offlineAnswer(ctx);
    await onEvent({ type: "delta", text });
    const saved = await finish({ content: text, status: "complete", model: "offline" }, usedCitations(text, ctx.citations));
    await onEvent({ type: "done", message: saved });
    return;
  }

  const history = selectHistory(before);
  if (history.length) history[history.length - 1].cache = true;
  const turns: Turn[] = [...history, { role: "user", content: `${ctx.block}\n\n${userMessage.content}` }];

  let streamed = "";
  try {
    const result = await ai.stream(
      {
        purpose: "chat",
        userId,
        tier: "chat",
        system: [{ text: CHAT_SYSTEM_PROMPT, cache: true }],
        messages: turns,
        signal: params.signal,
      },
      (delta) => {
        streamed += delta;
        void onEvent({ type: "delta", text: delta });
      },
    );
    let text = result.text || streamed;
    let status = "complete";
    if (result.aborted) status = "stopped";
    if (result.refused) {
      status = text.trim() ? "complete" : "error";
      text = text.trim() ? text : "I can't help with that request.";
    }
    if (result.stopReason === "max_tokens") text += "\n\n_(Response was cut off because it reached the length limit — ask me to continue.)_";
    const saved = await finish(
      { content: text, status, model: result.model, usage: result.usage, error: result.refused ? "refused" : null },
      usedCitations(text, ctx.citations),
    );
    await onEvent({ type: "done", message: saved });
    if (!result.aborted && text.trim()) {
      await enqueue("conversation.after_turn", { conversationId: conversation.id, userMessageId: userMessage.id, assistantMessageId: assistant.id }, { userId, maxAttempts: 2 });
    }
  } catch (err) {
    const description = err instanceof AIUnavailableError ? err.message : describeAIError(err);
    const saved = await finish({ content: streamed, status: "error", error: description }, usedCitations(streamed, ctx.citations));
    await onEvent({ type: "error", error: description, message: saved });
  }
}

/** Conversations attached to a module see that module's material first; keep counts cheap. */
export async function conversationMessageCount(conversationId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)));
  return Number(r?.n ?? 0);
}
