import m0001 from "./0001_initial";

/**
 * Ordered, forward-only migrations. SQL lives in TypeScript modules (not .sql files read at
 * runtime) so it is always included by bundlers — local dev, Docker and Vercel all behave the same.
 * Never edit an applied migration; add a new numbered module and list it here.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [{ name: "0001_initial", sql: m0001 }];
