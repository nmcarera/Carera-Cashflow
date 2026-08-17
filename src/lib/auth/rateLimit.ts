/**
 * Best-effort login throttling — an in-memory counter per source IP, reset
 * after a cooldown. Deliberately simple: this app runs as a single
 * instance (required anyway so WAL-mode SQLite only ever has one writer —
 * see README "Choosing a host"), so in-memory state doesn't go stale
 * across replicas the way it would on a horizontally-scaled service. Not
 * meant to withstand a determined distributed attacker; meant to make
 * casually guessing a household password past a handful of tries
 * noticeably slower.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface Attempt {
  count: number;
  windowStartedAt: number;
}

const attemptsByKey = new Map<string, Attempt>();

export function isRateLimited(key: string): boolean {
  const entry = attemptsByKey.get(key);
  if (!entry) return false;
  if (Date.now() - entry.windowStartedAt > WINDOW_MS) {
    attemptsByKey.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string): void {
  const entry = attemptsByKey.get(key);
  const now = Date.now();
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    attemptsByKey.set(key, { count: 1, windowStartedAt: now });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(key: string): void {
  attemptsByKey.delete(key);
}
