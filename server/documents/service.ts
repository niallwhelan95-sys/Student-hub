import path from "node:path";
import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { deadlines, documentSections, documents, modules, type DocumentMetadata } from "../db/schema";
import { getStorage } from "../storage";
import { enqueue, registerJob } from "../jobs/queue";
import { tryEmbed } from "../embeddings";
import { getAI, describeAIError, type ImageMediaType } from "../ai";
import { estimateTokens } from "../lib/text";
import { badRequest } from "../lib/errors";
import { env } from "../env";
import { detectFile } from "./detect";
import { extractDocument, type Extraction } from "./extract";
import { chunkSections } from "./chunk";
import { visionExtractImage, visionExtractPdf } from "./vision";
import { analyzeDocument, heuristicKind } from "./analyze";

export type IngestResult = { document: typeof documents.$inferSelect; duplicate: boolean };

const stem = (filename: string) =>
  path
    .basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/\b(v\d+|final|draft|copy|updated|revised|\(\d+\))\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type IngestParams = {
  userId: string;
  filename: string;
  data: Buffer;
  moduleId?: string | null;
  conversationId?: string | null;
  /** Set when the browser already uploaded the bytes straight to storage (Vercel Blob client upload). */
  storedKey?: string;
};

/** Validate and store an upload, then queue it for processing. Exact duplicates are not re-processed. */
export async function ingestUpload(params: IngestParams): Promise<IngestResult> {
  try {
    const result = await ingest(params);
    // A pre-uploaded copy that turned out to be a duplicate isn't needed.
    if (params.storedKey && result.document.storageKey !== params.storedKey) await getStorage().remove(params.storedKey).catch(() => {});
    return result;
  } catch (err) {
    // Rejected files (wrong type, too large…) must not linger in storage.
    if (params.storedKey) await getStorage().remove(params.storedKey).catch(() => {});
    throw err;
  }
}

async function ingest(params: IngestParams): Promise<IngestResult> {
  const { userId, data } = params;
  const filename = path.basename(params.filename).slice(0, 200) || "upload";
  if (data.length > env.MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`Files must be under ${env.MAX_UPLOAD_MB} MB.`);
  const detection = detectFile(filename, data);
  if (!detection.ok) throw badRequest(detection.reason);

  const db = getDb();
  if (params.moduleId) {
    const [m] = await db.select({ id: modules.id }).from(modules).where(and(eq(modules.id, params.moduleId), eq(modules.userId, userId)));
    if (!m) throw badRequest("Unknown module");
  }

  const sha256 = createHash("sha256").update(data).digest("hex");
  const [existing] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.sha256, sha256)))
    .limit(1);
  if (existing && existing.status !== "failed") {
    // Same bytes already in the library — reuse it; optionally attach it to the module if it had none.
    if (params.moduleId && !existing.moduleId) {
      const [updated] = await db
        .update(documents)
        .set({ moduleId: params.moduleId })
        .where(eq(documents.id, existing.id))
        .returning();
      await db.update(documentSections).set({ moduleId: params.moduleId }).where(eq(documentSections.documentId, existing.id));
      return { document: updated, duplicate: true };
    }
    return { document: existing, duplicate: true };
  }

  // Possible revision: same name stem (ignoring "v2", "final", …) but different content.
  const related: NonNullable<DocumentMetadata["relatedDocuments"]> = [];
  const myStem = stem(filename);
  if (myStem.length >= 3) {
    const candidates = await db
      .select({ id: documents.id, filename: documents.filename })
      .from(documents)
      .where(and(eq(documents.userId, userId), ne(documents.sha256, sha256)));
    for (const c of candidates) if (stem(c.filename) === myStem) related.push({ id: c.id, filename: c.filename, relation: "possible_revision" });
  }

  const storageKey = params.storedKey ?? (await getStorage().put(userId, data, detection.ext, detection.mimeType));
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      moduleId: params.moduleId ?? null,
      conversationId: params.conversationId ?? null,
      filename,
      mimeType: detection.mimeType,
      sizeBytes: data.length,
      sha256,
      storageKey,
      status: "queued",
      statusDetail: "Waiting to be processed",
      metadata: related.length ? { relatedDocuments: related.slice(0, 5) } : {},
    })
    .returning();
  await enqueue("document.process", { documentId: doc.id }, { userId, maxAttempts: 3 });
  return { document: doc, duplicate: false };
}

async function setStatus(id: string, status: string, statusDetail: string | null) {
  await getDb().update(documents).set({ status, statusDetail }).where(eq(documents.id, id));
}

/** The processing pipeline: extract → (vision) → chunk → embed → analyse. Safe to re-run. */
export async function processDocument(documentId: string): Promise<void> {
  const db = getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) return; // deleted while queued
  await setStatus(doc.id, "processing", "Extracting text");

  const data = await getStorage().get(doc.storageKey);
  const detection = detectFile(doc.filename, data);
  if (!detection.ok) {
    await setStatus(doc.id, "failed", detection.reason);
    return;
  }

  let extraction: Extraction = await extractDocument(detection.kind, data, detection.ext);
  const warnings = [...extraction.warnings];
  const ai = getAI();

  if (extraction.needsVision) {
    if (!ai.configured) {
      warnings.push("Reading images and scanned pages needs the AI vision model — add ANTHROPIC_API_KEY, then reprocess this file.");
    } else {
      await setStatus(doc.id, "processing", "Reading images with the vision model");
      try {
        const vision =
          extraction.needsVision === "image"
            ? await visionExtractImage(data, detection.mimeType as ImageMediaType, doc.userId)
            : await visionExtractPdf(data, extraction.pageCount, doc.userId);
        warnings.push(...vision.warnings);
        if (vision.sections.length) extraction = { ...extraction, sections: vision.sections, method: `${extraction.method}+vision` };
      } catch (err) {
        warnings.push(`Vision transcription failed: ${describeAIError(err)}`);
      }
    }
  }

  const chunks = chunkSections(extraction.sections);

  // Replace any previous sections (re-processing).
  await db.delete(documentSections).where(eq(documentSections.documentId, doc.id));
  if (chunks.length) {
    await setStatus(doc.id, "processing", "Indexing for search");
    const embedded = await tryEmbed(
      chunks.map((c) => `${c.heading ? c.heading + "\n" : ""}${c.text}`),
      "document",
    );
    if (!embedded) warnings.push("Semantic indexing unavailable — keyword search only for this file.");
    const values = chunks.map((c, i) => ({
      documentId: doc.id,
      userId: doc.userId,
      moduleId: doc.moduleId,
      ordinal: c.ordinal,
      locationLabel: c.label,
      pageStart: c.page ?? null,
      pageEnd: c.page ?? null,
      heading: c.heading ?? null,
      content: c.text,
      tokenEstimate: estimateTokens(c.text),
      embedding: embedded?.vectors[i] ?? null,
      embeddingModel: embedded ? embedded.model : null,
    }));
    for (let i = 0; i < values.length; i += 100) await db.insert(documentSections).values(values.slice(i, i + 100));
  }

  // Analysis (classification, summary, dates). Optional: the document is usable without it.
  const metadata: DocumentMetadata = {
    ...doc.metadata,
    title: extraction.title ?? doc.metadata.title,
    extraction: { method: extraction.method, warnings },
  };
  let kind = heuristicKind(doc.filename, chunks.map((c) => c.text).join("\n"), detection.kind);
  let summary: string | null = doc.summary;
  let isOwnWriting = doc.isOwnWriting;

  if (chunks.length && ai.configured) {
    await setStatus(doc.id, "processing", "Understanding the document");
    const userModules = await db
      .select({ id: modules.id, code: modules.code, name: modules.name })
      .from(modules)
      .where(eq(modules.userId, doc.userId));
    try {
      const analysis = await analyzeDocument({
        filename: doc.filename,
        chunks,
        userId: doc.userId,
        today: new Date(),
        moduleContext: userModules.map((m) => [m.code, m.name].filter(Boolean).join(" ")).join("; "),
      });
      if (analysis) {
        kind = analysis.kind;
        summary = analysis.summary;
        isOwnWriting = analysis.looksLikeStudentWriting;
        Object.assign(metadata, {
          title: analysis.title,
          moduleCodeHints: analysis.moduleCodeHints,
          keyPoints: analysis.keyPoints,
          learningOutcomes: analysis.learningOutcomes,
          gradingCriteria: analysis.gradingCriteria,
          wordLimit: analysis.wordLimit ?? undefined,
          referencingStyle: analysis.referencingStyle ?? undefined,
          detectedDates: analysis.dates.map((d) => ({ date: d.isoDate, label: d.label, excerpt: d.excerpt, location: d.location })),
        } satisfies Partial<DocumentMetadata>);

        if (!doc.moduleId && analysis.moduleCodeHints.length) {
          const hints = analysis.moduleCodeHints.map((h) => h.toLowerCase().replace(/\s+/g, ""));
          const match = userModules.find((m) => m.code && hints.some((h) => h.includes(m.code!.toLowerCase().replace(/\s+/g, ""))));
          metadata.suggestedModuleId = match?.id ?? null;
        }

        // Deadlines and exams become *suggestions* the student confirms — never silent facts.
        await db.delete(deadlines).where(and(eq(deadlines.sourceDocumentId, doc.id), eq(deadlines.status, "suggested")));
        for (const d of analysis.dates) {
          if (d.type !== "deadline" && d.type !== "exam" && d.type !== "milestone") continue;
          const due = new Date(d.isoDate.length === 10 ? `${d.isoDate}T23:59:00` : d.isoDate);
          if (Number.isNaN(due.getTime())) continue;
          await db.insert(deadlines).values({
            userId: doc.userId,
            moduleId: doc.moduleId ?? metadata.suggestedModuleId ?? null,
            title: d.label,
            dueAt: due,
            allDay: d.isoDate.length === 10,
            kind: d.type === "exam" ? "exam" : d.type === "milestone" ? "milestone" : "assignment",
            status: "suggested",
            sourceDocumentId: doc.id,
            sourceExcerpt: `${d.excerpt}${d.location ? ` (${d.location})` : ""}${d.yearWasInferred ? " — year inferred" : ""}`,
          });
        }
      }
    } catch (err) {
      warnings.push(`AI analysis failed (${describeAIError(err)}); the text is still searchable.`);
    }
  }

  const status = chunks.length === 0 ? "failed" : warnings.length ? "partial" : "ready";
  const statusDetail =
    chunks.length === 0
      ? warnings[0] ?? "No readable content was found in this file."
      : warnings.length
        ? warnings.join(" ")
        : `Indexed ${chunks.length} passage${chunks.length === 1 ? "" : "s"}`;

  await db
    .update(documents)
    .set({
      status,
      statusDetail,
      kind,
      summary,
      isOwnWriting,
      metadata,
      pageCount: extraction.pageCount ?? null,
      processedAt: new Date(),
    })
    .where(eq(documents.id, doc.id));
}

registerJob("document.process", {
  run: async (payload) => processDocument(String(payload.documentId)),
  onFinalFailure: async (payload, error) => {
    await setStatus(String(payload.documentId), "failed", `Processing failed: ${error}`);
  },
});

export async function deleteDocument(userId: string, documentId: string): Promise<boolean> {
  const db = getDb();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  if (!doc) return false;
  await db.delete(documents).where(eq(documents.id, doc.id)); // sections cascade
  await getStorage().remove(doc.storageKey);
  return true;
}

export async function reprocessDocument(userId: string, documentId: string): Promise<boolean> {
  const db = getDb();
  const [doc] = await db
    .update(documents)
    .set({ status: "queued", statusDetail: "Queued for reprocessing" })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .returning({ id: documents.id });
  if (!doc) return false;
  await enqueue("document.process", { documentId }, { userId });
  return true;
}

/** Move a document (and its index) to a module, or detach it with null. */
export async function assignDocumentModule(userId: string, documentId: string, moduleId: string | null) {
  const db = getDb();
  const [doc] = await db
    .update(documents)
    .set({ moduleId, metadata: sql`${documents.metadata} - 'suggestedModuleId'` })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .returning();
  if (doc) await db.update(documentSections).set({ moduleId }).where(eq(documentSections.documentId, documentId));
  return doc ?? null;
}
