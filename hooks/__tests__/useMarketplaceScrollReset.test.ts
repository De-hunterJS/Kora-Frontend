import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { useMarketplaceScrollReset } from "@/hooks/useMarketplaceScrollReset";
import { REDUCED_MOTION_QUERY } from "@/hooks/usePrefersReducedMotion";

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("useMarketplaceScrollReset", () => {
  it("does not scroll on the first (hydrated) fingerprint", () => {
    setReducedMotion(false);
    const reset = vi.fn();
    renderHook(() =>
      useMarketplaceScrollReset({ fingerprint: "a", enabled: true, reset })
    );
    expect(reset).not.toHaveBeenCalled();
  });

  it("does not scroll when the fingerprint is unchanged", () => {
    setReducedMotion(false);
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ fingerprint }) =>
        useMarketplaceScrollReset({ fingerprint, enabled: true, reset }),
      { initialProps: { fingerprint: "a" } }
    );

    rerender({ fingerprint: "a" });
    expect(reset).not.toHaveBeenCalled();
  });

  it("scrolls to the top when the fingerprint changes", () => {
    setReducedMotion(false);
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ fingerprint }) =>
        useMarketplaceScrollReset({ fingerprint, enabled: true, reset }),
      { initialProps: { fingerprint: "a" } }
    );

    rerender({ fingerprint: "b" });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith("smooth");
  });

  it("uses an instant scroll when reduced motion is enabled", () => {
    setReducedMotion(true);
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ fingerprint }) =>
        useMarketplaceScrollReset({ fingerprint, enabled: true, reset }),
      { initialProps: { fingerprint: "a" } }
    );

    rerender({ fingerprint: "b" });
    expect(reset).toHaveBeenCalledWith("auto");
  });

  it("stays dormant until hydration completes", () => {
    setReducedMotion(false);
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ fingerprint, enabled }) =>
        useMarketplaceScrollReset({ fingerprint, enabled, reset }),
      { initialProps: { fingerprint: "a", enabled: false } }
    );

    rerender({ fingerprint: "b", enabled: false });
    expect(reset).not.toHaveBeenCalled();

    // Enabling does not treat the current fingerprint as a change…
    rerender({ fingerprint: "b", enabled: true });
    expect(reset).not.toHaveBeenCalled();

    // …but the next real change does.
    rerender({ fingerprint: "c", enabled: true });
    expect(reset).toHaveBeenCalledWith("smooth");
  });

  it("falls back to window.scrollTo when no reset callback is provided", () => {
    setReducedMotion(false);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);

    const { rerender } = renderHook(
      ({ fingerprint }) =>
        useMarketplaceScrollReset({ fingerprint, enabled: true }),
      { initialProps: { fingerprint: "a" } }
    );

    rerender({ fingerprint: "b" });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    vi.unstubAllGlobals();
  });
});
