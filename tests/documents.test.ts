import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectFile } from "../server/documents/detect";
import { extractDocument } from "../server/documents/extract";
import { chunkSections } from "../server/documents/chunk";
import { searchPassages } from "../server/retrieval/search";
import { drainJobs } from "../server/jobs/queue";
import { getDb } from "../server/db/client";
import { deadlines, documents } from "../server/db/schema";
import { setAIProvider } from "../server/ai";
import { Client, FakeAI, makeDocx, makePdf, makePptx, makeXlsx, setupTestApp, teardown, type TestApp } from "./helpers";

describe("file detection", () => {
  it("identifies files by content, not just extension", async () => {
    expect(detectFile("brief.pdf", makePdf(["hello"]))).toMatchObject({ ok: true, kind: "pdf" });
    expect(detectFile("renamed.txt", makePdf(["hello"]))).toMatchObject({ ok: true, kind: "pdf" });
    expect(detectFile("notes.docx", await makeDocx([{ text: "x" }]))).toMatchObject({ ok: true, kind: "docx" });
    expect(detectFile("shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toMatchObject({ ok: true, kind: "image" });
    expect(detectFile("code.py", Buffer.from("print('hi')\n"))).toMatchObject({ ok: true, kind: "code" });
  });

  it("rejects executables, legacy Office and empty files with helpful reasons", () => {
    const exe = detectFile("essay.pdf", Buffer.from("MZ\x90\x00binary"));
    expect(exe.ok).toBe(false);
    const doc = detectFile("old.doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1]));
    expect(doc).toMatchObject({ ok: false });
    expect(!doc.ok && doc.reason).toMatch(/docx/);
    expect(detectFile("empty.txt", Buffer.alloc(0)).ok).toBe(false);
  });
});

describe("extraction", () => {
  it("extracts PDF text per page with page labels", async () => {
    const pdf = makePdf([
      "Assignment brief for Business Systems Analysis. This assignment asks you to model requirements for a library system in detail.",
      "Marking criteria: critical evaluation is worth 30 percent. Use Harvard referencing throughout the report and appendices.",
    ]);
    const ex = await extractDocument("pdf", pdf, ".pdf");
    expect(ex.pageCount).toBe(2);
    expect(ex.sections.map((s) => s.label)).toEqual(["Page 1", "Page 2"]);
    expect(ex.sections[1].text).toContain("critical evaluation is worth 30 percent");
    expect(ex.needsVision).toBeUndefined();
  });

  it("flags image-only PDFs for vision processing", async () => {
    const ex = await extractDocument("pdf", makePdf([" ", " "]), ".pdf");
    expect(ex.needsVision).toBe("pdf");
  });

  it("extracts DOCX into heading-based sections", async () => {
    const docx = await makeDocx([
      { text: "Introduction", heading: true },
      { text: "This report evaluates the proposed inventory system." },
      { text: "Requirements", heading: true },
      { text: "The system must track stock levels in real time." },
    ]);
    const ex = await extractDocument("docx", docx, ".docx");
    expect(ex.sections.map((s) => s.heading)).toEqual(["Introduction", "Requirements"]);
    expect(ex.sections[1].text).toContain("track stock levels");
  });

  it("extracts PPTX slides with speaker notes", async () => {
    const pptx = await makePptx([
      { title: "Week 3: Use cases", bullets: ["Actors", "Scenarios"], notes: "Remember the include relationship" },
      { title: "Summary", bullets: ["Review"] },
    ]);
    const ex = await extractDocument("pptx", pptx, ".pptx");
    expect(ex.sections[0]).toMatchObject({ label: "Slide 1", heading: "Week 3: Use cases" });
    expect(ex.sections[0].text).toContain("Speaker notes:\nRemember the include relationship");
  });

  it("extracts XLSX sheets as markdown tables", async () => {
    const xlsx = await makeXlsx("Marks", [["Component", "Weight"], ["Report", 60], ["Presentation", 40]]);
    const ex = await extractDocument("xlsx", xlsx, ".xlsx");
    expect(ex.sections[0].label).toBe("Sheet: Marks");
    expect(ex.sections[0].text).toContain("| Report | 60 |");
  });

  it("extracts CSV", async () => {
    const ex = await extractDocument("csv", Buffer.from("week,topic\n1,Intro\n2,UML\n"), ".csv");
    expect(ex.sections[0].text).toContain("| 2 | UML |");
  });
});

describe("chunking", () => {
  it("keeps chunks within their source location and splits long sections with overlap", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(40)).join("\n\n");
    const chunks = chunkSections([
      { label: "Page 1", page: 1, text: "Short page." },
      { label: "Page 2", page: 2, text: long },
    ]);
    expect(chunks[0]).toMatchObject({ label: "Page 1", page: 1 });
    const page2 = chunks.filter((c) => c.page === 2);
    expect(page2.length).toBeGreaterThan(2);
    expect(page2[0].label).toBe("Page 2 (part 1)");
    expect(page2[1].text.startsWith("…")).toBe(true);
    for (const c of page2) expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(400);
  });
});

describe("upload → process → retrieve pipeline", () => {
  let app: TestApp;
  let client: Client;

  beforeAll(async () => {
    app = await setupTestApp();
    client = new Client(app);
    await client.register();
  });
  afterAll(teardown);

  it("uploads, processes and retrieves the right passage with its page", async () => {
    const pdf = makePdf([
      "Module handbook. Lectures are on Mondays in room 2.04. Office hours are Thursdays at 2pm.",
      "Assessment: The group project report is worth 40 percent of the final grade and must not exceed 3000 words.",
      "Reading list: Pressman, Software Engineering. Sommerville, Software Engineering. Optional papers on agile methods.",
    ]);
    const up = await client.upload("Handbook.pdf", pdf);
    expect(up.status).toBe(200);
    expect(up.body.results[0].document.status).toBe("queued");
    await drainJobs();

    const doc = await client.json("GET", `/api/documents/${up.body.results[0].document.id}`);
    expect(doc.body.document.status).toBe("ready");
    expect(doc.body.sections).toHaveLength(3);

    const me = await client.json("GET", "/api/auth/me");
    const hits = await searchPassages(me.body.user.id, "how much is the group project report worth?");
    expect(hits[0].location).toBe("Page 2");
    expect(hits[0].content).toContain("40 percent");
  });

  it("does not re-process an identical file and flags likely revisions", async () => {
    const pdf = makePdf(["Brief version one with enough words to be indexed properly for testing duplicates."]);
    const first = await client.upload("Project Brief.pdf", pdf);
    const again = await client.upload("copy of brief.pdf", pdf);
    expect(again.body.results[0].duplicate).toBe(true);
    expect(again.body.results[0].document.id).toBe(first.body.results[0].document.id);

    const v2 = await client.upload("Project Brief v2.pdf", makePdf(["Brief version two has changed the deadline and the word count for the project."]));
    expect(v2.body.results[0].document.metadata.relatedDocuments?.[0]).toMatchObject({ relation: "possible_revision", filename: "Project Brief.pdf" });
    await drainJobs();
  });

  it("rejects disguised executables at upload", async () => {
    const res = await client.upload("totally-a-pdf.pdf", Buffer.from("MZ\x90\x00\x03\x00\x00\x00"));
    expect(res.body.results[0].error).toMatch(/Executable/);
  });

  it("marks image uploads as partial with a clear reason when no vision model is configured", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const up = await client.upload("screenshot.png", png);
    await drainJobs();
    const doc = await client.json("GET", `/api/documents/${up.body.results[0].document.id}`);
    expect(doc.body.document.status).toBe("failed");
    expect(doc.body.document.statusDetail).toMatch(/vision model/);
  });

  it("uses AI analysis to classify documents and suggest (not confirm) deadlines", async () => {
    setAIProvider(
      new FakeAI({
        structured: (call) =>
          call.purpose === "document.analyze"
            ? {
                kind: "assignment_brief",
                title: "BSA Assignment 1",
                summary: "Brief for the first BSA assignment.",
                moduleCodeHints: ["BSA301"],
                keyPoints: ["Submit via Moodle"],
                learningOutcomes: [],
                gradingCriteria: ["Analysis 40%"],
                wordLimit: "2500 words",
                referencingStyle: "Harvard",
                dates: [{ label: "Assignment 1 submission", isoDate: "2026-11-20", yearWasInferred: false, type: "deadline", excerpt: "Submit by 20 November 2026.", location: "Page 1" }],
                looksLikeStudentWriting: false,
              }
            : undefined,
      }),
    );
    const mod = await client.json("POST", "/api/modules", { code: "BSA301", name: "Business Systems Analysis" });
    const up = await client.upload("a1.pdf", makePdf(["BSA301 Assignment 1. Submit by 20 November 2026. Word limit 2500 words. Use Harvard referencing."]));
    await drainJobs();
    const doc = await client.json("GET", `/api/documents/${up.body.results[0].document.id}`);
    expect(doc.body.document.kind).toBe("assignment_brief");
    expect(doc.body.document.metadata.suggestedModuleId).toBe(mod.body.module.id);

    const dls = await getDb().select().from(deadlines);
    const d = dls.find((x) => x.title === "Assignment 1 submission")!;
    expect(d.status).toBe("suggested");
    expect(d.sourceExcerpt).toContain("Submit by 20 November 2026.");
    setAIProvider(null);
  });

  it("deletes documents and their index", async () => {
    const up = await client.upload("temp.txt", Buffer.from("Temporary notes about photosynthesis and chlorophyll."));
    await drainJobs();
    const id = up.body.results[0].document.id;
    expect((await client.json("DELETE", `/api/documents/${id}`)).status).toBe(200);
    expect((await client.json("GET", `/api/documents/${id}`)).status).toBe(404);
    const rows = await getDb().select().from(documents);
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });
});
