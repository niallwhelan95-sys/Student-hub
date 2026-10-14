import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, rows } from "../db/client";
import { memories } from "../db/schema";
import { tryEmbed } from "../embeddings";
import { toOrTsQuery, vecLiteral, rrf } from "../retrieval/search";

export const MEMORY_CATEGORIES = ["profile", "preference", "module", "assignment", "general", "working"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type Memory = typeof memories.$inferSelect;

export type NewMemory = {
  userId: string;
  content: string;
  category: MemoryCategory;
  moduleId?: string | null;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  sourceDocumentId?: string | null;
  status?: "active" | "proposed";
  origin?: "extracted" | "user" | "onboarding";
  confidence?: number;
  stability?: "stable" | "temporary";
  expiresAt?: Date | null;
  pinned?: boolean;
};

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Save a memory unless an equivalent one already exists. Returns the stored (or existing)
 * memory and whether it was newly created.
 */
export async function saveMemory(m: NewMemory): Promise<{ memory: Memory; created: boolean }> {
  const db = getDb();
  const content = m.content.trim().slice(0, 1000);
  const emb = await tryEmbed([content], "document");

  // De-duplicate: identical normalised text, or a near-identical embedding, within the same scope.
  const scope = m.moduleId ? eq(memories.moduleId, m.moduleId) : sql`true`;
  const existing = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, m.userId), inArray(memories.status, ["active", "proposed"]), scope));
  const same = existing.find((e) => normalise(e.content) === normalise(content));
  if (same) return { memory: same, created: false };
  if (emb) {
    const [near] = await rows<{ id: string; sim: number }>(sql`
      SELECT id, 1 - (embedding <=> ${vecLiteral(emb.vectors[0])}::vector) AS sim FROM memories
      WHERE user_id = ${m.userId} AND status IN ('active','proposed') AND embedding_model = ${emb.model}
      ${m.moduleId ? sql`AND module_id = ${m.moduleId}` : sql``}
      ORDER BY embedding <=> ${vecLiteral(emb.vectors[0])}::vector LIMIT 1`);
    if (near && Number(near.sim) > 0.97) {
      const hit = existing.find((e) => e.id === near.id);
      if (hit) return { memory: hit, created: false };
    }
  }

  const [memory] = await db
    .insert(memories)
    .values({
      userId: m.userId,
      content,
      category: m.category,
      moduleId: m.moduleId ?? null,
      conversationId: m.conversationId ?? null,
      sourceMessageId: m.sourceMessageId ?? null,
      sourceDocumentId: m.sourceDocumentId ?? null,
      status: m.status ?? "active",
      origin: m.origin ?? "extracted",
      confidence: m.confidence ?? 0.8,
      stability: m.stability ?? "stable",
      expiresAt: m.expiresAt ?? null,
      pinned: m.pinned ?? false,
      embedding: emb?.vectors[0] ?? null,
      embeddingModel: emb?.model ?? null,
    })
    .returning();
  return { memory, created: true };
}

export async function updateMemoryContent(userId: string, id: string, patch: Partial<Pick<Memory, "content" | "category" | "moduleId" | "status" | "pinned" | "stability">>) {
  const db = getDb();
  const set: Partial<Memory> & { updatedAt: Date } = { ...patch, updatedAt: new Date() };
  if (patch.content) {
    const emb = await tryEmbed([patch.content], "document");
    set.embedding = emb?.vectors[0] ?? null;
    set.embeddingModel = emb?.model ?? null;
  }
  const [row] = await db
    .update(memories)
    .set(set)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning();
  return row ?? null;
}

export async function supersedeMemory(userId: string, oldId: string, newId: string) {
  await getDb()
    .update(memories)
    .set({ status: "archived", supersededBy: newId, updatedAt: new Date() })
    .where(and(eq(memories.id, oldId), eq(memories.userId, userId)));
}

/** Always-relevant memories: the student's profile and preferences, plus anything pinned. */
export async function coreMemories(userId: string, limit = 25): Promise<Memory[]> {
  return getDb()
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.status, "active"),
        or(inArray(memories.category, ["profile", "preference"]), eq(memories.pinned, true)),
      ),
    )
    .orderBy(desc(memories.pinned), desc(memories.updatedAt))
    .limit(limit);
}

export async function moduleMemories(userId: string, moduleId: string, limit = 15): Promise<Memory[]> {
  return getDb()
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.moduleId, moduleId), eq(memories.status, "active")))
    .orderBy(desc(memories.updatedAt))
    .limit(limit);
}

/** Hybrid (keyword + semantic) search over active memories. */
export async function searchMemories(
  userId: string,
  query: string,
  opts: { limit?: number; includeProposed?: boolean } = {},
): Promise<Memory[]> {
  const statuses = opts.includeProposed ? sql`('active','proposed')` : sql`('active')`;
  const lists: string[][] = [];
  const tsq = toOrTsQuery(query);
  if (tsq) {
    const kw = await rows<{ id: string }>(sql`
      SELECT id FROM memories, to_tsquery('english', ${tsq}) q
      WHERE user_id = ${userId} AND status IN ${statuses} AND ts @@ q
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY ts_rank_cd(ts, q, 32) DESC LIMIT 20`);
    lists.push(kw.map((r) => r.id));
  }
  const emb = await tryEmbed([query], "query");
  if (emb) {
    const v = vecLiteral(emb.vectors[0]);
    const sem = await rows<{ id: string; sim: number }>(sql`
      SELECT id, 1 - (embedding <=> ${v}::vector) AS sim FROM memories
      WHERE user_id = ${userId} AND status IN ${statuses} AND embedding_model = ${emb.model}
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY embedding <=> ${v}::vector LIMIT 20`);
    lists.push(sem.filter((r) => Number(r.sim) >= emb.floor).map((r) => r.id));
  }
  const ranked = [...rrf(lists).entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.limit ?? 8).map(([id]) => id);
  if (!ranked.length) return [];
  const found = await getDb().select().from(memories).where(inArray(memories.id, ranked));
  return ranked.map((id) => found.find((m) => m.id === id)!).filter(Boolean);
}
