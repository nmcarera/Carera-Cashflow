/**
 * The shared-household-password session: opt-in (only active when
 * APP_PASSWORD is set), HMAC-signed, no server-side session store. These
 * tests exercise it directly against process.env rather than through
 * proxy.ts/login actions, since the signing logic is what actually has to
 * be correct — a forged or expired token must never verify.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function freshSessionModule() {
  // Each test needs a fresh module instance because env vars are read at
  // call time (not module load time) in session.ts, so this isn't
  // strictly required for correctness — but resetModules keeps tests
  // fully isolated from each other regardless.
  const mod = await import("../src/lib/auth/session");
  return mod;
}

describe("auth session", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APP_PASSWORD;
    delete process.env.SESSION_SECRET;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("isAuthEnabled is false when APP_PASSWORD is unset", async () => {
    const { isAuthEnabled } = await freshSessionModule();
    expect(isAuthEnabled()).toBe(false);
  });

  it("isAuthEnabled is true once APP_PASSWORD is set", async () => {
    process.env.APP_PASSWORD = "correct-horse-battery-staple";
    const { isAuthEnabled } = await freshSessionModule();
    expect(isAuthEnabled()).toBe(true);
  });

  it("checkPassword accepts the exact configured password and rejects everything else", async () => {
    process.env.APP_PASSWORD = "correct-horse-battery-staple";
    const { checkPassword } = await freshSessionModule();
    expect(checkPassword("correct-horse-battery-staple")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });

  it("checkPassword rejects everything when APP_PASSWORD isn't set", async () => {
    const { checkPassword } = await freshSessionModule();
    expect(checkPassword("anything")).toBe(false);
  });

  it("createSessionToken returns null without SESSION_SECRET, so a misconfiguration can't silently grant access", async () => {
    process.env.APP_PASSWORD = "pw";
    const { createSessionToken } = await freshSessionModule();
    expect(createSessionToken()).toBeNull();
  });

  it("a token created with SESSION_SECRET verifies successfully", async () => {
    process.env.SESSION_SECRET = "test-secret";
    const { createSessionToken, verifySessionToken } = await freshSessionModule();
    const token = createSessionToken();
    expect(token).not.toBeNull();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("a token signed with a different secret does not verify", async () => {
    process.env.SESSION_SECRET = "secret-a";
    const { createSessionToken } = await freshSessionModule();
    const token = createSessionToken();

    process.env.SESSION_SECRET = "secret-b";
    const { verifySessionToken } = await freshSessionModule();
    expect(verifySessionToken(token)).toBe(false);
  });

  it("a tampered payload does not verify even with a valid-looking signature", async () => {
    process.env.SESSION_SECRET = "test-secret";
    const { createSessionToken, verifySessionToken } = await freshSessionModule();
    const token = createSessionToken();
    const [, signature] = token!.split(".");
    const farFuture = String(Date.now() + 999 * 24 * 60 * 60 * 1000);
    const forged = `${farFuture}.${signature}`;
    expect(verifySessionToken(forged)).toBe(false);
  });

  it("an expired token does not verify", async () => {
    process.env.SESSION_SECRET = "test-secret";
    const { verifySessionToken } = await freshSessionModule();
    // Hand-construct an already-expired token using the same signing
    // scheme (HMAC-SHA256 of the payload) to test the expiry check in
    // isolation from token creation's fixed 30-day lifetime.
    const { createHmac } = await import("node:crypto");
    const expiredPayload = String(Date.now() - 1000);
    const sig = createHmac("sha256", "test-secret").update(expiredPayload).digest("hex");
    expect(verifySessionToken(`${expiredPayload}.${sig}`)).toBe(false);
  });

  it("verifySessionToken rejects malformed tokens without throwing", async () => {
    process.env.SESSION_SECRET = "test-secret";
    const { verifySessionToken } = await freshSessionModule();
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("not-a-real-token")).toBe(false);
    expect(verifySessionToken("only.one.dot.too.many")).toBe(false);
  });
});
