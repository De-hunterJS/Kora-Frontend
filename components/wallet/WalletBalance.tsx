"use client";

import { useState, useEffect, useRef } from "react";
import { Wallet, ChevronDown, RefreshCw, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWalletStore } from "@/store";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { StellarAddress } from "@/components/ui/stellar-address";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TestnetUsdcFaucet } from "@/components/wallet/TestnetUsdcFaucet";
import { isTestnetUsdcFaucetEnabled } from "@/hooks/useUsdcBalance";
import { cn } from "@/lib/utils";

interface WalletBalanceContentProps {
  address: string;
  balances: any[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isUnfunded: boolean;
  refresh: () => Promise<void>;
  lowBalanceAsset: any;
  onClose?: () => void;
}

export function WalletBalanceContent({
  address,
  balances,
  isLoading,
  isError,
  isUnfunded,
  refresh,
  lowBalanceAsset,
  onClose,
}: WalletBalanceContentProps) {
  const t = useTranslations("wallet");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with truncated address & refresh action */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <StellarAddress address={address} chars={4} showCopy={true} />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading || isRefreshing}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          aria-label="Refresh balances"
          data-testid="wallet-balance-refresh"
        >
          <RefreshCw className={cn("h-4 w-4", (isLoading || isRefreshing) && "animate-spin")} />
        </button>
      </div>

      {/* States: Loading, Error, Success */}
      {isLoading && balances.every((b) => b.rawAmount === 0) ? (
        <div className="space-y-3 py-1" data-testid="wallet-balance-skeletons">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center">
              <Skeleton className="h-4 w-12" />
              <div className="flex flex-col items-end gap-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
          ))}
        </div>
              ) : isUnfunded ? (
                <div className="flex flex-col items-center justify-center p-3 text-center space-y-2" data-testid="wallet-balance-unfunded">
                  <AlertCircle className="h-7 w-7 text-warning" />
                  <p className="text-sm font-medium text-foreground">{t("unfundedAccountTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("unfundedAccountDescription")}</p>
                  {isTestnetUsdcFaucetEnabled() && (
                    <a
                      href={`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:underline"
                      data-testid="wallet-balance-friendbot-link"
                    >
                      {t("fundWithXlm")}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                    data-testid="wallet-balance-retry"
                  >
                    <RefreshCw className="h-3 w-3" /> {t("retry")}
                  </button>
                </div>
              ) : isError ? (
        <div className="flex flex-col items-center justify-center p-3 text-center space-y-2" data-testid="wallet-balance-error">
          <AlertCircle className="h-7 w-7 text-destructive" />
          <p className="text-xs text-muted-foreground">
            {t("balanceLoadFailed")}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
            data-testid="wallet-balance-retry"
          >
            <RefreshCw className="h-3 w-3" /> {t("retry")}
          </button>
        </div>
      ) : (
        <div className="space-y-3" data-testid="wallet-balance-success">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("balances")}
          </p>
          <div className="space-y-2.5">
            {balances.map((asset) => (
              <div key={asset.symbol} className="flex justify-between items-center" data-testid={`wallet-balance-item-${asset.symbol.toLowerCase()}`}>
                <span className="font-semibold text-foreground">{asset.symbol}</span>
                <div className="text-right">
                  <span className="font-mono text-sm tabular-nums font-semibold text-foreground">
                    {asset.formattedAmount}
                  </span>
                  {typeof asset.usdValue === "number" && (
                    <p className="text-[10px] text-muted-foreground">
                      ~${asset.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low balance warning badge and fund CTA */}
      {lowBalanceAsset && !isUnfunded && (
        <div className="space-y-2 border-t border-border/50 pt-3" data-testid="wallet-balance-low-warning">
          <div className="flex items-center gap-1.5 rounded-lg border border-warning/20 bg-warning/5 p-2 text-warning-foreground">
            <AlertCircle className="h-4 w-4 text-warning shrink-0" />
            <p className="text-xs font-medium">
              Low {lowBalanceAsset.symbol} balance (under {lowBalanceAsset.lowBalanceThreshold})
            </p>
          </div>
          <TestnetUsdcFaucet compact={true} onSuccess={handleRefresh} />
        </div>
      )}
    </div>
  );
}

export function WalletBalance() {
  const t = useTranslations("wallet");
  const address = useWalletStore((s) => s.address);
  const { balances, fundingAsset, lowBalanceAsset, isLoading, isError, error, isUnfunded, refresh } = useWalletBalances(address ?? undefined);
  const { isDesktop } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!address) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-3 py-2",
          "text-sm font-mono transition-all hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          lowBalanceAsset
            ? "border-warning/30 bg-warning/5 text-warning-foreground hover:border-warning/40"
            : "border-input bg-card text-foreground hover:border-border"
        )}
        data-testid="wallet-balance-trigger"
      >
        <Wallet className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="tabular-nums font-medium">
          {fundingAsset ? `${fundingAsset.formattedAmount} ${fundingAsset.symbol}` : "—"}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
      </button>

      {/* Desktop dropdown */}
      {open && isDesktop && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-background p-4 shadow-token-lg animate-in fade-in slide-in-from-top-1 duration-100"
          data-testid="wallet-balance-dropdown"
        >
          <WalletBalanceContent
            address={address}
            balances={balances}
            isLoading={isLoading}
            isError={isError}
            error={error}
            isUnfunded={isUnfunded}
            refresh={refresh}
            lowBalanceAsset={lowBalanceAsset}
            onClose={() => setOpen(false)}
          />
        </div>
      )}

      {/* Mobile/Tablet bottom sheet */}
      {open && !isDesktop && (
        <BottomSheet open={open} onOpenChange={setOpen} title={t("balances")}>
          <WalletBalanceContent
            address={address}
            balances={balances}
            isLoading={isLoading}
            isError={isError}
            error={error}
            isUnfunded={isUnfunded}
            refresh={refresh}
            lowBalanceAsset={lowBalanceAsset}
            onClose={() => setOpen(false)}
          />
        </BottomSheet>
      )}
    </div>
  );
}
