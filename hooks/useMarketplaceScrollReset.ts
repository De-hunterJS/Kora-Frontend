"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface UseMarketplaceScrollResetOptions {
  /** Fingerprint of the current result set — see buildMarketplaceFilterFingerprint. */
  fingerprint: string;
  /** Only start watching once the URL has hydrated, so the initial state is not treated as a change. */
  enabled: boolean;
  /**
   * Performs the actual scroll. Receives the resolved behavior so callers can
   * route it through the virtualizer (e.g. `rowVirtualizer.scrollToOffset`).
   * Falls back to `window.scrollTo` when omitted.
   */
  reset?: (behavior: "auto" | "smooth") => void;

}

/**
 * Scrolls the marketplace back to the top when the filter set changes.
 *
 * - Skips the first fingerprint after hydration (that is the initial state,
 *   not a user action).
 * - Skips re-renders that produce the same fingerprint, including sort-only
 *   changes because those are excluded from the fingerprint.
 * - Uses `behavior: "auto"` when `prefers-reduced-motion: reduce` is set, so
 *   motion-sensitive users are not sent on a smooth-scroll ride.
 */
export function useMarketplaceScrollReset({
  fingerprint,
  enabled,
  reset,
}: UseMarketplaceScrollResetOptions) {
  const previousFingerprint = useRef<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  // Keep the latest value without making the effect re-run on motion changes.
  const reducedMotionRef = useRef(prefersReducedMotion);
  reducedMotionRef.current = prefersReducedMotion;

  useEffect(() => {
    if (!enabled) return;

    const previous = previousFingerprint.current;
    previousFingerprint.current = fingerprint;

    if (previous === null || previous === fingerprint) return;

    const behavior: "auto" | "smooth" = reducedMotionRef.current
      ? "auto"
      : "smooth";

    if (reset) {
      reset(behavior);
    } else if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior });
    }
  }, [fingerprint, enabled, reset]);
}

export default useMarketplaceScrollReset;
