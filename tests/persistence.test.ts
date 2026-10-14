import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../server/env";
import { closeDb, initDb } from "../server/db/client";
import { createApp } from "../server/app";
import { drainJobs } from "../server/jobs/queue";
import { Client, makePdf } from "./helpers";

describe("persistence across restarts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "margin-persist-"));
  afterAll(async () => {
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the session, conversation, messages, documents and memories after the server restarts", async () => {
    await closeDb();
    env.PGLITE_DIR = dir;
    await initDb();
    let client = new Client(createApp());
    await client.register();
    const conv = await client.json("POST", "/api/conversations", { title: "Essay planning" });
    await client.chat(conv.body.conversation.id, { content: "Remember this for later" });
    await client.upload("notes.pdf", makePdf(["Lecture notes about normalisation, functional dependencies and third normal form in databases."]));
    await drainJobs();
    await client.json("POST", "/api/memory", { content: "The student prefers examples before theory.", category: "preference" });
    const cookie = client.cookie;

    // "Restart": close and reopen the on-disk database.
    await closeDb();
    await initDb();
    client = new Client(createApp());
    client.cookie = cookie;

    const list = await client.json("GET", "/api/conversations");
    expect(list.status).toBe(200);
    expect(list.body.conversations[0].title).toBe("Essay planning");
    const detail = await client.json("GET", `/api/conversations/${conv.body.conversation.id}`);
    expect(detail.body.messages[0].content).toBe("Remember this for later");
    const docs = await client.json("GET", "/api/documents");
    expect(docs.body.documents[0].status).toBe("ready");
    const search = await client.json("GET", "/api/search?q=third normal form");
    expect(search.body.documents[0].filename).toBe("notes.pdf");
    const mem = await client.json("GET", "/api/memory");
    expect(mem.body.memories[0].content).toContain("examples before theory");
  });
});
