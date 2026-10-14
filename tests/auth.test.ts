import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../server/env";
import { hashPassword, verifyPassword } from "../server/auth/password";
import { Client, setupTestApp, teardown, type TestApp } from "./helpers";

describe("authentication and isolation", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });
  afterAll(teardown);

  it("hashes passwords with scrypt and verifies them", async () => {
    const h = await hashPassword("a long passphrase");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("a long passphrase", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("lets only the first user register in first-user mode", async () => {
    const a = new Client(app);
    expect((await a.register("a@example.test")).status).toBe(200);
    const b = new Client(app);
    const res = await b.register("b@example.test");
    expect(res.status).toBe(403);
  });

  it("rejects bad credentials and requires a session for the API", async () => {
    const c = new Client(app);
    expect((await c.json("POST", "/api/auth/login", { email: "a@example.test", password: "nope" })).status).toBe(401);
    expect((await c.json("GET", "/api/conversations")).status).toBe(401);
    expect((await c.json("POST", "/api/auth/login", { email: "a@example.test", password: "correct horse battery" })).status).toBe(200);
    expect((await c.json("GET", "/api/conversations")).status).toBe(200);
    await c.json("POST", "/api/auth/logout");
    expect((await c.json("GET", "/api/conversations")).status).toBe(401);
  });

  it("requires the CSRF client header on state-changing requests", async () => {
    const c = new Client(app);
    await c.json("POST", "/api/auth/login", { email: "a@example.test", password: "correct horse battery" });
    const res = await app.request("/api/conversations", {
      method: "POST",
      headers: { cookie: c.cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("keeps each user's data private", async () => {
    env.REGISTRATION_MODE = "open";
    const a = new Client(app);
    await a.json("POST", "/api/auth/login", { email: "a@example.test", password: "correct horse battery" });
    const conv = await a.json("POST", "/api/conversations", { title: "Private" });
    const mem = await a.json("POST", "/api/memory", { content: "Secret plan for my dissertation", category: "general" });

    const b = new Client(app);
    expect((await b.register("b2@example.test")).status).toBe(200);
    expect((await b.json("GET", `/api/conversations/${conv.body.conversation.id}`)).status).toBe(404);
    expect((await b.json("DELETE", `/api/memory/${mem.body.memory.id}`)).status).toBe(404);
    expect((await b.json("GET", "/api/memory")).body.memories).toHaveLength(0);
    const search = await b.json("GET", "/api/search?q=dissertation");
    expect(search.body.memories).toHaveLength(0);
    env.REGISTRATION_MODE = "first-user";
  });

  it("exports and deletes the account", async () => {
    const a = new Client(app);
    await a.json("POST", "/api/auth/login", { email: "a@example.test", password: "correct horse battery" });
    const exp = await a.req("GET", "/api/account/export");
    const data = JSON.parse(await exp.text());
    expect(data.memories[0].content).toContain("dissertation");
    expect(data.memories[0].embedding).toBeUndefined();
    expect((await a.json("DELETE", "/api/account", { password: "wrong", confirm: "DELETE" })).status).toBe(401);
    expect((await a.json("DELETE", "/api/account", { password: "correct horse battery", confirm: "DELETE" })).status).toBe(200);
    expect((await a.json("POST", "/api/auth/login", { email: "a@example.test", password: "correct horse battery" })).status).toBe(401);
  });
});
