import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  APP_URL: z.string().default("http://localhost:5173"),

  DATABASE_URL: optionalString,
  PGLITE_DIR: z.string().default("./data/db"),

  UPLOAD_DIR: z.string().default("./data/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(30),
  REGISTRATION_MODE: z.enum(["first-user", "open", "closed"]).default("first-user"),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_AUTH_TOKEN: optionalString,
  AI_CHAT_MODEL: z.string().default("claude-opus-5-5"),
  AI_CHAT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  AI_BACKGROUND_MODEL: z.string().default("claude-opus-5-5"),
  AI_BACKGROUND_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),

  // On Vercel the local model (~300 MB of native runtime) doesn't fit a function bundle, so the
  // default there is Voyage when a key is present, otherwise keyword-only search.
  EMBEDDINGS_PROVIDER: z
    .enum(["local", "voyage", "none", "hash"])
    .default(process.env.VERCEL ? (process.env.VOYAGE_API_KEY ? "voyage" : "none") : "local"),
  STORAGE_DRIVER: z
    .enum(["local", "blob"])
    .default(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? "blob" : "local"),
  VOYAGE_API_KEY: optionalString,
  VOYAGE_MODEL: z.string().default("voyage-3.5"),
  MODEL_CACHE_DIR: z.string().default("./data/models"),

  STT_BASE_URL: z.string().default("https://api.openai.com/v1"),
  STT_API_KEY: optionalString,
  STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),

  JOB_POLL_MS: z.coerce.number().int().positive().default(1000),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const isProd = env.NODE_ENV === "production";
/** Running as a Vercel Function: no persistent disk, no always-on process. */
export const isVercel = !!process.env.VERCEL;
export const isTest = env.NODE_ENV === "test" || process.env.VITEST === "true";
