import type { ExtractedSection } from "./extract";

export type Chunk = {
  ordinal: number;
  label: string;
  page?: number;
  heading?: string;
  text: string;
};

const words = (s: string) => s.split(/\s+/).filter(Boolean);

function splitLongParagraph(p: string, maxWords: number): string[] {
  const sentences = p.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$/g) ?? [p];
  const out: string[] = [];
  let cur: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const n = words(s).length;
    if (count + n > maxWords && cur.length) {
      out.push(cur.join("").trim());
      cur = [];
      count = 0;
    }
    if (n > maxWords) {
      // A single enormous "sentence" (e.g. a table row dump) — hard-split by words.
      const w = words(s);
      for (let i = 0; i < w.length; i += maxWords) out.push(w.slice(i, i + maxWords).join(" "));
      continue;
    }
    cur.push(s);
    count += n;
  }
  if (cur.length) out.push(cur.join("").trim());
  return out;
}

/**
 * Split extracted sections into retrieval-sized chunks without crossing section (page/slide)
 * boundaries, so every chunk maps back to a precise citation location. Consecutive chunks
 * of one section overlap slightly to keep context across the split.
 */
export function chunkSections(sections: ExtractedSection[], maxWords = 350, overlapWords = 40): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const paragraphs = section.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => (words(p).length > maxWords ? splitLongParagraph(p, maxWords) : [p]));

    const parts: string[] = [];
    let cur: string[] = [];
    let count = 0;
    for (const p of paragraphs) {
      const n = words(p).length;
      if (count + n > maxWords && cur.length) {
        parts.push(cur.join("\n\n"));
        const tail = words(cur.join(" ")).slice(-overlapWords).join(" ");
        cur = overlapWords > 0 ? [`…${tail}`] : [];
        count = overlapWords > 0 ? words(tail).length : 0;
      }
      cur.push(p);
      count += n;
    }
    if (cur.length && !(cur.length === 1 && cur[0].startsWith("…") && parts.length)) parts.push(cur.join("\n\n"));

    parts.forEach((text, i) => {
      chunks.push({
        ordinal: chunks.length,
        label: parts.length > 1 ? `${section.label} (part ${i + 1})` : section.label,
        page: section.page,
        heading: section.heading,
        text,
      });
    });
  }
  return chunks;
}
