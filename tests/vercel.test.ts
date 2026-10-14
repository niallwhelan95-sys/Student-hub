import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { drainJobs } from "../server/jobs/queue";
import { setStorage, type Storage, userPrefix } from "../server/storage";
import { getDb } from "../server/db/client";
import { documents } from "../server/db/schema";
import { Client, makePdf, setupTestApp, teardown, type TestApp } from "./helpers";

/** In-memory stand-in for private Vercel Blob storage (the browser writes to it directly). */
class FakeBlobStorage implements Storage {
  readonly kind = "blob" as const;
  files = new Map<string, Buffer>();
  async put(userId: string, data: Buffer, ext: string) {
    const key = `${userPrefix(userId)}${randomUUID()}${ext}`;
    this.files.set(key, data);
    return key;
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error("not found");
    return f;
  }
  async stream(key: string) {
    return new Response(new Uint8Array(await this.get(key))).body!;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

describe("direct-to-storage uploads (Vercel Blob mode)", () => {
  let app: TestApp;
  let client: Client;
  let userId: string;
  const store = new FakeBlobStorage();

  beforeAll(async () => {
    app = await setupTestApp();
    setStorage(store);
    client = new Client(app);
    userId = (await client.register()).body.user.id;
  });
  afterAll(teardown);

  const ingest = (pathname: string, filename: string, extra: Record<string, unknown> = {}) =>
    client.json("POST", "/api/documents/ingest-blob", { pathname, filename, ...extra });

  it("advertises direct uploads to the web app", async () => {
    expect((await client.json("GET", "/api/auth/me")).body.capabilities.directUploads).toBe(true);
  });

  it("registers a browser-uploaded file, processes it, and keeps it in storage", async () => {
    const key = `${userPrefix(userId)}handbook-abc.pdf`;
    store.files.set(key, makePdf(["The group project report is worth 40 percent of the final grade and must not exceed 3000 words."]));
    const res = await ingest(key, "Handbook.pdf");
    expect(res.status).toBe(200);
    const doc = res.body.results[0].document;
    expect(doc.status).toBe("queued");
    await drainJobs();
    const detail = await client.json("GET", `/api/documents/${doc.id}`);
    expect(detail.body.document.status).toBe("ready");
    expect(store.files.has(key)).toBe(true);

    // Original downloads stream back through the authorised route.
    const file = await client.req("GET", `/api/documents/${doc.id}/file`);
    expect(file.status).toBe(200);
    expect((await file.arrayBuffer()).byteLength).toBe(store.files.get(key)!.length);
  });

  it("refuses paths outside the signed-in user's folder", async () => {
    const other = `uploads/${randomUUID()}/stolen.pdf`;
    store.files.set(other, makePdf(["someone else's file with plenty of words to be indexed"]));
    expect((await ingest(other, "stolen.pdf")).status).toBe(400);
    expect((await ingest(`${userPrefix(userId)}../x.pdf`, "x.pdf")).status).toBe(400);
    expect(store.files.has(other)).toBe(true); // not touched either
  });

  it("deletes rejected uploads from storage so nothing lingers", async () => {
    const key = `${userPrefix(userId)}evil.pdf`;
    store.files.set(key, Buffer.from("MZ\x90\x00\x03\x00\x00\x00 not a pdf"));
    const res = await ingest(key, "evil.pdf");
    expect(res.body.results[0].error).toMatch(/Executable/);
    expect(store.files.has(key)).toBe(false);
  });

  it("discards the extra copy when the same file was already uploaded", async () => {
    const bytes = makePdf(["Duplicate detection should reuse the existing document and clean up the new blob copy."]);
    const a = `${userPrefix(userId)}dup-a.pdf`;
    const b = `${userPrefix(userId)}dup-b.pdf`;
    store.files.set(a, bytes);
    store.files.set(b, bytes);
    const first = await ingest(a, "dup.pdf");
    const second = await ingest(b, "dup copy.pdf");
    expect(second.body.results[0].duplicate).toBe(true);
    expect(second.body.results[0].document.id).toBe(first.body.results[0].document.id);
    expect(store.files.has(a)).toBe(true);
    expect(store.files.has(b)).toBe(false);
    const rows = await getDb().select().from(documents);
    expect(rows.filter((r) => r.filename === "dup.pdf" || r.filename === "dup copy.pdf")).toHaveLength(1);
  });

  it("only offers the token endpoint when blob storage is active", async () => {
    setStorage({ ...store, kind: "local" } as unknown as Storage);
    const res = await client.json("POST", "/api/documents/blob-token", {});
    expect(res.status).toBe(400);
    setStorage(store);
  });
});
