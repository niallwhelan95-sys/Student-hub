import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SESSION_COOKIE, validateSession, type SessionUser } from "./sessions";
import { AppError, unauthorized } from "../lib/errors";
import { isProd } from "../env";

export type AppVariables = { user: SessionUser };

export function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Rejects unauthenticated requests and exposes `c.get("user")`. */
export const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw unauthorized();
  const result = await validateSession(token);
  if (!result) {
    clearSessionCookie(c);
    throw unauthorized();
  }
  if (result.renewedExpiry) setSessionCookie(c, token, result.renewedExpiry);
  c.set("user", result.user);
  await next();
};

/**
 * CSRF defence: every state-changing API request must carry a custom header. Browsers
 * will not attach custom headers to cross-site requests without a CORS preflight, which
 * this server never grants, so a forged form post or image tag cannot pass.
 */
export const requireClientHeader: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (c.req.header("x-margin-client") !== "1") {
      throw new AppError(403, "Missing client header", "csrf");
    }
  }
  await next();
};
