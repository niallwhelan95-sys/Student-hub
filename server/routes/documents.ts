import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { conversations, documentSections, documents, modules } from "../db/schema";
import type { AppVariables } from "../auth/middleware";
import { parseBody, parseQuery, isUuid } from "../lib/validate";
import { AppError, badRequest, notFound } from "../lib/errors";
import { env } from "../env";
import { getStorage } from "../storage";
import { assignDocumentModule, deleteDocument, ingestUpload, reprocessDocument } from "../documents/service";
import { DOCUMENT_KINDS } from "../documents/analyze";
import { addWritingSample, WRITING_CONTEXTS } from "../writing/service";

export const documentRoutes = new Hono<{ Variables: AppVariables }>();

const publicColumns = {
  id: documents.id,
  moduleId: documents.moduleId,
  conversationId: documents.conversationId,
  filename: documents.filename,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  kind: documents.kind,
  status: documents.status,
  statusDetail: documents.statusDetail,
  pageCount: documents.pageCount,
  summary: documents.summary,
  metadata: documents.metadata,
  isOwnWriting: documents.isOwnWriting,
  createdAt: documents.createdAt,
  processedAt: documents.processedAt,
};

documentRoutes.get("/", async (c) => {
  const user = c.get("user");
  const q = parseQuery(
    c,
    z.object({ moduleId: z.string().optional(), status: z.string().optional(), ids: z.string().optional() }),
  );
  const conds = [eq(documents.userId, user.id)];
  if (q.moduleId === "none") conds.push(sql`${documents.moduleId} IS NULL`);
  else if (q.moduleId && isUuid(q.moduleId)) conds.push(eq(documents.moduleId, q.moduleId));
  if (q.status === "processing") conds.push(sql`${documents.status} IN ('queued','processing')`);
  if (q.ids) {
    const ids = q.ids.split(",").filter(isUuid).slice(0, 50);
    if (ids.length) conds.push(sql`${documents.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  }
  const list = await getDb().select(publicColumns).from(documents).where(and(...conds)).orderBy(desc(documents.createdAt)).limit(500);
  return c.json({ documents: list });
});

documentRoutes.post(
  "/",
  bodyLimit({
    maxSize: env.MAX_UPLOAD_MB * 1024 * 1024 * 5 + 1024 * 1024,
    onError: () => {
      throw new AppError(413, `Upload too large — each file must be under ${env.MAX_UPLOAD_MB} MB.`, "too_large");
    },
  }),
  async (c) => {
    const user = c.get("user");
    const form = await c.req.parseBody({ all: true });
    const moduleId = typeof form.moduleId === "string" && isUuid(form.moduleId) ? form.moduleId : null;
    const conversationId = typeof form.conversationId === "string" && isUuid(form.conversationId) ? form.conversationId : null;
    if (conversationId) {
      const [conv] = await getDb()
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));
      if (!conv) throw badRequest("Unknown conversation");
    }
    const raw = form.file;
    const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => typeof f !== "string");
    if (!files.length) throw badRequest("No file provided");
    if (files.length > 5) throw badRequest("Upload at most 5 files at a time");

    const results: { document?: unknown; duplicate?: boolean; filename: string; error?: string }[] = [];
    for (const file of files) {
      try {
        const data = Buffer.from(await file.arrayBuffer());
        const { document, duplicate } = await ingestUpload({ userId: user.id, filename: file.name, data, moduleId, conversationId });
        const { storageKey: _k, sha256: _s, userId: _u, ...pub } = document;
        results.push({ document: pub, duplicate, filename: file.name });
      } catch (err) {
        results.push({ filename: file.name, error: err instanceof AppError ? err.message : "Upload failed" });
        if (!(err instanceof AppError)) console.error("[upload]", err);
      }
    }
    return c.json({ results });
  },
);

async function ownedDoc(userId: string, id: string) {
  if (!isUuid(id)) throw notFound("Document");
  const [doc] = await getDb().select().from(documents).where(and(eq(documents.id, id), eq(documents.userId, userId)));
  if (!doc) throw notFound("Document");
  return doc;
}

documentRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const doc = await ownedDoc(user.id, c.req.param("id"));
  const sections = await getDb()
    .select({
      id: documentSections.id,
      ordinal: documentSections.ordinal,
      location: documentSections.locationLabel,
      page: documentSections.pageStart,
      heading: documentSections.heading,
      content: documentSections.content,
    })
    .from(documentSections)
    .where(eq(documentSections.documentId, doc.id))
    .orderBy(asc(documentSections.ordinal));
  const { storageKey: _k, sha256: _s, userId: _u, ...pub } = doc;
  return c.json({ document: pub, sections });
});

/** Stream the original file. Served as an attachment with nosniff so it can never execute in our origin. */
documentRoutes.get("/:id/file", async (c) => {
  const user = c.get("user");
  const doc = await ownedDoc(user.id, c.req.param("id"));
  const data = await getStorage().get(doc.storageKey);
  const inline = c.req.query("inline") === "1" && (doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/"));
  return c.body(new Uint8Array(data), 200, {
    "content-type": doc.mimeType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    "x-content-type-options": "nosniff",
    // Chrome's PDF viewer won't render under a CSP sandbox; every other type gets the strict policy.
    "content-security-policy":
      doc.mimeType === "application/pdf" ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "cache-control": "private, max-age=300",
  });
});

documentRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const doc = await ownedDoc(user.id, c.req.param("id"));
  const body = await parseBody(
    c,
    z.object({
      moduleId: z.string().uuid().nullable().optional(),
      kind: z.enum(DOCUMENT_KINDS).optional(),
      isOwnWriting: z.boolean().optional(),
      filename: z.string().trim().min(1).max(200).optional(),
    }),
  );
  if (body.moduleId !== undefined) {
    if (body.moduleId) {
      const [m] = await getDb().select({ id: modules.id }).from(modules).where(and(eq(modules.id, body.moduleId), eq(modules.userId, user.id)));
      if (!m) throw badRequest("Unknown module");
    }
    await assignDocumentModule(user.id, doc.id, body.moduleId);
  }
  const { moduleId: _m, ...rest } = body;
  if (Object.keys(rest).length) await getDb().update(documents).set(rest).where(eq(documents.id, doc.id));
  const [updated] = await getDb().select(publicColumns).from(documents).where(eq(documents.id, doc.id));
  return c.json({ document: updated });
});

documentRoutes.post("/:id/reprocess", async (c) => {
  const user = c.get("user");
  const ok = await reprocessDocument(user.id, c.req.param("id"));
  if (!ok) throw notFound("Document");
  return c.json({ ok: true });
});

documentRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id) || !(await deleteDocument(user.id, id))) throw notFound("Document");
  return c.json({ ok: true });
});

/** Use an uploaded document as a sample of the student's own writing. */
documentRoutes.post("/:id/writing-sample", async (c) => {
  const user = c.get("user");
  const doc = await ownedDoc(user.id, c.req.param("id"));
  const body = await parseBody(c, z.object({ context: z.enum(WRITING_CONTEXTS), confirmedOwnWork: z.literal(true) }));
  const sections = await getDb()
    .select({ content: documentSections.content })
    .from(documentSections)
    .where(eq(documentSections.documentId, doc.id))
    .orderBy(asc(documentSections.ordinal));
  // Chunks overlap slightly; strip the "…tail" carry-over so text isn't duplicated.
  const text = sections.map((s) => s.content.replace(/^…[^\n]*\n\n/, "")).join("\n\n");
  if (text.trim().length < 200) throw badRequest("This document doesn't contain enough readable text to use as a writing sample.");
  const sample = await addWritingSample({
    userId: user.id,
    title: doc.metadata.title || doc.filename,
    text,
    context: body.context,
    origin: "upload",
    documentId: doc.id,
  });
  await getDb().update(documents).set({ isOwnWriting: true }).where(eq(documents.id, doc.id));
  return c.json({ sample: { id: sample.id, wordCount: sample.wordCount, exclusionNotes: sample.exclusionNotes } });
});
