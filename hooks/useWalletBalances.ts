"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_FUNDING_ASSET_SYMBOL,
  DEFAULT_WALLET_ASSETS,
  type WalletAssetConfig,
} from "@/config/walletAssets";
import { useFormatters } from "@/hooks/useFormatters";
import { queryKeys } from "@/lib/queryKeys";
import { AccountNotFoundError } from "@/lib/stellar/client";
import { logger } from "@/lib/logger";
import {
  fetchAccountBalanceSnapshot,
  getAssetAmount,
} from "@/lib/walletBalances";

export interface WalletAssetBalanceItem {
  symbol: string;
  rawAmount: number;
  formattedAmount: string;
  usdValue?: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isLowBalance: boolean;
  lowBalanceThreshold?: number;
}

export interface UseWalletBalancesOptions {
  assets?: readonly WalletAssetConfig[];
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useAccountBalanceQuery(
  address: string | undefined,
  options: UseWalletBalancesOptions = {},
) {
  const { enabled = true, refetchInterval = false } = options;

  return useQuery({
    queryKey: queryKeys.account.balances(address ?? ""),
    enabled: Boolean(address) && enabled,
    staleTime: 30_000,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) =>
      !(error instanceof AccountNotFoundError) && failureCount < 3,
    queryFn: async () => {
      try {
        return await fetchAccountBalanceSnapshot(address!);
      } catch (error) {
        if (error instanceof AccountNotFoundError) {
          logger.info("[wallet] Stellar account is unfunded");
        }
        throw error;
      }
    },
  });
}

export function useWalletBalances(
  address: string | undefined,
  options: UseWalletBalancesOptions = {},
) {
  const queryClient = useQueryClient();
  const { formatNumber } = useFormatters();
  const { assets = DEFAULT_WALLET_ASSETS, ...queryOptions } = options;
  const query = useAccountBalanceQuery(address, queryOptions);

  const error =
    query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null;

  const balances = useMemo<WalletAssetBalanceItem[]>(() => {
    return assets.map((asset) => {
      const rawAmount = query.data ? getAssetAmount(query.data, asset) : 0;
      const decimals = asset.decimals ?? 2;
      const isLowBalance =
        typeof asset.lowBalanceThreshold === "number" &&
        rawAmount < asset.lowBalanceThreshold;

      return {
        symbol: asset.symbol,
        rawAmount,
        formattedAmount: formatNumber(rawAmount, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
        usdValue: asset.symbol === "USDC" || asset.symbol === "EURC" ? rawAmount : undefined,
        isLoading: query.isLoading,
        isError: query.isError,
        error,
        isLowBalance,
        lowBalanceThreshold: asset.lowBalanceThreshold,
      };
    });
  }, [assets, error, formatNumber, query.data, query.isError, query.isLoading]);

  const lowBalanceAsset =
    balances.find((asset) => asset.isLowBalance) ?? null;
  const fundingAsset =
    balances.find((asset) => asset.symbol === DEFAULT_FUNDING_ASSET_SYMBOL) ?? null;
  const isUnfunded = query.error instanceof AccountNotFoundError;

  return {
    address,
    balances,
    fundingAsset: isUnfunded ? null : fundingAsset,
    lowBalanceAsset: isUnfunded ? null : lowBalanceAsset,
    isUnfunded,
    isDisconnected: !address,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error,
    refresh: async () => {
      if (!address) return;

      await query.refetch();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.account.usdcBalance(address),
      });
    },
  };
}
