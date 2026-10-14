/**
 * Strip text that is not the student's own prose before style analysis: reference lists,
 * quotations, inline citations, cover-sheet fields and marker feedback. Returns the cleaned
 * text plus notes describing what was removed, so the student can see and correct it.
 */
export function cleanOwnWriting(raw: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  let text = raw.replace(/\r\n?/g, "\n");

  // Reference list / bibliography: drop from the heading to the end (or to the next appendix).
  const refMatch = text.match(/\n\s*(references|reference list|bibliography|works cited|sources)\s*:?\s*\n/i);
  if (refMatch && refMatch.index !== undefined && refMatch.index > text.length * 0.4) {
    const after = text.slice(refMatch.index + refMatch[0].length);
    const appendix = after.search(/\n\s*appendi(x|ces)\b/i);
    text = text.slice(0, refMatch.index) + (appendix >= 0 ? after.slice(appendix) : "");
    notes.push("Removed the reference list.");
  }

  const lines = text.split("\n");
  const kept: string[] = [];
  let feedback = 0;
  let cover = 0;
  let blockQuotes = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^(feedback|marker'?s? comments?|tutor comments?|lecturer comments?|comment|grade|mark awarded)\s*[:\-]/i.test(t)) {
      feedback++;
      continue;
    }
    if (/^(student (id|number|name)|module( code)?|word count|submission date|lecturer|assignment title|course)\s*[:\-]/i.test(t)) {
      cover++;
      continue;
    }
    if (/^>/.test(t)) {
      blockQuotes++;
      continue;
    }
    kept.push(line);
  }
  if (feedback) notes.push(`Removed ${feedback} line(s) that look like marker feedback.`);
  if (cover) notes.push(`Removed ${cover} cover-sheet field(s).`);
  if (blockQuotes) notes.push(`Removed ${blockQuotes} block-quote line(s).`);
  text = kept.join("\n");

  // Long direct quotations are someone else's words.
  let quotes = 0;
  text = text.replace(/["“]([^"”\n]{60,})["”]/g, () => {
    quotes++;
    return "[quotation]";
  });
  if (quotes) notes.push(`Replaced ${quotes} long quotation(s).`);

  // Inline citations: (Smith, 2020), (Smith & Jones, 2019, p. 4), (Smith et al. 2018), [12]
  let cites = 0;
  text = text.replace(/\s?\((?:[A-Z][\p{L}'’-]+(?:\s(?:et al\.?|&|and)\s?[A-Z]?[\p{L}'’-]*)*,?\s\d{4}[a-z]?(?:[,;]\s?(?:p{1,2}\.\s?\d+[-–]?\d*|[A-Z][^()]*?\d{4}))*)\)/gu, () => {
    cites++;
    return "";
  });
  text = text.replace(/\s?\[\d+(?:[,–-]\s?\d+)*\]/g, () => {
    cites++;
    return "";
  });
  if (cites) notes.push(`Removed ${cites} inline citation(s) (kept your sentences).`);

  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, notes };
}
