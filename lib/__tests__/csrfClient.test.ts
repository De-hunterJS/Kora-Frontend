import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCsrfToken, setCsrfWalletAddress } from "@/lib/csrfClient";

type CsrfResponse = {
  ok: boolean;
  json: () => Promise<{ token: string }>;
};

describe("client CSRF token cache", () => {
  beforeEach(() => {
    setCsrfWalletAddress(null);
  });

  afterEach(() => {
    setCsrfWalletAddress(null);
    vi.unstubAllGlobals();
  });

  it("deduplicates concurrent requests for the same wallet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "token-a" }),
    } satisfies CsrfResponse);
    vi.stubGlobal("fetch", fetchMock);

    setCsrfWalletAddress("GADDRESSA");
    await expect(Promise.all([getCsrfToken(), getCsrfToken()])).resolves.toEqual([
      "token-a",
      "token-a",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("discards an old response and refreshes for the latest wallet after a switch", async () => {
    let resolveOldResponse!: (response: CsrfResponse) => void;
    const oldResponse = new Promise<CsrfResponse>((resolve) => {
      resolveOldResponse = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "token-b" }),
      } satisfies CsrfResponse);
    vi.stubGlobal("fetch", fetchMock);

    setCsrfWalletAddress("GADDRESSA");
    setCsrfWalletAddress("GADDRESSB");
    const tokenPromise = getCsrfToken();
    resolveOldResponse({ ok: true, json: async () => ({ token: "token-a" }) });

    await expect(tokenPromise).resolves.toBe("token-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});