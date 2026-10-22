import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

const { fetchSnapshot, logInfo, AccountNotFoundError } = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  logInfo: vi.fn(),
  AccountNotFoundError: class extends Error {
    constructor(address: string) {
      super(`Account not found: ${address}`);
      this.name = "AccountNotFoundError";
    }
  },
}));

vi.mock("@/lib/stellar/client", () => ({ AccountNotFoundError }));

vi.mock("@/hooks/useFormatters", () => ({
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
}));

vi.mock("@/lib/walletBalances", () => ({
  fetchAccountBalanceSnapshot: fetchSnapshot,
  getAssetAmount: () => 0,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: logInfo },
}));

import { useWalletBalances } from "@/hooks/useWalletBalances";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("useWalletBalances unfunded account handling", () => {
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient?.clear();
    vi.clearAllMocks();
  });

  it("exposes account-not-found as unfunded and does not retry it", async () => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchSnapshot.mockRejectedValueOnce(new AccountNotFoundError(ADDRESS));

    const { result } = renderHook(() => useWalletBalances(ADDRESS), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isUnfunded).toBe(true));

    expect(result.current.error).toBeInstanceOf(AccountNotFoundError);
    expect(result.current.fundingAsset).toBeNull();
    expect(result.current.lowBalanceAsset).toBeNull();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith("[wallet] Stellar account is unfunded");
  });
});