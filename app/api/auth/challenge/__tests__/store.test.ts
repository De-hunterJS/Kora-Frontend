/**
 * #1019 — Auth challenge nonce store unit tests
 *
 * Documents and tests:
 *  1. TTL eviction  — expired nonces are removed on the next generate call.
 *  2. Single-use    — consumeNonce rejects reuse.
 *  3. Flood / DoS   — unbounded growth is capped at MAX_NONCES.
 *  4. consumeNonce  — returns false for unknown / expired / already-used nonces.
 *  5. evictStaleNonces — removes only expired entries, leaves fresh ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateNonceChallenge,
  consumeNonce,
  evictStaleNonces,
  nonceExists,
  MAX_NONCES,
  NONCE_TTL_MS,
  _clearStoreForTests,
  _storeSizeForTests,
} from "../store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Advance Date.now() by `ms` milliseconds. */
function advanceTime(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  _clearStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
  _clearStoreForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generateNonceChallenge", () => {
  it("returns a correctly structured challenge", () => {
    const { challenge, timestamp, nonce } = generateNonceChallenge();

    expect(challenge).toMatch(
      /^Kora Protocol authentication: \d+:[0-9a-f]{64}$/
    );

    const embedded = parseInt(challenge.split(": ")[1].split(":")[0], 10);
    expect(embedded).toBe(timestamp);
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores the nonce so it can be consumed", () => {
    const { nonce } = generateNonceChallenge();
    expect(nonceExists(nonce)).toBe(true);
  });

  it("generates unique nonces on each call", () => {
    const nonces = Array.from({ length: 10 }, () => generateNonceChallenge().nonce);
    const unique = new Set(nonces);
    expect(unique.size).toBe(10);
  });
});

describe("evictStaleNonces", () => {
  it("removes entries whose TTL has elapsed", () => {
    const { nonce } = generateNonceChallenge();
    expect(_storeSizeForTests()).toBe(1);

    // Advance past TTL
    advanceTime(NONCE_TTL_MS + 1);
    evictStaleNonces();

    expect(_storeSizeForTests()).toBe(0);
    expect(nonceExists(nonce)).toBe(false);
  });

  it("retains entries that are still within TTL", () => {
    const { nonce } = generateNonceChallenge();

    // Advance but stay within TTL
    advanceTime(NONCE_TTL_MS - 1_000);
    evictStaleNonces();

    expect(nonceExists(nonce)).toBe(true);
  });

  it("removes expired but keeps fresh entries when both exist", () => {
    const { nonce: old } = generateNonceChallenge();

    // Advance so the first nonce is stale
    advanceTime(NONCE_TTL_MS + 1);

    // Generate a fresh nonce at the new (later) time
    const { nonce: fresh } = generateNonceChallenge();

    // The generate call ran evictStaleNonces internally already;
    // calling it again should not change anything.
    evictStaleNonces();

    expect(nonceExists(old)).toBe(false);
    expect(nonceExists(fresh)).toBe(true);
  });

  it("is called automatically inside generateNonceChallenge", () => {
    // Create and immediately expire one nonce
    const { nonce: stale } = generateNonceChallenge();
    advanceTime(NONCE_TTL_MS + 1);

    // Generating a new nonce triggers eviction internally
    generateNonceChallenge();

    expect(nonceExists(stale)).toBe(false);
  });
});

describe("consumeNonce", () => {
  it("returns true and marks nonce used on first call", () => {
    const { nonce } = generateNonceChallenge();
    expect(consumeNonce(nonce)).toBe(true);
  });

  it("returns false on a second call with the same nonce (single-use)", () => {
    const { nonce } = generateNonceChallenge();
    consumeNonce(nonce); // first use
    expect(consumeNonce(nonce)).toBe(false); // replay rejected
  });

  it("returns false for an unknown nonce", () => {
    expect(consumeNonce("deadbeef".repeat(8))).toBe(false);
  });

  it("returns false for an expired nonce", () => {
    const { nonce } = generateNonceChallenge();

    // Advance past TTL
    advanceTime(NONCE_TTL_MS + 1);

    expect(consumeNonce(nonce)).toBe(false);
  });

  it("removes expired nonce from store when attempted after TTL", () => {
    const { nonce } = generateNonceChallenge();

    advanceTime(NONCE_TTL_MS + 1);
    consumeNonce(nonce); // should return false AND clean up

    expect(nonceExists(nonce)).toBe(false);
  });
});

describe("MAX_NONCES cap — DoS / flood protection", () => {
  it("MAX_NONCES constant is defined and >= 100", () => {
    // Sanity: must be large enough for normal traffic but finite.
    expect(MAX_NONCES).toBeGreaterThanOrEqual(100);
  });

  it("store never exceeds MAX_NONCES entries under a flood", () => {
    // Insert MAX_NONCES + 50 nonces
    for (let i = 0; i < MAX_NONCES + 50; i++) {
      generateNonceChallenge();
    }

    // The store must not exceed the cap
    expect(_storeSizeForTests()).toBeLessThanOrEqual(MAX_NONCES);
  });

  it("oldest nonces are evicted first when cap is reached", () => {
    // Fill to exactly the cap
    const firstBatch: string[] = [];
    for (let i = 0; i < MAX_NONCES; i++) {
      firstBatch.push(generateNonceChallenge().nonce);
    }

    // The very first nonce in the batch should still be present
    expect(nonceExists(firstBatch[0]!)).toBe(true);

    // Adding one more should evict the oldest
    generateNonceChallenge();

    expect(nonceExists(firstBatch[0]!)).toBe(false);
    // The second nonce may or may not survive — only the oldest was targeted
  });

  it("a consumed nonce stays consumed even when eviction runs during a flood", () => {
    const { nonce } = generateNonceChallenge();
    expect(consumeNonce(nonce)).toBe(true);

    // Flood the store
    for (let i = 0; i < MAX_NONCES + 50; i++) {
      generateNonceChallenge();
    }

    // Replaying the consumed nonce should still be rejected
    // (it may have been evicted, but even if re-submitted its signature
    //  should be checked against the challenge timestamp — the nonce is gone)
    expect(consumeNonce(nonce)).toBe(false);
  });
});

describe("NONCE_TTL_MS constant", () => {
  it("is 10 minutes", () => {
    expect(NONCE_TTL_MS).toBe(10 * 60 * 1_000);
  });
});
