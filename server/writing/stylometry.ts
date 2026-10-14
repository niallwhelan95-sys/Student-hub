import type { StyleStats } from "../db/schema";

/**
 * Deterministic, explainable style measurements. These ground the AI's qualitative profile
 * in evidence and give a usable (if coarser) profile even when no AI model is configured.
 */

const TRANSITIONS = [
  "however", "therefore", "furthermore", "moreover", "additionally", "in addition", "on the other hand",
  "for example", "for instance", "in contrast", "as a result", "consequently", "overall", "in conclusion",
  "to summarise", "to sum up", "similarly", "also", "but", "so", "because", "this means", "that said",
  "in other words", "firstly", "secondly", "finally", "meanwhile", "although", "whereas", "instead",
  "ultimately", "basically", "essentially", "of course", "in my opinion", "i think", "i feel", "i believe",
];
const HEDGES = ["might", "may", "could", "perhaps", "possibly", "likely", "seems", "suggests", "arguably", "somewhat", "probably", "tend to", "appears"];
const FIRST_PERSON = /\b(i|me|my|mine|myself|we|our|us)\b/gi;
const CONTRACTION = /\b\w+['’](s|t|re|ve|ll|d|m)\b/gi;
const PASSIVE = /\b(is|are|was|were|be|been|being)\s+(\w+ly\s+)?\w+(ed|en)\b/i;
const STOP = new Set("the a an and or but of to in on for with is are was were be been it this that as at by from which who what".split(" "));

export function splitSentences(text: string): string[] {
  return (text.replace(/\n+/g, " ").match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s) && s.split(/\s+/).length >= 2);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.split(" ").length >= 8);
}

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? [];

function topPhrases(counts: Map<string, number>, n: number, min = 2) {
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([phrase, count]) => ({ phrase, count }));
}

export function computeStyleStats(text: string): StyleStats {
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  const words = wordsOf(text);
  const wc = Math.max(words.length, 1);
  const per1k = (n: number) => Math.round((n / wc) * 1000 * 10) / 10;

  const lengths = sentences.map((s) => wordsOf(s).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(lengths.length, 1);
  const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(lengths.length, 1));

  const lower = text.toLowerCase();
  const transitions = new Map<string, number>();
  for (const t of TRANSITIONS) {
    const c = (lower.match(new RegExp(`\\b${t.replace(/ /g, "\\s+")}\\b`, "g")) ?? []).length;
    if (c) transitions.set(t, c);
  }

  const openers = new Map<string, number>();
  for (const s of sentences) {
    const w = wordsOf(s).slice(0, 2).join(" ");
    if (w) openers.set(w, (openers.get(w) ?? 0) + 1);
  }

  // Recurring 3-grams that aren't purely function words: a rough "signature phrase" signal.
  const trigrams = new Map<string, number>();
  for (let i = 0; i + 2 < words.length; i++) {
    const g = words.slice(i, i + 3);
    if (g.filter((w) => STOP.has(w)).length >= 2) continue;
    const k = g.join(" ");
    trigrams.set(k, (trigrams.get(k) ?? 0) + 1);
  }

  // Type-token ratio on a fixed window so long and short samples are comparable.
  const window = words.slice(0, 400);
  const ttr = window.length ? new Set(window).size / window.length : 0;

  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    avgSentenceLength: Math.round(mean * 10) / 10,
    sentenceLengthStdDev: Math.round(sd * 10) / 10,
    avgParagraphSentences: paragraphs.length ? Math.round((sentences.length / paragraphs.length) * 10) / 10 : 0,
    typeTokenRatio: Math.round(ttr * 100) / 100,
    avgWordLength: Math.round((words.join("").length / wc) * 10) / 10,
    firstPersonRate: per1k(count(FIRST_PERSON)),
    contractionRate: per1k(count(CONTRACTION)),
    questionRate: sentences.length ? Math.round((sentences.filter((s) => s.endsWith("?")).length / sentences.length) * 100) / 100 : 0,
    hedgingRate: per1k(HEDGES.reduce((n, h) => n + (lower.match(new RegExp(`\\b${h}\\b`, "g")) ?? []).length, 0)),
    passiveRate: sentences.length ? Math.round((sentences.filter((s) => PASSIVE.test(s)).length / sentences.length) * 100) / 100 : 0,
    topTransitions: topPhrases(transitions, 10, 1),
    signaturePhrases: topPhrases(trigrams, 10, 2),
    sentenceOpeners: topPhrases(openers, 8, 2),
    punctuation: {
      semicolons: per1k(count(/;/g)),
      colons: per1k(count(/:/g)),
      dashes: per1k(count(/\s[–—-]\s|—/g)),
      parentheses: per1k(count(/\(/g)),
      exclamations: per1k(count(/!/g)),
    },
  };
}

/** Word-count-weighted merge of per-sample stats into one aggregate. */
export function mergeStyleStats(all: StyleStats[]): StyleStats | null {
  const list = all.filter((s) => s.wordCount > 0);
  if (!list.length) return null;
  const total = list.reduce((s, x) => s + x.wordCount, 0);
  const w = (f: (s: StyleStats) => number) => Math.round((list.reduce((acc, s) => acc + f(s) * s.wordCount, 0) / total) * 100) / 100;
  const mergeLists = (f: (s: StyleStats) => { phrase: string; count: number }[], n: number) => {
    const m = new Map<string, number>();
    for (const s of list) for (const p of f(s)) m.set(p.phrase, (m.get(p.phrase) ?? 0) + p.count);
    return topPhrases(m, n, 1);
  };
  return {
    wordCount: total,
    sentenceCount: list.reduce((s, x) => s + x.sentenceCount, 0),
    paragraphCount: list.reduce((s, x) => s + x.paragraphCount, 0),
    avgSentenceLength: w((s) => s.avgSentenceLength),
    sentenceLengthStdDev: w((s) => s.sentenceLengthStdDev),
    avgParagraphSentences: w((s) => s.avgParagraphSentences),
    typeTokenRatio: w((s) => s.typeTokenRatio),
    avgWordLength: w((s) => s.avgWordLength),
    firstPersonRate: w((s) => s.firstPersonRate),
    contractionRate: w((s) => s.contractionRate),
    questionRate: w((s) => s.questionRate),
    hedgingRate: w((s) => s.hedgingRate),
    passiveRate: w((s) => s.passiveRate),
    topTransitions: mergeLists((s) => s.topTransitions, 10),
    signaturePhrases: mergeLists((s) => s.signaturePhrases, 10),
    sentenceOpeners: mergeLists((s) => s.sentenceOpeners, 8),
    punctuation: {
      semicolons: w((s) => s.punctuation.semicolons),
      colons: w((s) => s.punctuation.colons),
      dashes: w((s) => s.punctuation.dashes),
      parentheses: w((s) => s.punctuation.parentheses),
      exclamations: w((s) => s.punctuation.exclamations),
    },
  };
}

/** Plain-English rendering of stats for prompts and the profile page. */
export function describeStats(s: StyleStats): string[] {
  const lines: string[] = [];
  const len = s.avgSentenceLength;
  lines.push(
    `Sentences average ${len} words (${len < 14 ? "short and direct" : len < 22 ? "moderate length" : "long and developed"}), ` +
      `with ${s.sentenceLengthStdDev > 8 ? "lots of" : s.sentenceLengthStdDev > 4 ? "some" : "little"} variation (±${s.sentenceLengthStdDev}).`,
  );
  if (s.avgParagraphSentences) lines.push(`Paragraphs run about ${s.avgParagraphSentences} sentences.`);
  lines.push(
    s.firstPersonRate > 15
      ? `Writes in the first person often (${s.firstPersonRate}/1000 words).`
      : s.firstPersonRate > 3
        ? `Uses the first person occasionally.`
        : `Rarely uses the first person.`,
  );
  if (s.contractionRate > 8) lines.push("Uses contractions naturally (e.g. don't, it's).");
  else if (s.contractionRate < 1) lines.push("Avoids contractions.");
  if (s.hedgingRate > 8) lines.push("Hedges claims fairly often (might, could, seems).");
  if (s.passiveRate > 0.3) lines.push("Uses the passive voice quite a lot.");
  if (s.topTransitions.length) lines.push(`Favourite linking words: ${s.topTransitions.slice(0, 6).map((t) => `"${t.phrase}"`).join(", ")}.`);
  if (s.punctuation.semicolons < 0.5) lines.push("Rarely uses semicolons.");
  if (s.punctuation.dashes > 4) lines.push("Uses dashes for asides.");
  if (s.punctuation.parentheses > 4) lines.push("Often adds parenthetical asides.");
  return lines;
}
