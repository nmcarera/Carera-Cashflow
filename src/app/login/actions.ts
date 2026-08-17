"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { isRateLimited, recordFailedAttempt, clearAttempts } from "@/lib/auth/rateLimit";
import { logInfo } from "@/lib/logging/logger";

async function clientKey(): Promise<string> {
  const h = await headers();
  // Railway (like most PaaS hosts) terminates TLS and proxies the request,
  // so the real client address is in this header, not the socket address.
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export interface LoginResult {
  ok: boolean;
  errorMessage?: string;
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const key = await clientKey();
  if (isRateLimited(key)) {
    return { ok: false, errorMessage: "Too many attempts. Wait a few minutes and try again." };
  }

  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    recordFailedAttempt(key);
    return { ok: false, errorMessage: "That password isn't right." };
  }

  clearAttempts(key);
  const token = createSessionToken();
  if (!token) {
    // APP_PASSWORD is set but SESSION_SECRET isn't — a real misconfiguration,
    // not a normal login failure. Say so plainly rather than a generic error.
    return { ok: false, errorMessage: "Server is misconfigured (missing SESSION_SECRET) — cannot start a session." };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  logInfo("auth.login", "Household login succeeded.", {});
  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
