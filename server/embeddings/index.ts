import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "../env";

export type EmbedKind = "query" | "document";

export interface Embedder {
  /** Stored alongside each vector so stale embeddings can be detected and re-indexed. */
  readonly id: string;
  /** Cosine similarity below which a semantic-only match is treated as irrelevant. */
  readonly relevanceFloor: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

/** Local, private embeddings via transformers.js (BAAI bge-small-en-v1.5, 384 dims, quantised). */
class LocalEmbedder implements Embedder {
  readonly id = "local:bge-small-en-v1.5";
  readonly relevanceFloor = 0.55;
  private extractor: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | null = null;

  private load() {
    if (!this.extractor) {
      this.extractor = (async () => {
        const { pipeline, env: tenv } = await import("@huggingface/transformers");
        tenv.cacheDir = path.resolve(env.MODEL_CACHE_DIR);
        const pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" });
        return pipe as unknown as (texts: string[], opts: object) => Promise<{ tolist(): number[][] }>;
      })();
      this.extractor.catch(() => {
        this.extractor = null; // allow a later retry
      });
    }
    return this.extractor;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const extractor = await this.load();
    const prepared =
      kind === "query" ? texts.map((t) => `Represent this sentence for searching relevant passages: ${t}`) : texts;
    const out: number[][] = [];
    for (let i = 0; i < prepared.length; i += 16) {
      const batch = prepared.slice(i, i + 16).map((t) => t.slice(0, 2000));
      const result = await extractor(batch, { pooling: "cls", normalize: true });
      out.push(...result.tolist());
    }
    return out;
  }
}

class VoyageEmbedder implements Embedder {
  readonly id: string;
  readonly relevanceFloor = 0.35;
  constructor(
    private apiKey: string,
    private model: string,
  ) {
    this.id = `voyage:${model}`;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input: texts.slice(i, i + 64), model: this.model, input_type: kind }),
      });
      if (!res.ok) throw new Error(`Voyage embeddings failed (${res.status}): ${await res.text()}`);
      const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}

/**
 * Deterministic feature-hashing embedder. Not semantically strong — it exists so tests and
 * constrained environments get stable vectors without downloading a model.
 */
export class HashEmbedder implements Embedder {
  readonly id = "hash:v1";
  readonly relevanceFloor = 0.25;
  constructor(private dims = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dims).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
      for (const tok of tokens) {
        const h = createHash("md5").update(tok).digest();
        const idx = h.readUInt32LE(0) % this.dims;
        v[idx] += h[4] & 1 ? 1 : -1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

let embedder: Embedder | null | undefined;

export function getEmbedder(): Embedder | null {
  if (embedder !== undefined) return embedder;
  switch (env.EMBEDDINGS_PROVIDER) {
    case "local":
      embedder = new LocalEmbedder();
      break;
    case "voyage":
      embedder = env.VOYAGE_API_KEY ? new VoyageEmbedder(env.VOYAGE_API_KEY, env.VOYAGE_MODEL) : null;
      if (!embedder) console.warn("[embeddings] EMBEDDINGS_PROVIDER=voyage but VOYAGE_API_KEY is empty — keyword search only");
      break;
    case "hash":
      embedder = new HashEmbedder();
      break;
    default:
      embedder = null;
  }
  return embedder;
}

export function setEmbedder(e: Embedder | null): void {
  embedder = e;
}

/**
 * Embed texts, returning null instead of throwing when embeddings are unavailable — callers
 * fall back to keyword search, and the failure is logged rather than lost.
 */
export async function tryEmbed(
  texts: string[],
  kind: EmbedKind,
): Promise<{ vectors: number[][]; model: string; floor: number } | null> {
  const e = getEmbedder();
  if (!e || texts.length === 0) return null;
  try {
    return { vectors: await e.embed(texts, kind), model: e.id, floor: e.relevanceFloor };
  } catch (err) {
    console.warn(`[embeddings] ${e.id} failed; continuing with keyword search only:`, err instanceof Error ? err.message : err);
    return null;
  }
}
