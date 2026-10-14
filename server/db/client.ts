import fs from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";
import { env, isVercel } from "../env";
import { MIGRATIONS } from "./migrations";
import { importOptional } from "../lib/optional";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Backend =
  | { kind: "pglite"; client: PGlite }
  | { kind: "postgres"; client: postgres.Sql };

let backend: Backend | null = null;
let database: DB | null = null;

export type InitOptions = { memory?: boolean };

/** Opens the database (embedded PGlite unless DATABASE_URL is set) and applies pending migrations. */
let initPromise: Promise<DB> | null = null;

export function initDb(opts: InitOptions = {}): Promise<DB> {
  if (database) return Promise.resolve(database);
  // Concurrent first requests on a fresh serverless instance share one initialisation.
  if (!initPromise) initPromise = open(opts).finally(() => (initPromise = null));
  return initPromise;
}

async function open(opts: InitOptions): Promise<DB> {
  if (env.DATABASE_URL && !opts.memory) {
    const client = postgres(env.DATABASE_URL, {
      max: isVercel ? 3 : 10,
      idle_timeout: isVercel ? 20 : undefined,
      prepare: false, // compatible with transaction-mode poolers (Neon, Supabase, PgBouncer)
      onnotice: () => {},
    });
    backend = { kind: "postgres", client };
    database = drizzlePostgres(client, { schema }) as unknown as DB;
  } else {
    if (isVercel) {
      throw new Error("DATABASE_URL is not set. On Vercel, Margin needs a hosted Postgres database (e.g. Neon) — see docs/DEPLOY_VERCEL.md.");
    }
    // Optional, local-only dependencies. Imported through variables so bundlers (Vercel) never
    // follow them into the deployment — they are deleted from the Vercel install (see vercel.json).
    const [pgliteMod, vectorMod, drizzleMod] = await Promise.all([
      importOptional<typeof import("@electric-sql/pglite")>("@electric-sql/pglite"),
      importOptional<typeof import("@electric-sql/pglite-pgvector")>("@electric-sql/pglite-pgvector"),
      importOptional<typeof import("drizzle-orm/pglite")>("drizzle-orm/pglite"),
    ]);
    const { PGlite } = pgliteMod;
    const { vector } = vectorMod;
    const drizzlePglite = drizzleMod.drizzle;
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

/** Minimal forward-only migration runner: applies the ordered MIGRATIONS list, once each. */
export async function runMigrations(): Promise<string[]> {
  // Names keep the historical ".sql" suffix so databases migrated before this change stay valid.
  const files = MIGRATIONS.map((m) => ({ name: `${m.name}.sql`, sql: m.sql }));

  const runOnce = async (sql: postgres.Sql | null) => {
    const exec = (text: string) => (sql ? sql.unsafe(text) : execRaw(text));
    await exec(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const rowsApplied = sql
      ? ((await sql.unsafe(`SELECT name FROM _migrations`)) as unknown as { name: string }[])
      : await queryRaw<{ name: string }>(`SELECT name FROM _migrations`);
    const applied = new Set(rowsApplied.map((r) => r.name));
    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file.name)) continue;
      const safeName = file.name.replace(/'/g, "''");
      await exec(`BEGIN;\n${file.sql}\nINSERT INTO _migrations (name) VALUES ('${safeName}');\nCOMMIT;`);
      newlyApplied.push(file.name);
    }
    return newlyApplied;
  };

  if (backend?.kind !== "postgres") return runOnce(null);
  // On a shared Postgres, several fresh serverless instances may boot at once: serialise them.
  // Advisory locks are per-connection, so hold one reserved connection for lock + migrations + unlock.
  const conn = await backend.client.reserve();
  try {
    await conn.unsafe(`SELECT pg_advisory_lock(727274)`);
    try {
      return await runOnce(conn);
    } finally {
      await conn.unsafe(`SELECT pg_advisory_unlock(727274)`);
    }
  } finally {
    conn.release();
  }
}
