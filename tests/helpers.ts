import JSZip from "jszip";
import type { ZodType } from "zod";
import { closeDb, initDb } from "../server/db/client";
import { createApp } from "../server/app";
import { setAIProvider, type AICall, type AIProvider, type AIResult } from "../server/ai";

export type TestApp = ReturnType<typeof createApp>;

export async function setupTestApp(): Promise<TestApp> {
  await closeDb();
  await initDb({ memory: true });
  return createApp();
}

export async function teardown() {
  setAIProvider(null);
  await closeDb();
}

/** Minimal HTTP client around app.request that keeps the session cookie and CSRF header. */
export class Client {
  cookie = "";
  constructor(private app: TestApp) {}

  async req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { "x-margin-client": "1", ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await this.app.request(path, { method, headers, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = set.match(/margin_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `margin_session=${m[1]}` : "";
    }
    return res;
  }

  async json<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await this.req(method, path, body);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async register(email = "student@example.test", password = "correct horse battery", displayName = "Sam") {
    return this.json("POST", "/api/auth/register", { email, password, displayName });
  }

  async upload(filename: string, data: Buffer, fields: Record<string, string> = {}) {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(data)], filename));
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await this.req("POST", "/api/documents", form);
    return { status: res.status, body: (await res.json()) as any };
  }

  /** Send a chat message and collect the SSE events. */
  async chat(conversationId: string, body: Record<string, unknown>) {
    const res = await this.req("POST", `/api/conversations/${conversationId}/messages`, body);
    const text = await res.text();
    const events: { event: string; data: any }[] = [];
    for (const block of text.split("\n\n")) {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data) });
    }
    return { status: res.status, events };
  }
}

/** Scripted AI provider: records every call and answers via the supplied handlers. */
export class FakeAI implements AIProvider {
  readonly id = "fake";
  readonly configured = true;
  calls: AICall[] = [];
  constructor(
    public handlers: {
      chat?: (call: AICall) => string;
      complete?: (call: AICall) => string;
      structured?: (call: AICall) => unknown;
    } = {},
  ) {}

  private result(text: string): AIResult {
    return { text, model: "fake-model", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 }, refused: false, aborted: false };
  }

  async stream(call: AICall, onText: (d: string) => void): Promise<AIResult> {
    this.calls.push(call);
    const text = (call.purpose === "chat" ? this.handlers.chat : this.handlers.complete)?.(call) ?? "OK";
    for (const piece of text.match(/.{1,12}/gs) ?? []) onText(piece);
    return this.result(text);
  }

  async complete(call: AICall): Promise<AIResult> {
    this.calls.push(call);
    return this.result(this.handlers.complete?.(call) ?? "OK");
  }

  async structured<T>(call: AICall, schema: ZodType<T>): Promise<T | null> {
    this.calls.push(call);
    const out = this.handlers.structured?.(call);
    if (out === undefined) return null;
    return schema.parse(out);
  }

  lastUserText(purpose = "chat"): string {
    const call = [...this.calls].reverse().find((c) => c.purpose === purpose);
    const last = call?.messages[call.messages.length - 1];
    if (!last) return "";
    return typeof last.content === "string" ? last.content : last.content.map((p) => (p.type === "text" ? p.text : "")).join("");
  }
}

// ── Fixture builders ─────────────────────────────────────────────────────────

/** A small but valid multi-page PDF with a real text layer. */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const lines = text.split("\n").map((l, j) => `BT /F1 12 Tf 72 ${720 - j * 18} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(lines)} >>\nstream\n${lines}\nendstream`;
  });
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function makeDocx(paragraphs: { text: string; heading?: boolean }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs
    .map((p) =>
      p.heading
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(p.text)}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function makePptx(slides: { title: string; bullets: string[]; notes?: string }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`);
  slides.forEach((s, i) => {
    const paras = [s.title, ...s.bullets].map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join("");
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (s.notes) zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, `<p:notes xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>${esc(s.notes)}</a:t></a:r></a:p></p:notes>`);
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function makeXlsx(sheetName: string, rows: (string | number)[][]): Promise<Buffer> {
  const zip = new JSZip();
  const shared: string[] = [];
  const idx = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const sheetRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((v, ci) => {
            const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
            return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`);
  zip.file("xl/workbook.xml", `<workbook xmlns:r="r"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/sharedStrings.xml", `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`);
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
