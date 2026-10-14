import { sql, type SQL } from "drizzle-orm";
import { rows } from "../db/client";
import { tryEmbed } from "../embeddings";

export type Passage = {
  sectionId: string;
  documentId: string;
  filename: string;
  documentTitle: string | null;
  documentKind: string;
  moduleId: string | null;
  location: string | null;
  page: number | null;
  heading: string | null;
  content: string;
  score: number;
  matchedBy: ("keyword" | "semantic" | "attached")[];
};

const STOPWORDS = new Set(
  "a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our please should so tell that the their them then there these they this to us was we were what when where which who why will with would you your about any some".split(
    " ",
  ),
);

/** Build an OR tsquery from free text so natural questions match partially rather than requiring every word. */
export function toOrTsQuery(text: string): string | null {
  const tokens = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((t) => !STOPWORDS.has(t)))].slice(0, 24);
  return tokens.length ? tokens.join(" | ") : null;
}

export const vecLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

/** Reciprocal-rank fusion of several ranked id lists. */
export function rrf(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  return scores;
}

type SectionRow = {
  id: string;
  document_id: string;
  filename: string;
  doc_title: string | null;
  doc_kind: string;
  module_id: string | null;
  location_label: string | null;
  page_start: number | null;
  heading: string | null;
  content: string;
  rank: number;
};

const SECTION_COLUMNS = sql`s.id, s.document_id, d.filename, d.metadata->>'title' AS doc_title, d.kind AS doc_kind,
  s.module_id, s.location_label, s.page_start, s.heading, s.content`;

export type SearchOptions = {
  limit?: number;
  /** Restrict to these modules. */
  moduleIds?: string[];
  /** Results from this module are boosted (but other modules still appear when relevant). */
  preferModuleId?: string | null;
  /** Restrict to these documents. */
  documentIds?: string[];
  /** Max passages from any single document, to keep results diverse. */
  perDocument?: number;
};

/**
 * Hybrid passage search over the student's library: Postgres full-text search and vector
 * similarity, fused with reciprocal-rank fusion. Semantic-only matches below the embedder's
 * relevance floor are discarded so unrelated material is not pulled into answers.
 */
export async function searchPassages(userId: string, query: string, opts: SearchOptions = {}): Promise<Passage[]> {
  const limit = opts.limit ?? 8;
  const filters: SQL[] = [sql`s.user_id = ${userId}`, sql`d.status IN ('ready', 'partial')`];
  if (opts.moduleIds?.length) filters.push(sql`s.module_id IN (${sql.join(opts.moduleIds.map((m) => sql`${m}`), sql`, `)})`);
  if (opts.documentIds?.length) filters.push(sql`s.document_id IN (${sql.join(opts.documentIds.map((m) => sql`${m}`), sql`, `)})`);
  const where = sql.join(filters, sql` AND `);

  const byId = new Map<string, SectionRow>();
  const matched = new Map<string, Set<"keyword" | "semantic">>();
  const mark = (id: string, how: "keyword" | "semantic") => {
    if (!matched.has(id)) matched.set(id, new Set());
    matched.get(id)!.add(how);
  };

  const lists: string[][] = [];
  const tsq = toOrTsQuery(query);
  if (tsq) {
    const kw = await rows<SectionRow>(sql`
      SELECT ${SECTION_COLUMNS}, ts_rank_cd(s.ts, q, 32) AS rank
      FROM document_sections s JOIN documents d ON d.id = s.document_id, to_tsquery('english', ${tsq}) q
      WHERE ${where} AND s.ts @@ q
      ORDER BY rank DESC LIMIT 40`);
    kw.forEach((r) => {
      byId.set(r.id, r);
      mark(r.id, "keyword");
    });
    lists.push(kw.map((r) => r.id));
  }

  const emb = await tryEmbed([query], "query");
  if (emb) {
    const v = vecLiteral(emb.vectors[0]);
    const sem = await rows<SectionRow>(sql`
      SELECT ${SECTION_COLUMNS}, 1 - (s.embedding <=> ${v}::vector) AS rank
      FROM document_sections s JOIN documents d ON d.id = s.document_id
      WHERE ${where} AND s.embedding IS NOT NULL AND s.embedding_model = ${emb.model}
      ORDER BY s.embedding <=> ${v}::vector LIMIT 40`);
    const relevant = sem.filter((r) => Number(r.rank) >= emb.floor || matched.has(r.id));
    relevant.forEach((r) => {
      if (!byId.has(r.id)) byId.set(r.id, r);
      mark(r.id, "semantic");
    });
    lists.push(relevant.map((r) => r.id));
  }

  const fused = rrf(lists);
  const scored = [...fused.entries()]
    .map(([id, score]) => {
      const r = byId.get(id)!;
      const boost = opts.preferModuleId && r.module_id === opts.preferModuleId ? 1.35 : 1;
      return { r, score: score * boost };
    })
    .sort((a, b) => b.score - a.score);

  const perDoc = new Map<string, number>();
  const out: Passage[] = [];
  for (const { r, score } of scored) {
    const n = perDoc.get(r.document_id) ?? 0;
    if (n >= (opts.perDocument ?? 4)) continue;
    perDoc.set(r.document_id, n + 1);
    out.push(toPassage(r, score, [...(matched.get(r.id) ?? [])]));
    if (out.length >= limit) break;
  }
  return out;
}

function toPassage(r: SectionRow, score: number, matchedBy: Passage["matchedBy"]): Passage {
  return {
    sectionId: r.id,
    documentId: r.document_id,
    filename: r.filename,
    documentTitle: r.doc_title,
    documentKind: r.doc_kind,
    moduleId: r.module_id,
    location: r.location_label,
    page: r.page_start,
    heading: r.heading,
    content: r.content,
    score,
    matchedBy,
  };
}

/** All passages of the given documents in order (for small attached files that fit in context whole). */
export async function documentPassages(userId: string, documentIds: string[], maxTokens: number): Promise<Passage[]> {
  if (!documentIds.length) return [];
  const all = await rows<SectionRow & { token_estimate: number }>(sql`
    SELECT ${SECTION_COLUMNS}, 1 AS rank, s.token_estimate
    FROM document_sections s JOIN documents d ON d.id = s.document_id
    WHERE s.user_id = ${userId} AND s.document_id IN (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY s.document_id, s.ordinal`);
  const out: Passage[] = [];
  let used = 0;
  for (const r of all) {
    if (used + r.token_estimate > maxTokens) break;
    used += r.token_estimate;
    out.push(toPassage(r, 1, ["attached"]));
  }
  return out;
}

export async function documentTokenTotals(userId: string, documentIds: string[]): Promise<Map<string, number>> {
  if (!documentIds.length) return new Map();
  const r = await rows<{ document_id: string; total: number }>(sql`
    SELECT document_id, sum(token_estimate)::int AS total FROM document_sections
    WHERE user_id = ${userId} AND document_id IN (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})
    GROUP BY document_id`);
  return new Map(r.map((x) => [x.document_id, Number(x.total)]));
}
