import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStyleStats, describeStats } from "../server/writing/stylometry";
import { cleanOwnWriting } from "../server/writing/clean";
import { hasWritingIntent, inferWritingContext } from "../server/writing/service";
import { setAIProvider } from "../server/ai";
import { drainJobs } from "../server/jobs/queue";
import { Client, FakeAI, setupTestApp, teardown, type TestApp } from "./helpers";

const SAMPLE = `I think the main problem with the old system is that nobody really owned it. People just added bits when they needed them, so it grew into this messy thing that no one fully understood.

For example, the booking module and the stock module both stored customer details, but they didn't match. That's a big deal, because staff ended up phoning customers twice. It sounds small but it adds up.

So my recommendation is pretty simple. Pick one place for customer data and make everything else read from it. It won't fix everything, but it fixes the thing that causes the most pain.`;

describe("stylometry", () => {
  it("measures sentence length, first person, contractions and transitions", () => {
    const s = computeStyleStats(SAMPLE);
    expect(s.wordCount).toBeGreaterThan(90);
    expect(s.paragraphCount).toBe(3);
    expect(s.avgSentenceLength).toBeGreaterThan(8);
    expect(s.firstPersonRate).toBeGreaterThan(0);
    expect(s.contractionRate).toBeGreaterThan(8);
    expect(s.topTransitions.map((t) => t.phrase)).toEqual(expect.arrayContaining(["for example", "so", "but"]));
    expect(describeStats(s).join(" ")).toMatch(/contractions/);
  });
});

describe("own-writing cleaning", () => {
  it("removes references, citations, quotes, feedback and cover fields but keeps the student's sentences", () => {
    const raw = `Student ID: 12345
Word count: 1500
The system was badly designed (Smith, 2020). I argue it needs one source of truth [3].
"This is a very long quotation copied from a textbook that is definitely not the student's own words at all."
Feedback: good structure, weak evidence.
My conclusion is that we should consolidate the databases.

References
Smith, J. (2020) Systems. London: Press.`;
    const { text, notes } = cleanOwnWriting(raw);
    expect(text).toContain("The system was badly designed.");
    expect(text).toContain("I argue it needs one source of truth.");
    expect(text).toContain("My conclusion is that we should consolidate");
    expect(text).not.toMatch(/Smith|12345|Feedback|textbook/);
    expect(notes.length).toBeGreaterThanOrEqual(4);
  });
});

describe("writing intent", () => {
  it("detects writing requests and their context", () => {
    expect(hasWritingIntent("Can you help me rewrite my introduction?")).toBe(true);
    expect(hasWritingIntent("When is the exam?")).toBe(false);
    expect(inferWritingContext("draft my reflective journal entry")).toBe("reflective");
    expect(inferWritingContext("tidy up section 2 of the business report")).toBe("report");
  });
});

describe("writing profile end-to-end", () => {
  let app: TestApp;
  let client: Client;
  let fake: FakeAI;

  beforeAll(async () => {
    app = await setupTestApp();
    client = new Client(app);
    await client.register();
  });
  afterAll(teardown);

  it("builds a stats-only profile without AI, then a full profile with AI", async () => {
    const add = await client.json("POST", "/api/writing/samples", {
      title: "Systems essay",
      text: SAMPLE,
      context: "essay",
      origin: "paste",
      confirmedOwnWork: true,
    });
    expect(add.status).toBe(201);
    await drainJobs();
    let w = await client.json("GET", "/api/writing");
    const general = w.body.profiles.find((p: any) => p.context === "general");
    expect(general.sampleCount).toBe(1);
    expect(general.confidence).toBe("low");
    expect(general.profile).toBeNull();
    expect(general.statsDescription.length).toBeGreaterThan(0);

    fake = new FakeAI({
      structured: (call) =>
        call.purpose === "writing.profile"
          ? {
              summary: "Plain-spoken and practical; builds arguments from concrete workplace examples.",
              voice: ["Opens with a personal judgement (\"I think the main problem…\")"],
              vocabulary: ["Everyday words: 'messy', 'bits', 'a big deal'"],
              sentenceStructure: ["Short-to-medium sentences, occasional fragments for emphasis"],
              organisation: ["Problem → example → recommendation"],
              argumentation: ["Uses concrete consequences to justify claims"],
              formality: "Conversational-academic: clear and direct, avoids jargon",
              preferredTransitions: ["For example", "So", "but"],
              phrasesToKeep: ["It sounds small but it adds up"],
              avoid: ["'Furthermore', 'moreover', 'delve'"],
              improvementGoals: ["Support claims with sources"],
              uncertainties: ["Only one sample — formality range unknown"],
            }
          : undefined,
      chat: () => "Here's a draft in your voice.",
    });
    setAIProvider(fake);
    await client.json("POST", "/api/writing/profiles/general/rebuild");
    await drainJobs();
    w = await client.json("GET", "/api/writing");
    expect(w.body.profiles.find((p: any) => p.context === "general").profile.summary).toMatch(/Plain-spoken/);
  });

  it("applies the student's corrections and retrieves the profile + exemplars for writing requests only", async () => {
    await client.json("PATCH", "/api/writing/profiles/general", { userNotes: "Never use the word 'utilise'." });
    await drainJobs();
    const conv = await client.json("POST", "/api/conversations", {});
    await client.chat(conv.body.conversation.id, { content: "Help me rewrite this paragraph about the booking system so it sounds like me." });
    const ctx = fake.lastUserText();
    expect(ctx).toContain("<writing_profile>");
    expect(ctx).toContain("Never use the word 'utilise'.");
    expect(ctx).toContain("Plain-spoken");
    expect(ctx).toMatch(/<example n="1">/);

    await client.chat(conv.body.conversation.id, { content: "When is the library open?" });
    expect(fake.lastUserText()).not.toContain("<writing_profile>");
  });

  it("can disable personalisation", async () => {
    await client.json("PATCH", "/api/writing/profiles/general", { enabled: false });
    await client.json("PATCH", "/api/writing/profiles/essay", { enabled: false });
    const conv = await client.json("POST", "/api/conversations", {});
    await client.chat(conv.body.conversation.id, { content: "Draft my essay introduction" });
    expect(fake.lastUserText()).not.toContain("<writing_profile>");
  });

  it("rejects samples that are too short to learn from", async () => {
    const res = await client.json("POST", "/api/writing/samples", { title: "x", text: "Too short.", context: "general", origin: "paste", confirmedOwnWork: true });
    expect(res.status).toBe(400);
  });
});
