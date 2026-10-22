"use client";

import { useEffect, useState } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tracks the `prefers-reduced-motion` media query.
 *
 * Returns `false` on the server and during the first client render (so
 * SSR markup stays deterministic), then reconciles to the real preference in
 * an effect. It stays subscribed, so a user who flips the OS setting while the
 * page is open gets the reduced-motion path immediately — unlike Framer's
 * `useReducedMotion`, which snapshots the value once per document.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
    // Bail out when the initial value already matches so the common
    // (motion-allowed) path does not schedule a redundant render.
    setPrefersReducedMotion((current) =>
      current === mediaQueryList.matches ? current : mediaQueryList.matches
    );

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    // `addEventListener` is unavailable in very old Safari; the legacy
    // `addListener` fallback keeps the subscription working there.
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, []);

  return prefersReducedMotion;
}

export default usePrefersReducedMotion;
