/**
 * Dynamic import with a non-literal specifier, so static analysis (bundlers, file tracing)
 * can't follow it. Used for local-only dependencies that must never be bundled into a
 * serverless deployment (embedded Postgres, the local embedding model).
 */
export const importOptional = <T>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier) as Promise<T>;
