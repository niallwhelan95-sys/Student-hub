/** Rough token estimate (≈4 chars/token for English prose). Used for budgeting context, not billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + "…";
}

export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** Escape a value for inclusion inside an XML-ish prompt tag body. */
export function escapeForPrompt(text: string): string {
  return text.replace(/<\/?(system|instructions|source|sources|memory|document)[^>]*>/gi, (m) => m.replace(/</g, "‹").replace(/>/g, "›"));
}
