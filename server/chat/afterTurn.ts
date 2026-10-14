import { and, asc, eq } from "drizzle-orm";
import { provisionalTitle } from "./service";
import { z } from "zod";
import { getDb } from "../db/client";
import { conversations, messages, modules } from "../db/schema";
import { getAI } from "../ai";
import { AFTER_TURN_SYSTEM } from "../ai/prompts";
import { registerJob } from "../jobs/queue";
import { saveMemory, searchMemories, supersedeMemory } from "../memory/service";
import { truncate } from "../lib/text";

const AfterTurnSchema = z.object({
  title: z.string().nullable(),
  workingContext: z
    .object({
      goal: z.string(),
      done: z.array(z.string()),
      remaining: z.array(z.string()),
      next: z.string(),
    })
    .nullable(),
  memories: z.array(
    z.object({
      content: z.string(),
      category: z.enum(["profile", "preference", "module", "assignment", "general"]),
      module: z.string().nullable().describe("Module code or name this belongs to, exactly as known, or null"),
      stability: z.enum(["stable", "temporary"]),
      confidence: z.number().describe("0 to 1"),
      explicitRequest: z.boolean(),
      supersedes: z.string().nullable().describe("id of an existing memory this replaces, or null"),
    }),
  ),
});

const GENERIC_TITLE = /^(new conversation|untitled|chat)$/i;

/**
 * After each completed exchange: title the conversation, refresh its working context, and
 * extract memories. Clear, explicit statements become active memories; anything less certain
 * is stored as "proposed" for the student to confirm in the Memory page.
 */
export async function afterTurn(conversationId: string, userMessageId: string, assistantMessageId: string): Promise<void> {
  const ai = getAI();
  if (!ai.configured) return;
  const db = getDb();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  const [userMsg] = await db.select().from(messages).where(eq(messages.id, userMessageId));
  const [assistantMsg] = await db.select().from(messages).where(eq(messages.id, assistantMessageId));
  if (!conv || !userMsg || !assistantMsg || userMsg.deletedAt) return;

  const userModules = await db.select().from(modules).where(eq(modules.userId, conv.userId));
  const existing = await searchMemories(conv.userId, userMsg.content, { limit: 12, includeProposed: true });

  const result = await ai.structured(
    {
      purpose: "memory.after_turn",
      userId: conv.userId,
      tier: "background",
      maxTokens: 3000,
      system: [{ text: AFTER_TURN_SYSTEM }],
      messages: [
        {
          role: "user",
          content: `Current title: ${conv.title}
Conversation module: ${userModules.find((m) => m.id === conv.moduleId)?.name ?? "none"}
Student's modules: ${userModules.map((m) => [m.code, m.name].filter(Boolean).join(" ")).join("; ") || "none"}
Previous working context: ${JSON.stringify(conv.workingContext ?? {})}

Existing memories:
${existing.map((m) => `- id=${m.id} [${m.category}${m.status === "proposed" ? ", unconfirmed" : ""}] ${m.content}`).join("\n") || "(none)"}

<exchange>
<student>${truncate(userMsg.content, 8000)}</student>
<assistant>${truncate(assistantMsg.content, 6000)}</assistant>
</exchange>`,
        },
      ],
    },
    AfterTurnSchema,
  );
  if (!result) return;

  const patch: Partial<typeof conversations.$inferInsert> = {};
  // Replace generic or provisional (first-message) titles, never one the student set themselves.
  const [firstUser] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, conv.id), eq(messages.role, "user")))
    .orderBy(asc(messages.createdAt))
    .limit(1);
  const provisional = firstUser ? provisionalTitle(firstUser.content) : null;
  if (result.title && (GENERIC_TITLE.test(conv.title.trim()) || conv.title === provisional)) patch.title = result.title.slice(0, 80);
  if (result.workingContext) patch.workingContext = { ...result.workingContext, updatedAt: new Date().toISOString() };
  if (Object.keys(patch).length) await db.update(conversations).set(patch).where(eq(conversations.id, conv.id));

  const findModule = (ref: string | null) => {
    if (!ref) return conv.moduleId;
    const r = ref.toLowerCase().replace(/\s+/g, "");
    return (
      userModules.find((m) => m.code && m.code.toLowerCase().replace(/\s+/g, "") === r)?.id ??
      userModules.find((m) => m.name.toLowerCase().replace(/\s+/g, "") === r)?.id ??
      userModules.find((m) => r.includes(m.name.toLowerCase().replace(/\s+/g, "")))?.id ??
      null
    );
  };

  for (const m of result.memories.slice(0, 6)) {
    if (!m.content.trim()) continue;
    const confident = m.explicitRequest || (m.confidence >= 0.8 && m.stability === "stable");
    const { memory, created } = await saveMemory({
      userId: conv.userId,
      content: m.content,
      category: m.category,
      moduleId: findModule(m.module),
      conversationId: conv.id,
      sourceMessageId: userMsg.id,
      status: confident ? "active" : "proposed",
      origin: "extracted",
      confidence: Math.max(0, Math.min(1, m.confidence)),
      stability: m.stability,
      expiresAt: m.stability === "temporary" ? new Date(Date.now() + 14 * 86_400_000) : null,
    });
    if (created && m.supersedes && existing.some((e) => e.id === m.supersedes) && confident) {
      await supersedeMemory(conv.userId, m.supersedes, memory.id);
    }
  }
}

registerJob("conversation.after_turn", {
  run: async (p) => afterTurn(String(p.conversationId), String(p.userMessageId), String(p.assistantMessageId)),
});
