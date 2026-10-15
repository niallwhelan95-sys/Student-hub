import { describe, expect, it } from "vitest";
import { cleanForSpeech, splitForSpeech } from "../web/src/lib/speech";

describe("read-aloud text preparation", () => {
  it("removes citation markers, markdown syntax, links and code so speech sounds natural", () => {
    const md = `## Marking criteria\n\nThe report is worth **40%** of the grade [S1]. See [the brief](https://x.test/brief) or https://x.test/raw [S2, M1].\n\n- Use *Harvard* referencing\n- Include \`MoSCoW\`\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n> Note this`;
    const out = cleanForSpeech(md);
    expect(out).not.toMatch(/\[S1\]|\[S2|\*\*|##|https?:|```|const a/);
    expect(out).toContain("Marking criteria");
    expect(out).toContain("The report is worth 40% of the grade");
    expect(out).toContain("the brief");
    expect(out).toContain("Use Harvard referencing");
    expect(out).toContain("code block skipped");
  });

  it("splits long text into sentence-sized pieces under the limit", () => {
    const long = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i} and it says something useful.`).join(" ");
    const pieces = splitForSpeech(long, 200);
    expect(pieces.length).toBeGreaterThan(5);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(220);
    expect(pieces.join(" ")).toContain("sentence number 29");
  });

  it("breaks a single enormous sentence and drops punctuation-only pieces", () => {
    const run = "word, ".repeat(200) + "end.";
    const pieces = splitForSpeech(run, 100);
    expect(pieces.every((p) => p.length <= 120)).toBe(true);
    expect(splitForSpeech("... !!! ???")).toEqual([]);
  });
});
