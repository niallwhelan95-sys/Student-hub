import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { rows } from "../db/client";
import type { AppVariables } from "../auth/middleware";
import { parseQuery } from "../lib/validate";
import { searchPassages, toOrTsQuery } from "../retrieval/search";
import { searchMemories } from "../memory/service";
import { truncate } from "../lib/text";

export const searchRoutes = new Hono<{ Variables: AppVariables }>();

/** Global search across documents, conversations and memories. */
searchRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = parseQuery(
    c,
    z.object({
      q: z.string().trim().min(1).max(300),
      type: z.enum(["all", "documents", "conversations", "memories"]).optional(),
      moduleId: z.string().uuid().optional(),
    }),
  );
  const type = q.type ?? "all";
  const tsq = toOrTsQuery(q.q);

  const [passages, convs, mems] = await Promise.all([
    type === "all" || type === "documents"
      ? searchPassages(user.id, q.q, { limit: 12, moduleIds: q.moduleId ? [q.moduleId] : undefined, perDocument: 3 })
      : Promise.resolve([]),
    (type === "all" || type === "conversations") && tsq
      ? rows<{ message_id: string; conversation_id: string; title: string; role: string; snippet: string; created_at: string }>(sql`
          SELECT m.id AS message_id, m.conversation_id, c.title, m.role, m.created_at,
            ts_headline('english', m.content, to_tsquery('english', ${tsq}), 'MaxWords=30, MinWords=12, StartSel=«, StopSel=»') AS snippet
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE m.user_id = ${user.id} AND m.deleted_at IS NULL AND m.ts @@ to_tsquery('english', ${tsq})
            ${q.moduleId ? sql`AND c.module_id = ${q.moduleId}` : sql``}
          ORDER BY ts_rank_cd(m.ts, to_tsquery('english', ${tsq}), 32) DESC LIMIT 12`)
      : Promise.resolve([]),
    type === "all" || type === "memories" ? searchMemories(user.id, q.q, { limit: 8, includeProposed: true }) : Promise.resolve([]),
  ]);

  return c.json({
    documents: passages.map((p) => ({
      sectionId: p.sectionId,
      documentId: p.documentId,
      filename: p.filename,
      title: p.documentTitle,
      location: p.location,
      moduleId: p.moduleId,
      snippet: truncate(p.content, 280),
    })),
    conversations: convs.map((r) => ({
      messageId: r.message_id,
      conversationId: r.conversation_id,
      title: r.title,
      role: r.role,
      snippet: r.snippet,
      createdAt: r.created_at,
    })),
    memories: mems.map((m) => ({ id: m.id, content: m.content, category: m.category, status: m.status, moduleId: m.moduleId })),
  });
});
