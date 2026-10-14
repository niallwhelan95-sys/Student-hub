import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "margin_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_WHEN_REMAINING_MS = 15 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().insert(sessions).values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) });
  return { token, expiresAt };
}

export type SessionUser = { id: string; email: string; displayName: string };

/** Returns the user for a valid session token; extends the session when it is past half-life. */
export async function validateSession(
  token: string,
): Promise<{ user: SessionUser; renewedExpiry: Date | null } | null> {
  const db = getDb();
  const id = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row) return null;

  let renewedExpiry: Date | null = null;
  if (row.expiresAt.getTime() - Date.now() < RENEW_WHEN_REMAINING_MS) {
    renewedExpiry = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt: renewedExpiry }).where(eq(sessions.id, id));
  }
  return { user: { id: row.userId, email: row.email, displayName: row.displayName }, renewedExpiry };
}

export async function deleteSession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
