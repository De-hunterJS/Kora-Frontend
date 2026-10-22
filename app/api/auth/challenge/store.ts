import { randomBytes } from "crypto";

/**
 * In-memory nonce store for wallet-ownership auth challenges.
 *
 * ## Security properties
 *
 * ### TTL (NONCE_TTL_MS)
 * Every nonce expires 10 minutes after generation. Expired entries are purged
 * lazily inside `generateNonceChallenge` and `evictStaleNonces`, so no
 * background timer is required. See `consumeNonce` — a nonce that has passed
 * its TTL is rejected even if it was never used.
 *
 * ### Single-use (consumeNonce)
 * Once a nonce is consumed it is marked `used: true`. Any subsequent call to
 * `consumeNonce` with the same nonce returns `false`, preventing replay attacks.
 *
 * ### DoS / unbounded growth (MAX_NONCES)
 * A serverless instance could be flooded with POST /api/auth/challenge requests
 * to exhaust Node.js heap. `MAX_NONCES` caps the live store at 500 entries.
 * When the cap is reached the oldest nonces (by creation time) are evicted
 * before the new one is stored, so a flood degrades challenge freshness rather
 * than crashing the process.
 *
 * ### Clock skew
 * `evictStaleNonces` uses `Date.now()` on the server. Sub-second clock drift
 * between edge instances is acceptable — a nonce that expires a few
 * milliseconds early is safely regenerated.
 *
 * ### Concurrent consumption
 * The Map is in-process, so `consumeNonce` is synchronous and free from
 * concurrency hazards within a single Node.js thread. In a multi-instance
 * deployment (e.g. serverless with >1 warm container) nonces are not shared;
 * clients must direct verify requests to the same instance that issued the
 * challenge, or use the Redis-backed store variant (see docs/architecture.md).
 */

export interface ChallengeResponse {
  challenge: string;
  timestamp: number;
  nonce: string;
}

/** Maximum number of live (un-expired, unconsumed) nonces kept in memory. */
export const MAX_NONCES = 500;

/**
 * Time-to-live for a nonce after it is generated.
 * 10 minutes — long enough for a user to sign but short enough to limit the
 * replay window.
 */
export const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const nonceStore = new Map<string, { used: boolean; createdAt: number }>();

/**
 * Remove nonces whose TTL has elapsed.
 * Called automatically before each new nonce is generated; can also be called
 * directly in tests or from a health-check route.
 */
export function evictStaleNonces(): void {
  const now = Date.now();
  for (const [key, entry] of nonceStore) {
    if (now - entry.createdAt > NONCE_TTL_MS) {
      nonceStore.delete(key);
    }
  }
}

/**
 * Evict the oldest entries to keep the store within MAX_NONCES.
 *
 * Called *before* inserting a new entry, so we evict if the store is already
 * at the cap (size >= MAX_NONCES) to make room for the incoming nonce.
 * Oldest = smallest `createdAt`.  Iterating a Map returns keys in insertion
 * order, which mirrors creation order here.
 */
function evictOldestNonces(): void {
  // Evict until there is room for one more entry
  const excess = nonceStore.size - MAX_NONCES + 1;
  if (excess <= 0) return;

  let evicted = 0;
  for (const key of nonceStore.keys()) {
    if (evicted >= excess) break;
    nonceStore.delete(key);
    evicted++;
  }
}

export function generateNonceChallenge(): ChallengeResponse {
  evictStaleNonces();
  evictOldestNonces();

  const nonce = randomBytes(32).toString("hex");
  const timestamp = Date.now();
  const challenge = `Kora Protocol authentication: ${timestamp}:${nonce}`;
  nonceStore.set(nonce, { used: false, createdAt: timestamp });
  return { challenge, timestamp, nonce };
}

export function consumeNonce(nonce: string): boolean {
  const entry = nonceStore.get(nonce);
  if (!entry || entry.used) return false;

  // Reject expired nonces (belt-and-suspenders on top of eviction).
  if (Date.now() - entry.createdAt > NONCE_TTL_MS) {
    nonceStore.delete(nonce);
    return false;
  }

  entry.used = true;
  return true;
}

export function nonceExists(nonce: string): boolean {
  return nonceStore.has(nonce);
}

/** Exposed for testing only — clears all state between test cases. */
export function _clearStoreForTests(): void {
  nonceStore.clear();
}

/** Exposed for testing only — returns the current store size. */
export function _storeSizeForTests(): number {
  return nonceStore.size;
}
