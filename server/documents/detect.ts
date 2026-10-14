import path from "node:path";

export type FileKind = "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "image" | "text" | "code";

export type Detection =
  | { ok: true; kind: FileKind; mimeType: string; ext: string }
  | { ok: false; reason: string };

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".rtf", ".json", ".xml", ".html", ".htm", ".tex", ".bib", ".yaml", ".yml"]);
const CODE_EXT = new Set([
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs",
  ".rb", ".php", ".swift", ".kt", ".scala", ".r", ".m", ".sql", ".sh", ".ps1", ".css", ".scss", ".ipynb", ".lua", ".dart",
]);

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  const decoded = sample.toString("utf8");
  const replacement = (decoded.match(/�/g) ?? []).length;
  return replacement / Math.max(decoded.length, 1) < 0.01;
}

/**
 * Identify a file by its content (magic bytes) cross-checked with the extension. The
 * extension alone is never trusted, and executable/unknown binaries are rejected.
 */
export function detectFile(filename: string, buf: Buffer): Detection {
  const ext = path.extname(filename).toLowerCase();
  if (buf.length === 0) return { ok: false, reason: "The file is empty." };

  if (startsWith(buf, [0x4d, 0x5a]) || startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) {
    return { ok: false, reason: "Executable files can't be uploaded." };
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return { ok: true, kind: "pdf", mimeType: "application/pdf", ext: ".pdf" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { ok: true, kind: "image", mimeType: "image/png", ext: ".png" };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { ok: true, kind: "image", mimeType: "image/jpeg", ext: ".jpg" };
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { ok: true, kind: "image", mimeType: "image/gif", ext: ".gif" };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ok: true, kind: "image", mimeType: "image/webp", ext: ".webp" };
  }
  if (buf.length > 12 && buf.subarray(4, 12).toString("latin1").match(/^ftyp(heic|heix|mif1|hevc)/)) {
    return { ok: false, reason: "HEIC photos aren't supported yet — please export as JPEG or PNG (or take a screenshot)." };
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) {
    return { ok: false, reason: "Legacy Office formats (.doc/.ppt/.xls) aren't supported — re-save as .docx, .pptx or .xlsx." };
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const head = buf.toString("latin1");
    if (ext === ".docx" || head.includes("word/")) {
      return { ok: true, kind: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx" };
    }
    if (ext === ".pptx" || head.includes("ppt/")) {
      return { ok: true, kind: "pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ".pptx" };
    }
    if (ext === ".xlsx" || head.includes("xl/")) {
      return { ok: true, kind: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" };
    }
    return { ok: false, reason: "ZIP archives aren't supported — upload the files inside it individually." };
  }

  if (looksLikeText(buf)) {
    if (ext === ".csv" || ext === ".tsv") return { ok: true, kind: "csv", mimeType: "text/csv", ext };
    if (CODE_EXT.has(ext)) return { ok: true, kind: "code", mimeType: "text/plain", ext };
    if (TEXT_EXT.has(ext) || ext === "") {
      return { ok: true, kind: "text", mimeType: ext === ".md" || ext === ".markdown" ? "text/markdown" : "text/plain", ext: ext || ".txt" };
    }
    // Unknown extension but clearly text — accept as plain text.
    return { ok: true, kind: "text", mimeType: "text/plain", ext };
  }

  return { ok: false, reason: `Unsupported file type${ext ? ` (${ext})` : ""}.` };
}
