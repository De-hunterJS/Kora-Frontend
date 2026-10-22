import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/csrfClient", () => ({
  getCsrfToken: async () => "csrf-vitals-token",
}));

import { handleWebVital } from "@/lib/webVitals";

describe("web vitals CSRF reporting", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the cached CSRF token with production vitals", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    handleWebVital({
      name: "LCP",
      value: 1800,
      id: "lcp-test",
      label: "web-vital",
      startTime: 100,
    } as any);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/vitals",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        headers: expect.objectContaining({
          "x-kora-csrf": "csrf-vitals-token",
        }),
      }),
    );
  });
});