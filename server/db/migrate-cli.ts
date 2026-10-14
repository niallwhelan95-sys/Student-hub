import { initDb, closeDb, runMigrations } from "./client";

await initDb();
const applied = await runMigrations();
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
await closeDb();
