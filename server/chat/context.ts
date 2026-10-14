import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  conversations,
  deadlines,
  documents,
  modules,
  studentProfiles,
  tasks,
  users,
  type Citation,
} from "../db/schema";
import { coreMemories, moduleMemories, searchMemories, type Memory } from "../memory/service";
import { documentPassages, documentTokenTotals, searchPassages, type Passage } from "../retrieval/search";
import { hasWritingIntent, writingGuidance } from "../writing/service";
import { escapeForPrompt, truncate } from "../lib/text";

type Conversation = typeof conversations.$inferSelect;

export type BuiltContext = {
  /** The <context> block prepended to the student's latest message. */
  block: string;
  /** Every citable item offered to the model, keyed by ref (S1, M1…). */
  citations: Map<string, Citation>;
  passages: Passage[];
  memories: Memory[];
  usedWritingProfile: boolean;
  pendingDocuments: string[];
};

const WHOLE_DOC_TOKEN_LIMIT = 6_000;
const ATTACHED_TOKEN_BUDGET = 24_000;

const attr = (s: string | null | undefined) => (s ?? "").replace(/"/g, "'").replace(/[\n\r]+/g, " ").slice(0, 160);
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export async function buildContext(params: {
  userId: string;
  conversation: Conversation;
  query: string;
  previousUserText?: string | null;
  attachmentIds: string[];
  now?: Date;
}): Promise<BuiltContext> {
  const { userId, conversation } = params;
  const db = getDb();
  const now = params.now ?? new Date();

  // Short follow-ups ("and section 2?") retrieve better with the previous question attached.
  const searchQuery =
    params.query.split(/\s+/).length < 7 && params.previousUserText ? `${params.previousUserText}\n${params.query}` : params.query;

  const [[user], [profile], userModules] = await Promise.all([
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)),
    db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)),
    db.select().from(modules).where(and(eq(modules.userId, userId), eq(modules.archived, false))),
  ]);
  const moduleById = new Map(userModules.map((m) => [m.id, m]));
  const moduleLabel = (id: string | null) => {
    const m = id ? moduleById.get(id) : undefined;
    return m ? [m.code, m.name].filter(Boolean).join(" ") : "";
  };
  const currentModule = conversation.moduleId ? moduleById.get(conversation.moduleId) : undefined;

  // ── Sources ────────────────────────────────────────────────────────────────
  const pendingDocuments: string[] = [];
  let attached: Passage[] = [];
  if (params.attachmentIds.length) {
    const docs = await db
      .select({ id: documents.id, filename: documents.filename, status: documents.status, statusDetail: documents.statusDetail })
      .from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.id, params.attachmentIds)));
    for (const d of docs) {
      if (d.status === "queued" || d.status === "processing") pendingDocuments.push(`${d.filename} (still processing)`);
      else if (d.status === "failed") pendingDocuments.push(`${d.filename} (could not be read: ${d.statusDetail ?? "unknown error"})`);
    }
    const readyIds = docs.filter((d) => d.status === "ready" || d.status === "partial").map((d) => d.id);
    const totals = await documentTokenTotals(userId, readyIds);
    const small = readyIds.filter((id) => (totals.get(id) ?? 0) <= WHOLE_DOC_TOKEN_LIMIT);
    const large = readyIds.filter((id) => !small.includes(id));
    attached = await documentPassages(userId, small, ATTACHED_TOKEN_BUDGET);
    if (large.length) attached.push(...(await searchPassages(userId, searchQuery, { documentIds: large, limit: 10, perDocument: 6 })));
  }
  const attachedIds = new Set(attached.map((p) => p.sectionId));
  const library = (await searchPassages(userId, searchQuery, { preferModuleId: conversation.moduleId, limit: 8 })).filter(
    (p) => !attachedIds.has(p.sectionId),
  );
  const passages = [...attached, ...library];

  // ── Memories ───────────────────────────────────────────────────────────────
  const [core, scoped, relevant] = await Promise.all([
    coreMemories(userId, 20),
    conversation.moduleId ? moduleMemories(userId, conversation.moduleId, 10) : Promise.resolve([]),
    searchMemories(userId, searchQuery, { limit: 8 }),
  ]);
  const seen = new Set<string>();
  const memories = [...core, ...scoped, ...relevant].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));

  // ── Planner ────────────────────────────────────────────────────────────────
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  const [upcoming, openTasks] = await Promise.all([
    db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.userId, userId), eq(deadlines.status, "confirmed"), gte(deadlines.dueAt, new Date(now.getTime() - 86_400_000)), lte(deadlines.dueAt, horizon)))
      .orderBy(asc(deadlines.dueAt))
      .limit(8),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), ne(tasks.status, "done")))
      .orderBy(asc(tasks.dueAt))
      .limit(8),
  ]);

  // ── Writing profile ────────────────────────────────────────────────────────
  const wantsWriting = conversation.kind === "writing" || conversation.kind === "assignment" || hasWritingIntent(params.query);
  const writing = wantsWriting ? await writingGuidance(userId, params.query) : null;

  // ── Assemble ───────────────────────────────────────────────────────────────
  const citations = new Map<string, Citation>();
  const parts: string[] = [];
  parts.push(`<today>${fmtDate(now)}</today>`);

  const prefs = profile?.learningPrefs ?? {};
  const studentLines = [
    user?.displayName ? `Name: ${user.displayName}` : null,
    profile?.university ? `University: ${profile.university}` : null,
    profile?.programme ? `Programme: ${profile.programme}` : null,
    profile?.yearOfStudy ? `Year: ${profile.yearOfStudy}${profile.semester ? `, ${profile.semester}` : ""}` : null,
    `Assistance level: ${profile?.assistanceLevel ?? "collaborative"}`,
    prefs.explanationStyle ? `Prefers explanations: ${prefs.explanationStyle}` : null,
    prefs.detailLevel ? `Preferred detail: ${prefs.detailLevel}` : null,
    prefs.supports?.length ? `Helpful supports: ${prefs.supports.join(", ")}` : null,
    prefs.notes ? `Notes: ${prefs.notes}` : null,
    profile?.accessibilityNotes ? `Accessibility: ${profile.accessibilityNotes}` : null,
    userModules.length ? `Current modules: ${userModules.map((m) => [m.code, m.name].filter(Boolean).join(" ")).join("; ")}` : "No modules set up yet.",
  ].filter(Boolean);
  parts.push(`<student>\n${escapeForPrompt(studentLines.join("\n"))}\n</student>`);

  if (currentModule) {
    const lines = [
      `${[currentModule.code, currentModule.name].filter(Boolean).join(" — ")}`,
      currentModule.coordinator ? `Coordinator: ${currentModule.coordinator}` : null,
      currentModule.lecturers.length ? `Lecturers: ${currentModule.lecturers.join(", ")}` : null,
      currentModule.description ? `Description: ${currentModule.description}` : null,
      currentModule.profileSummary ? `What Margin knows: ${currentModule.profileSummary}` : null,
    ].filter(Boolean);
    parts.push(`<module>\n${escapeForPrompt(lines.join("\n"))}\n</module>`);
  }

  if (pendingDocuments.length) {
    parts.push(`<unavailable_files>\nThese attached files can't be used yet — tell the student rather than guessing their contents:\n${pendingDocuments.map((p) => `- ${p}`).join("\n")}\n</unavailable_files>`);
  }

  if (passages.length) {
    const sourceText = passages
      .map((p, i) => {
        const ref = `S${i + 1}`;
        citations.set(ref, {
          ref,
          kind: "document",
          documentId: p.documentId,
          sectionId: p.sectionId,
          title: p.documentTitle || p.filename,
          location: p.location ?? undefined,
          page: p.page,
          excerpt: truncate(p.content, 400),
        });
        const mod = moduleLabel(p.moduleId);
        return `<source id="${ref}" file="${attr(p.filename)}" kind="${p.documentKind}" location="${attr(p.location)}"${mod ? ` module="${attr(mod)}"` : ""}${
          p.matchedBy.includes("attached") ? ` attached="true"` : ""
        }>\n${escapeForPrompt(p.content)}\n</source>`;
      })
      .join("\n");
    parts.push(`<sources>\n${sourceText}\n</sources>`);
  } else {
    parts.push(`<sources>No passages in the student's library matched this message.</sources>`);
  }

  if (memories.length) {
    const memText = memories
      .map((m, i) => {
        const ref = `M${i + 1}`;
        citations.set(ref, { ref, kind: "memory", memoryId: m.id, title: "Saved memory", excerpt: m.content });
        const mod = moduleLabel(m.moduleId);
        return `<memory id="${ref}" category="${m.category}" saved="${m.updatedAt.toISOString().slice(0, 10)}"${mod ? ` module="${attr(mod)}"` : ""}${
          m.stability === "temporary" ? ` temporary="true"` : ""
        }>${escapeForPrompt(m.content)}</memory>`;
      })
      .join("\n");
    parts.push(`<memories>\n${memText}\n</memories>`);
  }

  if (upcoming.length || openTasks.length) {
    const lines = [
      ...upcoming.map((d) => `- Deadline: ${d.title}${moduleLabel(d.moduleId) ? ` [${moduleLabel(d.moduleId)}]` : ""} — due ${fmtDate(d.dueAt)}`),
      ...openTasks.map(
        (t) => `- Task (${t.status}, ${t.priority}): ${t.title}${t.dueAt ? ` — due ${fmtDate(t.dueAt)}` : ""}${moduleLabel(t.moduleId) ? ` [${moduleLabel(t.moduleId)}]` : ""}`,
      ),
    ];
    parts.push(`<planner>\n${escapeForPrompt(lines.join("\n"))}\n</planner>`);
  }

  const wc = conversation.workingContext;
  if (wc && (wc.goal || wc.next || wc.remaining?.length)) {
    const lines = [
      wc.goal ? `Goal: ${wc.goal}` : null,
      wc.done?.length ? `Done: ${wc.done.join("; ")}` : null,
      wc.remaining?.length ? `Remaining: ${wc.remaining.join("; ")}` : null,
      wc.next ? `Next step: ${wc.next}` : null,
    ].filter(Boolean);
    parts.push(`<working_context>\n${escapeForPrompt(lines.join("\n"))}\n</working_context>`);
  }

  if (writing) parts.push(`<writing_profile>\n${escapeForPrompt(writing.text)}\n</writing_profile>`);

  return {
    block: `<context>\n${parts.join("\n\n")}\n</context>`,
    citations,
    passages,
    memories,
    usedWritingProfile: !!writing,
    pendingDocuments,
  };
}

/** Keep only citations the model actually referenced, in order of first use. */
export function usedCitations(text: string, offered: Map<string, Citation>): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[((?:[SM]\d+)(?:\s*,\s*[SM]\d+)*)\]/g)) {
    for (const ref of m[1].split(/\s*,\s*/)) {
      const c = offered.get(ref);
      if (c && !seen.has(ref)) {
        seen.add(ref);
        out.push(c);
      }
    }
  }
  return out;
}
