import JSZip from "jszip";
import mammoth from "mammoth";
import Papa from "papaparse";
import { normaliseWhitespace } from "../lib/text";
import type { FileKind } from "./detect";

export type ExtractedSection = {
  /** Human-readable source location used in citations: "Page 3", "Slide 7", "Sheet: Marks". */
  label: string;
  page?: number;
  heading?: string;
  text: string;
};

export type Extraction = {
  sections: ExtractedSection[];
  pageCount?: number;
  title?: string;
  method: string;
  warnings: string[];
  /** Set when text extraction was empty/insufficient and a vision model should read the file. */
  needsVision?: "image" | "pdf";
};

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

// ── PDF ────────────────────────────────────────────────────────────────────────
async function extractPdf(buf: Buffer): Promise<Extraction> {
  const { getDocumentProxy, extractText, getMeta } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  let title: string | undefined;
  try {
    const meta = await getMeta(pdf);
    const t = (meta.info as Record<string, unknown> | undefined)?.Title;
    if (typeof t === "string" && t.trim()) title = t.trim();
  } catch {
    /* metadata is optional */
  }
  const pages = (text as string[]).map((t, i) => ({ label: `Page ${i + 1}`, page: i + 1, text: normaliseWhitespace(t) }));
  const withText = pages.filter((p) => p.text.length > 40);
  const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
  const warnings: string[] = [];

  // Image-based / scanned PDFs have little or no text layer.
  if (totalChars / Math.max(totalPages, 1) < 80) {
    return {
      sections: withText,
      pageCount: totalPages,
      title,
      method: "pdf-text",
      warnings: ["Little or no selectable text — this looks like a scanned or image-based PDF."],
      needsVision: "pdf",
    };
  }
  const empty = totalPages - withText.length;
  if (empty > 0) warnings.push(`${empty} page(s) had no extractable text (possibly images or diagrams).`);
  return { sections: withText, pageCount: totalPages, title, method: "pdf-text", warnings };
}

// ── DOCX ───────────────────────────────────────────────────────────────────────
function htmlToStructuredText(html: string): string {
  return decodeXml(
    html
      .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|ul|ol|table)>/gi, "\n\n")
      .replace(/<tr[^>]*>/gi, "\n| ")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Split markdown-ish text into sections at headings, keeping the heading as context. */
export function splitByHeadings(text: string, labelPrefix = "Section"): ExtractedSection[] {
  const lines = normaliseWhitespace(text).split("\n");
  const sections: ExtractedSection[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) sections.push({ label: heading ? `${labelPrefix}: ${heading}` : `${labelPrefix} ${sections.length + 1}`, heading, text: body });
    buffer = [];
  };
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim().slice(0, 160);
    } else buffer.push(line);
  }
  flush();
  return sections;
}

/** The document's first heading (usually its title), even if no text sits directly under it. */
export function firstHeading(text: string): string | undefined {
  return text.match(/^#{1,6}\s+(.+)$/m)?.[1].trim().slice(0, 160);
}

async function extractDocx(buf: Buffer): Promise<Extraction> {
  const result = await mammoth.convertToHtml({ buffer: buf });
  const text = htmlToStructuredText(result.value);
  const warnings = result.messages
    .filter((m) => m.type === "warning")
    .slice(0, 3)
    .map((m) => m.message);
  return { sections: splitByHeadings(text), title: firstHeading(text), method: "docx-mammoth", warnings };
}

// ── PPTX ───────────────────────────────────────────────────────────────────────
function pptxParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const p of xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs;
}

async function extractPptx(buf: Buffer): Promise<Extraction> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const sections: ExtractedSection[] = [];
  let imageSlides = 0;
  for (const file of slideFiles) {
    const n = Number(file.match(/(\d+)\.xml$/)![1]);
    const xml = await zip.file(file)!.async("string");
    if (xml.includes("<p:pic>") || xml.includes("<p:pic ")) imageSlides++;
    const paragraphs = pptxParagraphs(xml);
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? pptxParagraphs(await notesFile.async("string")).filter((l) => !/^\d+$/.test(l)) : [];
    const heading = paragraphs[0]?.slice(0, 160);
    let body = paragraphs.join("\n");
    if (notes.length) body += `\n\nSpeaker notes:\n${notes.join("\n")}`;
    if (body.trim()) sections.push({ label: `Slide ${n}`, page: n, heading, text: body.trim() });
  }
  const warnings: string[] = [];
  if (imageSlides) warnings.push(`${imageSlides} slide(s) contain images or diagrams that were not analysed visually.`);
  return { sections, pageCount: slideFiles.length, title: sections[0]?.heading, method: "pptx-xml", warnings };
}

// ── XLSX ───────────────────────────────────────────────────────────────────────
const MAX_SHEET_ROWS = 2000;

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function extractXlsx(buf: Buffer): Promise<Extraction> {
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const sst = zip.file("xl/sharedStrings.xml");
  if (sst) {
    const xml = await sst.async("string");
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join(""));
    }
  }
  const workbook = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const relTargets = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({
    name: decodeXml(m[1]),
    path: "xl/" + (relTargets.get(m[2]) ?? "").replace(/^\/?xl\//, ""),
  }));

  const sections: ExtractedSection[] = [];
  const warnings: string[] = [];
  for (const sheet of sheets) {
    const file = zip.file(sheet.path);
    if (!file) continue;
    const xml = await file.async("string");
    const rows: string[][] = [];
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      if (rows.length >= MAX_SHEET_ROWS) {
        warnings.push(`Sheet "${sheet.name}" was truncated to ${MAX_SHEET_ROWS} rows.`);
        break;
      }
      const cells: string[] = [];
      for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = c.match(/r="([A-Z]+\d+)"/)?.[1] ?? "A1";
        const type = c.match(/t="(\w+)"/)?.[1];
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr" && inline !== undefined) value = decodeXml(inline);
        else if (v !== undefined) value = decodeXml(v);
        cells[colIndex(ref)] = value.replace(/\|/g, "/").replace(/\n/g, " ");
      }
      if (cells.some((x) => x && x.trim())) rows.push(Array.from(cells, (x) => x ?? ""));
    }
    if (rows.length) sections.push(...tableToSections(rows, `Sheet: ${sheet.name}`));
  }
  return { sections, pageCount: sheets.length, method: "xlsx-xml", warnings };
}

/** Render a table as markdown in blocks of rows, repeating the header for context. */
function tableToSections(rows: string[][], label: string, blockSize = 40): ExtractedSection[] {
  const header = rows[0];
  const width = Math.max(...rows.map((r) => r.length));
  const fmt = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const sections: ExtractedSection[] = [];
  for (let i = 1; i < Math.max(rows.length, 2); i += blockSize) {
    const block = rows.slice(i, i + blockSize);
    const lines = [fmt(header), `|${" --- |".repeat(width)}`, ...block.map(fmt)];
    const range = rows.length > blockSize + 1 ? ` (rows ${i + 1}–${i + block.length})` : "";
    sections.push({ label: `${label}${range}`, heading: label, text: lines.join("\n") });
  }
  return sections;
}

function extractCsv(buf: Buffer): Extraction {
  const parsed = Papa.parse<string[]>(buf.toString("utf8"), { skipEmptyLines: true });
  const rows = parsed.data.slice(0, MAX_SHEET_ROWS + 1);
  const warnings = parsed.data.length > rows.length ? [`Truncated to ${MAX_SHEET_ROWS} rows.`] : [];
  if (parsed.errors.length) warnings.push(`${parsed.errors.length} row(s) could not be parsed cleanly.`);
  return { sections: rows.length ? tableToSections(rows, "Table") : [], method: "csv", warnings };
}

// ── Plain text / code ─────────────────────────────────────────────────────────
function extractText(buf: Buffer, kind: "text" | "code", ext: string): Extraction {
  let text = buf.toString("utf8").replace(/^﻿/, "");
  if (ext === ".ipynb") {
    try {
      const nb = JSON.parse(text) as { cells?: { cell_type: string; source: string[] | string }[] };
      text = (nb.cells ?? [])
        .map((c) => {
          const src = Array.isArray(c.source) ? c.source.join("") : c.source;
          return c.cell_type === "code" ? "```\n" + src + "\n```" : src;
        })
        .join("\n\n");
    } catch {
      /* fall through with raw JSON */
    }
  }
  if (ext === ".html" || ext === ".htm") text = htmlToStructuredText(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ""));

  if (kind === "code") {
    const lines = text.split(/\r?\n/);
    const sections: ExtractedSection[] = [];
    for (let i = 0; i < lines.length; i += 120) {
      const end = Math.min(i + 120, lines.length);
      sections.push({ label: `Lines ${i + 1}–${end}`, page: i + 1, text: lines.slice(i, end).join("\n") });
    }
    return { sections: sections.filter((s) => s.text.trim()), method: "code", warnings: [] };
  }
  const sections = /^#{1,6}\s/m.test(text) ? splitByHeadings(text) : [{ label: "Text", text: normaliseWhitespace(text) }];
  return { sections: sections.filter((s) => s.text.trim()), title: firstHeading(text), method: "text", warnings: [] };
}

export async function extractDocument(kind: FileKind, buf: Buffer, ext: string): Promise<Extraction> {
  switch (kind) {
    case "pdf":
      return extractPdf(buf);
    case "docx":
      return extractDocx(buf);
    case "pptx":
      return extractPptx(buf);
    case "xlsx":
      return extractXlsx(buf);
    case "csv":
      return extractCsv(buf);
    case "image":
      return { sections: [], method: "image", warnings: [], needsVision: "image" };
    case "text":
    case "code":
      return extractText(buf, kind, ext);
  }
}
