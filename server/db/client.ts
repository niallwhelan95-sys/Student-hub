import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import postgres from "postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "../env";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Backend =
  | { kind: "pglite"; client: PGlite }
  | { kind: "postgres"; client: postgres.Sql };

let backend: Backend | null = null;
let database: DB | null = null;

export type InitOptions = { memory?: boolean };

/** Opens the database (embedded PGlite unless DATABASE_URL is set) and applies pending migrations. */
export async function initDb(opts: InitOptions = {}): Promise<DB> {
  if (database) return database;

  if (env.DATABASE_URL && !opts.memory) {
    const client = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
    backend = { kind: "postgres", client };
    database = drizzlePostgres(client, { schema }) as unknown as DB;
  } else {
    let dataDir: string | undefined;
    if (!opts.memory) {
      dataDir = path.resolve(env.PGLITE_DIR);
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const client = await PGlite.create({ dataDir, extensions: { vector } });
    backend = { kind: "pglite", client };
    database = drizzlePglite(client, { schema }) as unknown as DB;
  }

  await runMigrations();
  return database;
}

export function getDb(): DB {
  if (!database) throw new Error("Database not initialised — call initDb() first");
  return database;
}

export function dbKind(): Backend["kind"] | null {
  return backend?.kind ?? null;
}

export async function closeDb(): Promise<void> {
  if (!backend) return;
  if (backend.kind === "pglite") await backend.client.close();
  else await backend.client.end();
  backend = null;
  database = null;
}

/** Run a raw SQL query (built with drizzle's `sql` template) and return plain rows. */
export async function rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const result = (await getDb().execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

async function execRaw(text: string): Promise<void> {
  if (!backend) throw new Error("Database not initialised");
  if (backend.kind === "pglite") await backend.client.exec(text);
  else await backend.client.unsafe(text);
}

async function queryRaw<T>(text: string): Promise<T[]> {
  if (!backend) throw new Error("Database not initialised");
  if (backend.kind === "pglite") return (await backend.client.query<T>(text)).rows;
  return (await backend.client.unsafe(text)) as unknown as T[];
}

const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));

/** Minimal forward-only migration runner: applies ./migrations/*.sql in filename order, once each. */
export async function runMigrations(): Promise<string[]> {
  await execRaw(
    `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied = new Set((await queryRaw<{ name: string }>(`SELECT name FROM _migrations`)).map((r) => r.name));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const safeName = file.replace(/'/g, "''");
    await execRaw(`BEGIN;\n${text}\nINSERT INTO _migrations (name) VALUES ('${safeName}');\nCOMMIT;`);
    newlyApplied.push(file);
  }
  return newlyApplied;
}
