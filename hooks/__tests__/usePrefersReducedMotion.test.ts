import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  usePrefersReducedMotion,
  REDUCED_MOTION_QUERY,
} from "@/hooks/usePrefersReducedMotion";

type ChangeListener = (event: { matches: boolean }) => void;

/** Install a controllable matchMedia stub and return its change listener. */
function installMatchMedia(matches: boolean) {
  const listeners = new Set<ChangeListener>();

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, listener: ChangeListener) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: ChangeListener) =>
        listeners.delete(listener),
      dispatchEvent: vi.fn(),
    })),
  });

  return {
    emit(next: boolean) {
      listeners.forEach((listener) => listener({ matches: next }));
    },
    listenerCount: () => listeners.size,
  };
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("usePrefersReducedMotion", () => {
  it("defaults to false on the first render", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reconciles to true when the media query matches", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("reacts to a live OS preference change while mounted", () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(false);

    act(() => media.emit(true));
    expect(result.current).toBe(true);

    act(() => media.emit(false));
    expect(result.current).toBe(false);
  });

  it("unsubscribes its change listener on unmount", () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());

    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
