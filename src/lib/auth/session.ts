/**
 * Minimal signed-session auth for the shared-household-password login.
 *
 * Deliberately small: this is a two-person household app, not a
 * multi-tenant product, so there's one password (`APP_PASSWORD`) rather
 * than a user table. A session is just an expiry timestamp plus an
 * HMAC-SHA256 signature over it, keyed by `SESSION_SECRET` — nothing to
 * store server-side, nothing to look up on every request, which matters
 * because this same check runs in proxy.ts on every page load.
 *
 * Auth is opt-in: if `APP_PASSWORD` isn't set, `isAuthEnabled()` is false
 * and proxy.ts lets every request through unchanged — this keeps local
 * development and `npm run dev` on localhost working exactly as it always
 * has. See README "Remote hosting and authentication" for why this MUST
 * be set before deploying anywhere reachable off your own machine.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "carera_session";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — a household member's phone shouldn't need to re-log-in every visit.

function getSecret(): string | null {
  return process.env.SESSION_SECRET || null;
}

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Constant-time string comparison — used for both the password check and
 *  the session signature check, so neither leaks timing information about
 *  how much of the expected value was matched. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

/** Returns null if SESSION_SECRET isn't configured — that's a
 *  misconfiguration (APP_PASSWORD set without SESSION_SECRET), not a
 *  silent "auth disabled" fallback, so callers should treat null as a
 *  hard failure rather than granting access. */
export function createSessionToken(): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const secret = getSecret();
  if (!secret) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload, secret);
  if (!safeEqual(signature, expected)) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() < expiresAt;
}

export const SESSION_MAX_AGE_SECONDS = SESSION_LIFETIME_MS / 1000;
