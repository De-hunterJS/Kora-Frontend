/**
 * Feature Flags — Issue #308
 *
 * Centralised, type-safe feature flag system backed by env vars.
 * All flags default to `false` in production. Set to `"true"` in
 * `.env.local` to enable a flag during development.
 *
 * Usage:
 *   import { isEnabled } from "@/lib/featureFlags";
 *   if (isEnabled("comparison")) { ... }
 */

import { useSyncExternalStore } from "react";

/**
 * Every feature flag supported by the app. Add new flags here.
 *
 * | Flag                      | Env var                                      | Description                                             |
 * |---------------------------|----------------------------------------------|---------------------------------------------------------|
 * | mock-data                 | NEXT_PUBLIC_ENABLE_MOCK_DATA                 | Use mock data (no live Soroban)                         |
 * | devtools                  | NEXT_PUBLIC_ENABLE_DEVTOOLS                  | Show React Query devtools                               |
 * | comparison                | NEXT_PUBLIC_ENABLE_COMPARISON                | Invoice comparison bar in marketplace                   |
 * | onboarding-tour           | NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR           | Guided onboarding tour for new users                    |
 * | batch-actions             | NEXT_PUBLIC_ENABLE_BATCH_ACTIONS             | Batch cancel/repay in SME dashboard                     |
 * | kyb-mint-gate             | NEXT_PUBLIC_ENABLE_KYB_MINT_GATE             | Gate invoice minting behind KYB verification            |
 * | secondary-market          | NEXT_PUBLIC_ENABLE_SECONDARY_MARKET          | Secondary market P2P trading route                      |
 * | category-taxonomy-preview | NEXT_PUBLIC_ENABLE_CATEGORY_TAXONOMY_PREVIEW | Developer taxonomy preview panel in marketplace filters |
 * | test-components           | NEXT_PUBLIC_ENABLE_TEST_COMPONENTS           | Render isolated test harness page for component testing  |
 */
export type FeatureFlag =
  | "mock-data"
  | "devtools"
  | "comparison"
  | "onboarding-tour"
  | "batch-actions"
  | "kyb-mint-gate"
  | "secondary-market"
  | "category-taxonomy-preview"
  | "test-components";

export const FEATURE_FLAGS: readonly FeatureFlag[] = [
  "mock-data",
  "devtools",
  "comparison",
  "onboarding-tour",
  "batch-actions",
  "kyb-mint-gate",
  "secondary-market",
  "category-taxonomy-preview",
  "test-components",
];

export type FeatureFlagState = Record<FeatureFlag, boolean>;
export type FeatureFlagOverrides = Partial<Record<FeatureFlag, boolean>>;

/**
 * Flags whose runtime (localStorage) overrides are blocked outside
 * `NODE_ENV === "development"` — Issue #1025.
 *
 * Toggling these on a shared staging host flips the app between live and
 * demo behaviour (mock fixtures, P2P trading route), which is easy to confuse
 * during external demos. Outside local development they always resolve from
 * their env var; stored overrides are ignored on read and dropped on write.
 */
export const DISALLOWED_OVERRIDE_FLAGS: readonly FeatureFlag[] = [
  "mock-data",
  "secondary-market",
];

const FEATURE_FLAG_OVERRIDE_STORAGE_KEY = "kora:feature-flag-overrides";
const FEATURE_FLAG_CHANGE_EVENT = "kora:feature-flags-changed";

/** Maps each flag to its NEXT_PUBLIC_* env var name. */
const FLAG_ENV_MAP: Record<FeatureFlag, string> = {
  "mock-data": "NEXT_PUBLIC_ENABLE_MOCK_DATA",
  devtools: "NEXT_PUBLIC_ENABLE_DEVTOOLS",
  comparison: "NEXT_PUBLIC_ENABLE_COMPARISON",
  "onboarding-tour": "NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR",
  "batch-actions": "NEXT_PUBLIC_ENABLE_BATCH_ACTIONS",
  "kyb-mint-gate": "NEXT_PUBLIC_ENABLE_KYB_MINT_GATE",
  "secondary-market": "NEXT_PUBLIC_ENABLE_SECONDARY_MARKET",
  "category-taxonomy-preview": "NEXT_PUBLIC_ENABLE_CATEGORY_TAXONOMY_PREVIEW",
  "test-components": "NEXT_PUBLIC_ENABLE_TEST_COMPONENTS",
};

function readEnvFlag(flag: FeatureFlag): boolean {
  const envVar = FLAG_ENV_MAP[flag];
  const val = process.env[envVar];
  if (flag === "onboarding-tour") {
    return val !== "false";
  }
  return val === "true";
}

function canUseRuntimeOverrides(): boolean {
  return typeof window !== "undefined" && process.env.NODE_ENV !== "production";
}

/**
 * Whether a runtime override may be applied to `flag` in the current build.
 * Every flag is overridable in development; DISALLOWED_OVERRIDE_FLAGS are
 * locked to their env value everywhere else (staging, test, production).
 */
export function isFlagOverrideAllowed(flag: FeatureFlag): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return !DISALLOWED_OVERRIDE_FLAGS.includes(flag);
}

function parseOverrides(raw: string | null): FeatureFlagOverrides {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const overrides: FeatureFlagOverrides = {};

    for (const flag of FEATURE_FLAGS) {
      // Ignore disallowed keys even if localStorage was edited by hand.
      if (!isFlagOverrideAllowed(flag)) continue;
      if (typeof parsed[flag] === "boolean") {
        overrides[flag] = parsed[flag];
      }
    }

    return overrides;
  } catch {
    return {};
  }
}

function readStoredOverrides(): FeatureFlagOverrides {
  if (!canUseRuntimeOverrides()) return {};
  return parseOverrides(window.localStorage.getItem(FEATURE_FLAG_OVERRIDE_STORAGE_KEY));
}

function readFeatureFlagState(): FeatureFlagState {
  const overrides = readStoredOverrides();

  return FEATURE_FLAGS.reduce<FeatureFlagState>((state, flag) => {
    state[flag] = overrides[flag] ?? readEnvFlag(flag);
    return state;
  }, {} as FeatureFlagState);
}

function emitFeatureFlagChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FEATURE_FLAG_CHANGE_EVENT));
}

function subscribeToFeatureFlags(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => onStoreChange();

  window.addEventListener(FEATURE_FLAG_CHANGE_EVENT, handleChange);
  window.addEventListener("storage", handleChange);

  return () => {
    window.removeEventListener(FEATURE_FLAG_CHANGE_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

function writeOverrides(overrides: FeatureFlagOverrides): void {
  if (!canUseRuntimeOverrides()) return;

  for (const flag of Object.keys(overrides) as FeatureFlag[]) {
    if (!isFlagOverrideAllowed(flag)) delete overrides[flag];
  }

  if (Object.keys(overrides).length === 0) {
    window.localStorage.removeItem(FEATURE_FLAG_OVERRIDE_STORAGE_KEY);
  } else {
    window.localStorage.setItem(
      FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
      JSON.stringify(overrides),
    );
  }

  emitFeatureFlagChange();
}

function serializeFeatureFlagState(): string {
  return JSON.stringify(readFeatureFlagState());
}

function serializeEnvFeatureFlagState(): string {
  return JSON.stringify(
    FEATURE_FLAGS.reduce<FeatureFlagState>((state, flag) => {
      state[flag] = readEnvFlag(flag);
      return state;
    }, {} as FeatureFlagState),
  );
}

/**
 * Returns `true` if the given feature flag is enabled.
 *
 * Reads the corresponding NEXT_PUBLIC_* env var at runtime.
 * Only the string `"true"` (case-sensitive) enables a flag.
 */
export function isEnabled(flag: FeatureFlag): boolean {
  return readFeatureFlagState()[flag];
}

export function getFeatureFlagState(): FeatureFlagState {
  return readFeatureFlagState();
}

export function getFeatureFlagOverride(
  flag: FeatureFlag,
): boolean | undefined {
  return readStoredOverrides()[flag];
}

export function setFeatureFlagOverride(
  flag: FeatureFlag,
  enabled: boolean | undefined,
): void {
  if (!isFlagOverrideAllowed(flag)) return;

  const overrides = readStoredOverrides();

  if (enabled === undefined) {
    delete overrides[flag];
  } else {
    overrides[flag] = enabled;
  }

  writeOverrides(overrides);
}

export function resetFeatureFlagOverrides(): void {
  writeOverrides({});
}

export function useFeatureFlags(): FeatureFlagState {
  const snapshot = useSyncExternalStore(
    subscribeToFeatureFlags,
    serializeFeatureFlagState,
    serializeEnvFeatureFlagState,
  );

  return JSON.parse(snapshot) as FeatureFlagState;
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  return useFeatureFlags()[flag];
}

// ─── Network mode & query tuning — Issue #436 ────────────────────────────────
//
// Kora resolves invoice data in one of two network modes, and they have very
// different freshness characteristics:
//
// - **mock** (`mock-data` flag on) — invoices come from the static
//   `MOCK_INVOICES` fixture. The data is immutable for the lifetime of the tab,
//   so any background refetch is pure waste: it burns a render pass and returns
//   a byte-identical result.
//
// - **live** — invoices come from Soroban RPC / the indexer, and
//   `useContractEvents` streams `invoice_funded` / `invoice_repaid` /
//   `invoice_cancelled` events, invalidating the affected query keys as they
//   arrive. Freshness is therefore *event-driven*, not timer-driven.
//
// Previously the invoice hooks used a fixed 30 s stale time with 15 s / 30 s
// poll timers in both modes. In live mode that duplicated work the event stream
// already does — an event invalidates a key, then the timer refetches the same
// key seconds later. In mock mode it refetched data that cannot change. The
// tuning table below replaces those scattered magic constants with one
// per-mode definition.

/** Whether app data resolves from mock fixtures or the live indexer. */
export type NetworkMode = "mock" | "live";

/** Resolve the active network mode from the `mock-data` flag. */
export function getNetworkMode(): NetworkMode {
  return isEnabled("mock-data") ? "mock" : "live";
}

export function useNetworkMode(): NetworkMode {
  return useFeatureFlag("mock-data") ? "mock" : "live";
}

/** True when cache freshness is driven by the contract event stream. */
export function isEventDriven(mode: NetworkMode = getNetworkMode()): boolean {
  return mode === "live";
}

/**
 * TanStack Query timings for a single network mode.
 *
 * A `false` refetch interval disables timer-based polling for that query;
 * freshness then comes from cache invalidation — contract events, mutation
 * `onSettled` handlers, or an explicit `refetch()`.
 */
export interface QueryTuning {
  /** How long a fetched result is considered fresh. */
  staleTime: number;
  /** How long an unused result stays cached before garbage collection. */
  gcTime: number;
  /**
   * Backstop poll for marketplace/list queries. In live mode this is a long
   * safety net for a degraded event stream — not the primary freshness path.
   */
  listRefetchInterval: number | false;
  /** Backstop poll for a detail query whose invoice is still fundable. */
  detailRefetchInterval: number | false;
  /** Backstop poll for owner-scoped ("my invoices") queries. */
  ownerRefetchInterval: number | false;
  /** Backstop poll for the batched token-id watcher. */
  batchRefetchInterval: number | false;
}

const GC_5_MIN = 5 * 60 * 1000;

/**
 * Per-mode tuning table.
 *
 * **live** — `staleTime` is short (5 s) because the event stream invalidates
 * keys the moment on-chain state changes; a short stale window means the
 * invalidated query refetches promptly instead of serving a stale entry. Timer
 * intervals are pushed out to 2 min so they act purely as a backstop for a
 * degraded stream (`useContractEvents` already falls back SSE → RPC stream →
 * 5 s polling internally) rather than racing it, which is what produced the
 * duplicate requests.
 *
 * **mock** — the fixture never changes, so `staleTime` is 5 min and every timer
 * is disabled. Mutations still invalidate explicitly, so optimistic updates and
 * the invoice wizard continue to work.
 */
export const QUERY_TUNING: Record<NetworkMode, QueryTuning> = {
  live: {
    staleTime: 5_000,
    gcTime: GC_5_MIN,
    listRefetchInterval: 120_000,
    detailRefetchInterval: 120_000,
    ownerRefetchInterval: 120_000,
    batchRefetchInterval: 120_000,
  },
  mock: {
    staleTime: GC_5_MIN,
    gcTime: GC_5_MIN,
    listRefetchInterval: false,
    detailRefetchInterval: false,
    ownerRefetchInterval: false,
    batchRefetchInterval: false,
  },
};

/** Tuning for the active mode, or an explicitly supplied one (used in tests). */
export function getQueryTuning(
  mode: NetworkMode = getNetworkMode(),
): QueryTuning {
  return QUERY_TUNING[mode];
}

export function useQueryTuning(): QueryTuning {
  return getQueryTuning(useNetworkMode());
}
