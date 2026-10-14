import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../server/env";
import { chooseNextStep } from "../server/routes/dashboard";
import { Client, setupTestApp, teardown, type TestApp } from "./helpers";

describe("voice dictation endpoint", () => {
  let app: TestApp;
  let client: Client;

  beforeAll(async () => {
    app = await setupTestApp();
    client = new Client(app);
    await client.register();
    await client.json("POST", "/api/modules", { code: "BSA301", name: "Business Systems Analysis" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    env.STT_API_KEY = undefined;
  });
  afterAll(teardown);

  const audioForm = () => {
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3, 4])], "rec.webm", { type: "audio/webm;codecs=opus" }));
    return form;
  };

  it("reports when server transcription is unavailable so the client can fall back", async () => {
    expect((await client.json("GET", "/api/speech/status")).body.serverTranscription).toBe(false);
    const res = await client.req("POST", "/api/speech/transcribe", audioForm());
    expect(res.status).toBe(503);
  });

  it("forwards audio in memory with course vocabulary hints and returns the transcript", async () => {
    env.STT_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      expect(body.get("model")).toBe(env.STT_MODEL);
      expect(String(body.get("prompt"))).toContain("BSA301");
      expect((body.get("file") as File).name).toBe("dictation.webm");
      return new Response(JSON.stringify({ text: "I finished the introduction yesterday." }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await client.req("POST", "/api/speech/transcribe", audioForm());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "I finished the introduction yesterday.", uncertain: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces transcription service errors", async () => {
    env.STT_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad audio", { status: 400 })));
    const res = await client.req("POST", "/api/speech/transcribe", audioForm());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Transcription service error/);
  });

  it("voice messages go through the normal chat workflow and are marked as voice", async () => {
    const conv = await client.json("POST", "/api/conversations", {});
    const { events } = await client.chat(conv.body.conversation.id, { content: "dictated text", inputMode: "voice" });
    expect(events.find((e) => e.event === "user_message")!.data.message.inputMode).toBe("voice");
  });
});

describe("planner and next step", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const base = { now, moduleCount: 2, documentCount: 3, suggestedDeadlines: 0, proposedMemories: 0, deadlines: [], tasks: [], onboardingDone: true };

  it("asks for modules first", () => {
    expect(chooseNextStep({ ...base, moduleCount: 0, onboardingDone: false }).action.href).toBe("/welcome");
  });

  it("prioritises the nearest essential task or deadline", () => {
    const step = chooseNextStep({
      ...base,
      deadlines: [{ title: "BSA report", dueAt: new Date("2026-10-18T23:59:00Z"), moduleId: null }],
      tasks: [{ title: "Email tutor", status: "todo", priority: "optional", dueAt: new Date("2026-10-15T09:00:00Z"), moduleId: null }],
    });
    expect(step.title).toBe("BSA report");
    expect(step.reason).toMatch(/Due in 5 days/);
    expect(step.action.prompt).toContain("25-minute");
  });

  it("asks the student to confirm extracted dates before trusting them", () => {
    expect(chooseNextStep({ ...base, suggestedDeadlines: 2 }).title).toMatch(/Confirm 2 dates/);
  });

  it("supports deadline and task CRUD with completion", async () => {
    const app = await setupTestApp();
    const c = new Client(app);
    await c.register();
    const d = await c.json("POST", "/api/planner/deadlines", { title: "Exam", dueAt: "2026-12-10T09:00:00Z", kind: "exam" });
    expect(d.body.deadline.status).toBe("confirmed");
    const t = await c.json("POST", "/api/planner/tasks", { title: "Read chapter 3", doneWhen: "Notes written", priority: "essential" });
    const done = await c.json("PATCH", `/api/planner/tasks/${t.body.task.id}`, { status: "done" });
    expect(done.body.task.completedAt).not.toBeNull();
    expect((await c.json("GET", "/api/planner/tasks")).body.tasks).toHaveLength(0);
    const dash = await c.json("GET", "/api/dashboard");
    expect(dash.body.deadlines[0].title).toBe("Exam");
  });

  it("counts each module's documents and gives new conversations a provisional title", async () => {
    const app = await setupTestApp();
    const c = new Client(app);
    await c.register();
    const mod = await c.json("POST", "/api/modules", { code: "DB201", name: "Database Systems" });
    await c.upload("notes.txt", Buffer.from("Normalisation removes redundancy from relational tables."), { moduleId: mod.body.module.id });
    const dash = await c.json("GET", "/api/dashboard");
    expect(dash.body.modules[0].documentCount).toBe(1);
    const list = await c.json("GET", "/api/modules");
    expect(list.body.modules[0].documentCount).toBe(1);

    const conv = await c.json("POST", "/api/conversations", {});
    await c.chat(conv.body.conversation.id, { content: "Can you explain third normal form with a simple example from a student records table please?" });
    const convs = await c.json("GET", "/api/conversations");
    expect(convs.body.conversations[0].title).toBe("Can you explain third normal form with a simple example…");
  });
});
