import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAIProvider } from "../server/ai";
import { drainJobs } from "../server/jobs/queue";
import { getDb } from "../server/db/client";
import { memories } from "../server/db/schema";
import { selectHistory } from "../server/chat/service";
import { usedCitations } from "../server/chat/context";
import { Client, FakeAI, makePdf, setupTestApp, teardown, type TestApp } from "./helpers";

describe("grounded chat", () => {
  let app: TestApp;
  let client: Client;
  let fake: FakeAI;

  beforeAll(async () => {
    app = await setupTestApp();
    client = new Client(app);
    await client.register();
    fake = new FakeAI({
      // Echo-style model: cites whichever source mentions "40 percent".
      chat: (call) => {
        const last = call.messages[call.messages.length - 1].content as string;
        const m = last.match(/<source id="(S\d+)"[^>]*>[^<]*40 percent/);
        return m ? `The report is worth 40% of the grade [${m[1]}]. I also made up [S99].` : "I couldn't find that in your materials.";
      },
      structured: (call) =>
        call.purpose === "memory.after_turn"
          ? {
              title: "Group project weighting",
              workingContext: { goal: "Understand assessment weighting", done: ["Found weighting"], remaining: ["Plan report"], next: "Outline the report" },
              memories: [
                { content: "The student's BSA lecturer is Dr Murphy.", category: "module", module: "BSA301", stability: "stable", confidence: 0.95, explicitRequest: false, supersedes: null },
                { content: "The student might switch to the evening tutorial group.", category: "general", module: null, stability: "temporary", confidence: 0.5, explicitRequest: false, supersedes: null },
              ],
            }
          : undefined,
    });
    setAIProvider(fake);
  });
  afterAll(teardown);

  it("answers from an attached document with valid citations only, and persists everything", async () => {
    const mod = await client.json("POST", "/api/modules", { code: "BSA301", name: "Business Systems Analysis" });
    const up = await client.upload(
      "handbook.pdf",
      makePdf([
        "Lectures are on Mondays in room 2.04 for all students taking this module this semester.",
        "The group project report is worth 40 percent of the final grade and must not exceed 3000 words.",
      ]),
      { moduleId: mod.body.module.id },
    );
    await drainJobs();
    const docId = up.body.results[0].document.id;

    const conv = await client.json("POST", "/api/conversations", { moduleId: mod.body.module.id });
    const convId = conv.body.conversation.id;
    const { events } = await client.chat(convId, { content: "How much is the group project worth? My lecturer is Dr Murphy.", attachmentIds: [docId] });

    const types = events.map((e) => e.event);
    expect(types).toEqual(expect.arrayContaining(["user_message", "context", "assistant_start", "delta", "done"]));
    const done = events.find((e) => e.event === "done")!.data.message;
    expect(done.content).toContain("40%");
    expect(done.status).toBe("complete");
    // Only the real source survives; the fabricated [S99] is not turned into a citation.
    expect(done.citations).toHaveLength(1);
    expect(done.citations[0]).toMatchObject({ kind: "document", documentId: docId, location: "Page 2" });

    // The model saw the stable system prompt (cached) and the context block with the student's module.
    const call = fake.calls.find((c) => c.purpose === "chat")!;
    expect(call.system[0].cache).toBe(true);
    expect(fake.lastUserText()).toContain("<module>");
    expect(fake.lastUserText()).toContain("BSA301");

    // Returning later: the conversation and messages are still there.
    const reloaded = await client.json("GET", `/api/conversations/${convId}`);
    expect(reloaded.body.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(reloaded.body.documents[0].id).toBe(docId);
  });

  it("extracts memories after the turn: confident facts active, uncertain ones proposed", async () => {
    await drainJobs();
    const all = await getDb().select().from(memories);
    const lecturer = all.find((m) => m.content.includes("Dr Murphy"))!;
    const tentative = all.find((m) => m.content.includes("evening tutorial"))!;
    expect(lecturer.status).toBe("active");
    expect(lecturer.moduleId).not.toBeNull();
    expect(tentative.status).toBe("proposed");
    expect(tentative.stability).toBe("temporary");
    expect(tentative.expiresAt).not.toBeNull();

    const list = await client.json("GET", "/api/conversations");
    expect(list.body.conversations[0].title).toBe("Group project weighting");
  });

  it("brings memories into a different, later conversation (cross-conversation recall)", async () => {
    const conv = await client.json("POST", "/api/conversations", {});
    await client.chat(conv.body.conversation.id, { content: "Who is my lecturer for BSA again?" });
    const ctx = fake.lastUserText();
    expect(ctx).toMatch(/<memory id="M\d+" category="module"[^>]*>The student's BSA lecturer is Dr Murphy\.<\/memory>/);
    // Proposed (unconfirmed) memories are not used as facts.
    expect(ctx).not.toContain("evening tutorial");
  });

  it("regenerates and edits by replacing the tail of the conversation", async () => {
    const conv = await client.json("POST", "/api/conversations", {});
    const id = conv.body.conversation.id;
    const first = await client.chat(id, { content: "First question" });
    const firstUser = first.events.find((e) => e.event === "user_message")!.data.message;

    await client.chat(id, { regenerate: true });
    let msgs = (await client.json("GET", `/api/conversations/${id}`)).body.messages;
    expect(msgs.map((m: any) => m.role)).toEqual(["user", "assistant"]);

    await client.chat(id, { content: "Edited question", editMessageId: firstUser.id });
    msgs = (await client.json("GET", `/api/conversations/${id}`)).body.messages;
    expect(msgs.map((m: any) => m.content)[0]).toBe("Edited question");
    expect(msgs).toHaveLength(2);
  });

  it("degrades to a clearly labelled offline answer when no AI is configured", async () => {
    setAIProvider(null); // env has no key → offline provider
    const conv = await client.json("POST", "/api/conversations", {});
    const { events } = await client.chat(conv.body.conversation.id, { content: "group project report weighting" });
    const done = events.find((e) => e.event === "done")!.data.message;
    expect(done.model).toBe("offline");
    expect(done.content).toMatch(/No AI model is connected/);
    expect(done.content).toContain("40 percent");
    setAIProvider(fake);
  });

  it("reports provider failures instead of hiding them", async () => {
    setAIProvider(
      Object.assign(new FakeAI(), {
        stream: async () => {
          throw new Error("provider exploded");
        },
      }),
    );
    const conv = await client.json("POST", "/api/conversations", {});
    const { events } = await client.chat(conv.body.conversation.id, { content: "hello" });
    const err = events.find((e) => e.event === "error")!;
    expect(err.data.error).toContain("provider exploded");
    expect(err.data.message.status).toBe("error");
    setAIProvider(fake);
  });
});

describe("chat helpers", () => {
  it("history selection respects the budget and starts on a user turn", () => {
    const mk = (role: string, content: string, i: number) => ({ id: String(i), role, content, status: "complete" }) as any;
    const h = [mk("user", "a".repeat(400), 1), mk("assistant", "b".repeat(400), 2), mk("user", "c".repeat(400), 3), mk("assistant", "d".repeat(400), 4)];
    const picked = selectHistory(h, 250);
    expect(picked[0].role).toBe("user");
    expect(picked.length).toBe(2);
  });

  it("only keeps citations that were offered", () => {
    const offered = new Map([["S1", { ref: "S1", kind: "document", title: "x", excerpt: "" } as any], ["M1", { ref: "M1", kind: "memory", title: "m", excerpt: "" } as any]]);
    const used = usedCitations("Claim [S1]. Another [S1, M1]. Fake [S7].", offered);
    expect(used.map((c) => c.ref)).toEqual(["S1", "M1"]);
  });
});
