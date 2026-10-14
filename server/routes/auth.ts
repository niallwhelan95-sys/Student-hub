import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { studentProfiles, users, writingProfiles } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/password";
import { createSession, deleteSession, SESSION_COOKIE, validateSession } from "../auth/sessions";
import { clearSessionCookie, setSessionCookie } from "../auth/middleware";
import { parseBody } from "../lib/validate";
import { AppError, badRequest, forbidden, tooMany } from "../lib/errors";
import { rateLimit } from "../lib/ratelimit";
import { env } from "../env";
import { getAI } from "../ai";
import { getEmbedder } from "../embeddings";
import { serverTranscriptionAvailable } from "../speech/service";

export const authRoutes = new Hono();

async function registrationOpen(): Promise<boolean> {
  if (env.REGISTRATION_MODE === "open") return true;
  if (env.REGISTRATION_MODE === "closed") return false;
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  return Number(r.n) === 0;
}

const clientIp = (c: { req: { header(n: string): string | undefined } }) =>
  c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? c.req.header("x-real-ip") ?? "local";

authRoutes.get("/me", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await validateSession(token) : null;
  if (token && session?.renewedExpiry) setSessionCookie(c, token, session.renewedExpiry);
  return c.json({
    user: session?.user ?? null,
    registrationOpen: await registrationOpen(),
    capabilities: {
      ai: getAI().configured,
      semanticSearch: getEmbedder() !== null,
      serverTranscription: serverTranscriptionAvailable(),
      maxUploadMb: env.MAX_UPLOAD_MB,
    },
  });
});

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

authRoutes.post("/register", async (c) => {
  if (!rateLimit(`register:${clientIp(c)}`, 5, 60 * 60_000)) throw tooMany();
  const body = await parseBody(c, Credentials.extend({ displayName: z.string().trim().min(1).max(80), password: z.string().min(10).max(200) }));
  if (!(await registrationOpen())) throw forbidden("Registration is closed on this server.");
  const db = getDb();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
  if (exists) throw badRequest("An account with this email already exists.");
  const [user] = await db
    .insert(users)
    .values({ email: body.email, displayName: body.displayName, passwordHash: await hashPassword(body.password) })
    .returning({ id: users.id, email: users.email, displayName: users.displayName });
  await db.insert(studentProfiles).values({ userId: user.id });
  await db.insert(writingProfiles).values({ userId: user.id, context: "general" });
  const session = await createSession(user.id, c.req.header("user-agent"));
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({ user });
});

authRoutes.post("/login", async (c) => {
  const body = await parseBody(c, Credentials);
  if (!rateLimit(`login:${clientIp(c)}`, 10, 15 * 60_000) || !rateLimit(`login:${body.email}`, 10, 15 * 60_000)) throw tooMany();
  const [user] = await getDb().select().from(users).where(eq(users.email, body.email));
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = user
    ? await verifyPassword(body.password, user.passwordHash)
    : (await verifyPassword(body.password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"), false);
  if (!user || !ok) throw new AppError(401, "Email or password is incorrect.", "invalid_credentials");
  const session = await createSession(user.id, c.req.header("user-agent"));
  setSessionCookie(c, session.token, session.expiresAt);
  return c.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
