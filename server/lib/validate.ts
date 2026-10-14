import type { Context } from "hono";
import type { ZodType } from "zod";
import { badRequest } from "./errors";

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return result.data;
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
