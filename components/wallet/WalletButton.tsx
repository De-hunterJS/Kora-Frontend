"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, ExternalLink, Bell, Coins, Loader2, AlertCircle, RefreshCw, UserCheck, Eye, ArrowUpRight, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { StellarAddress } from "@/components/ui/stellar-address";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { useKycStatusSync } from "@/hooks/useKycStatusSync";
import { SynapsKycModal } from "@/components/wallet/SynapsKycModal";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useWalletStore } from "@/store";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/store";
import { cn } from "@/lib/utils";
import { safeStellarAccountUrl } from "@/lib/security";
import { env } from "@/lib/env";
import { preloadWalletKit } from "@/lib/lazyModules";

export function WalletButton() {
  const t = useTranslations("wallet");
  const tSettings = useTranslations("settings");
  const {
    isConnected,
    address,
    balance,
    kitSessionActive,
    showReconnectPrompt,
    isReconnecting,
    isWatchMode,
    disconnectWallet,
    exitWatchMode,
    manualReconnect,
    fundWalletOnTestnet,
    addEurcTrustlineOnTestnet,
    addUsdcTrustlineOnTestnet,
    refreshBalance,
  } = useWallet();
  const { isWrongNetwork, hasPassphraseMismatch, network } = useWalletStore();
  const { setWalletModalOpen } = useUIStore();
  const { balances: walletBalances, isLoading: balancesLoading } = useWalletBalances(address ?? undefined);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isAddingEurc, setIsAddingEurc] = useState(false);
  const [isAddingUsdc, setIsAddingUsdc] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"notifications" | "kyc">("notifications");
  const { kycStatus } = useWalletStore();

  /**
   * Pull webhook-recorded KYC transitions into the store (#694) so this tab
   * reflects a completed Synaps verification without a hard refresh. Polling
   * stops on its own once the status is verified — there is nothing further to
   * wait for — so this costs nothing for an already-verified investor.
   */
  useKycStatusSync({
    enabled: isConnected && kycStatus !== "verified",
    onStatusChange: (status) => {
      if (status === "verified") {
        toast.success("Identity verified — funding limits lifted");
      } else if (status === "rejected") {
        toast.info("Identity verification was rejected. Re-submit your documents to continue.");
      } else if (status === "pending") {
        toast.info("Identity verification submitted — Synaps is reviewing your documents.");
      }
    },
  });

  const isTestnet = env.NEXT_PUBLIC_STELLAR_NETWORK === "testnet";
  const hasNetworkMismatch = isWrongNetwork() || hasPassphraseMismatch();

  const handleManualReconnect = async () => {
    try {
      await manualReconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reconnect failed";
      toast.error("Failed to reconnect wallet", message);
    }
  };

  const handleFundTestnetAccount = async () => {
    setIsFunding(true);
    const toastId = "testnet-funding";
    try {
      toast.loading(t("fundingTestnet"), toastId);
      await fundWalletOnTestnet();
      await refreshBalance();
      toast.success(t("fundSuccess"), undefined, toastId);
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("fundFailed");
      toast.error(t("fundFailed"), message, undefined, toastId);
    } finally {
      setIsFunding(false);
    }
  }

  const handleAddEurcTrustline = async () => {
    setIsAddingEurc(true);
    const toastId = "eurc-trustline";
    try {
      toast.loading(t("trustline.eurc.loading"), { id: toastId });
      await addEurcTrustlineOnTestnet();
      toast.success(t("trustline.eurc.success"), { id: toastId });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("trustline.eurc.error");
      toast.error(message, { id: toastId });
    } finally {
      setIsAddingEurc(false);
    }
  };

  const handleAddUsdcTrustline = async () => {
    setIsAddingUsdc(true);
    const toastId = "usdc-trustline";
    try {
      toast.loading(t("trustline.usdc.loading"), { id: toastId });
      await addUsdcTrustlineOnTestnet();
      toast.success(t("trustline.usdc.success"), { id: toastId });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("trustline.usdc.error");
      toast.error(message, { id: toastId });
    } finally {
      setIsAddingUsdc(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
    setConfirmDisconnectOpen(false);
    setOpen(false);
  };

  const expectedNetwork = (env.NEXT_PUBLIC_STELLAR_NETWORK as typeof network) || "testnet";
  const networkLabel = {
    testnet: "Testnet",
    mainnet: "Mainnet",
    futurenet: "Futurenet",
  };

  if (!isConnected) {
    return (
      <Button
        onClick={() => setWalletModalOpen(true)}
        onMouseEnter={() => {
          if (typeof window !== "undefined") {
            preloadWalletKit();
          }
        }}
        onFocus={() => {
          if (typeof window !== "undefined") {
            preloadWalletKit();
          }
        }}
        size="sm"
      >
        {t("connect")}
      </Button>
    );
  }

  // Determine the visual state of the session indicator dot.
  // - null (reconnecting): spinner
  // - false (stale): amber warning dot
  // - true (active): green pulse
  const sessionIndicator = () => {
    if (kitSessionActive === null || isReconnecting) {
      return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
    }
    if (kitSessionActive === false || showReconnectPrompt) {
      return <span className="h-2 w-2 rounded-full bg-warning" title="Wallet session inactive — reconnect required" />;
    }
    return <span className="h-2 w-2 rounded-full bg-success animate-pulse" />;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2",
          "text-sm transition-colors",
          hasNetworkMismatch
            ? "border-destructive/30 bg-destructive/5 text-destructive hover:border-destructive/40 hover:bg-destructive/10"
            : showReconnectPrompt
              ? "border-warning/30 bg-warning/5 text-warning-foreground hover:border-warning/40 hover:bg-warning/10"
              : "border-input bg-card text-foreground hover:border-border hover:bg-muted"
        )}
        aria-label={`Wallet menu${hasNetworkMismatch ? " - Wrong network" : showReconnectPrompt ? " - Reconnect required" : ""}`}
      >
        {hasNetworkMismatch ? (
          <AlertCircle className="h-4 w-4 shrink-0" />
        ) : (
          sessionIndicator()
        )}
        <StellarAddress address={address!} chars={4} size="sm" showCopy={false} className="text-current" />
        <div className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
          {networkLabel[network] || network}
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-background p-3 shadow-token-lg">
          {/* Network mismatch warning */}
          {hasNetworkMismatch && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 border border-destructive/20">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">
                Connected to <span className="capitalize font-medium">{networkLabel[network]}</span> but app requires{" "}
                <span className="capitalize font-medium">{networkLabel[expectedNetwork]}</span>
                {hasPassphraseMismatch() && " (passphrase mismatch)"}. Switch your wallet network to continue.
              </p>
            </div>
          )}

          {/* Stale session / reconnect prompt */}
          {!hasNetworkMismatch && showReconnectPrompt && (
            <div
              className="mb-3 rounded-lg border border-warning/20 bg-warning/10 p-2.5"
              role="alert"
              aria-label="Wallet session inactive"
              data-testid="reconnect-prompt"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-warning-foreground">
                    {t("sessionExpiredTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("sessionExpiredDesc")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  handleManualReconnect();
                }}
                disabled={isReconnecting}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-warning/20 px-2 py-1.5 text-xs font-medium text-warning-foreground hover:bg-warning/30 disabled:opacity-60 transition-colors"
                data-testid="reconnect-button"
              >
                {isReconnecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {isReconnecting ? t("reconnecting") : t("reconnect")}
              </button>
            </div>
          )}

          {/* Reconnect pending spinner */}
          {!hasNetworkMismatch && kitSessionActive === null && !showReconnectPrompt && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/50 p-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{t("restoringSession")}</p>
            </div>
          )}

          {address && (
            <div className="mb-3 space-y-1 rounded-lg bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{t("balances")}</p>
                {isWatchMode && (
                  <span className="flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-500">
                    <Eye className="h-3 w-3" />
                    Watch Only
                  </span>
                )}
              </div>
              {balancesLoading && walletBalances.every((b) => b.rawAmount === 0) ? (
                <div className="space-y-1.5 py-1">
                  <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                </div>
              ) : (
                walletBalances.map((asset) => (
                  <div key={asset.symbol} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{asset.symbol}</span>
                    <span className="font-medium text-foreground font-mono tabular-nums">
                      {asset.formattedAmount}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
              <CopyButton text={address!} />
              {t("copyAddress")}
            </div>
            <a
              href={safeStellarAccountUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t("viewExplorer")}
            </a>
            {isWatchMode ? (
              <button
                type="button"
                onClick={() => {
                  exitWatchMode();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-3.5 w-3.5" /> Exit Watch Mode
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(true);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Bell className="h-3.5 w-3.5" /> {t("notificationSettings")}
                </button>
                {isTestnet && (
                  <>
                    <button
                      type="button"
                      disabled={isFunding || hasNetworkMismatch}
                      onClick={handleFundTestnetAccount}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                    >
                      {isFunding ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Coins className="h-3.5 w-3.5" />
                      )}
                      {isFunding ? t("funding") : t("fundTestnet")}
                    </button>
                    <button
                      type="button"
                      disabled={isAddingEurc || hasNetworkMismatch}
                      onClick={handleAddEurcTrustline}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                    >
                      {isAddingEurc ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Coins className="h-3.5 w-3.5" />
                      )}
                      {isAddingEurc ? t("trustline.eurc.adding") : t("trustline.eurc.cta")}
                    </button>
                    {/* USDC trustline CTA: show when USDC balance is 0 (trustline absent or unfunded) */}
                    {(balance?.usdc === "0" || !balance?.usdc) && (
                      <button
                        type="button"
                        disabled={isAddingUsdc || hasNetworkMismatch}
                        onClick={handleAddUsdcTrustline}
                        data-testid="add-usdc-trustline-btn"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                      >
                        {isAddingUsdc ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Coins className="h-3.5 w-3.5" />
                        )}
                        {isAddingUsdc ? t("trustline.usdc.adding") : t("trustline.usdc.cta")}
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setWalletModalOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  data-testid="switch-account-button"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Switch Account
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setConfirmDisconnectOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-3.5 w-3.5" /> {t("disconnect")}
            </button>
          </div>
        </div>
      )}

      {/* Settings Dialog (Notifications & KYC) */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md bg-zinc-950 border border-zinc-850 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Account Settings</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure notifications and verify your identity limits.
            </DialogDescription>
          </DialogHeader>

          <div className="flex border-b border-zinc-800 mb-4 mt-2">
            <button
              onClick={() => setActiveTab("notifications")}
              className={cn(
                "pb-2 px-4 text-xs font-semibold border-b-2 transition-all",
                activeTab === "notifications"
                  ? "border-primary text-zinc-100"
                  : "border-transparent text-muted-foreground hover:text-zinc-300"
              )}
            >
              Notifications
            </button>
            <button
              onClick={() => setActiveTab("kyc")}
              className={cn(
                "pb-2 px-4 text-xs font-semibold border-b-2 transition-all",
                activeTab === "kyc"
                  ? "border-primary text-zinc-100"
                  : "border-transparent text-muted-foreground hover:text-zinc-300"
              )}
            >
              Identity Verification (KYC)
            </button>
          </div>

          {activeTab === "notifications" ? (
            <>
              <NotificationSettings />
              {/* The dialog stays a shortcut; /settings is the routable,
                  linkable surface for the same store (Issue #638). */}
              <Link
                href="/settings"
                onClick={() => setSettingsOpen(false)}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                {tSettings("openFull")}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            </>
          ) : (
            <div className="space-y-4 pt-1">
              <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/10 p-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">KYC Status</p>
                  <p className="text-sm font-bold capitalize flex items-center gap-1.5 mt-0.5">
                    {kycStatus === "verified" && (
                      <>
                        <ShieldCheck className="h-4 w-4 text-success" /> Verified
                      </>
                    )}
                    {kycStatus === "pending" && (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-warning" /> Pending Review
                      </>
                    )}
                    {kycStatus === "rejected" && (
                      <>
                        <ShieldAlert className="h-4 w-4 text-destructive" /> Rejected
                      </>
                    )}
                    {kycStatus === "none" && (
                      <>
                        <Shield className="h-4 w-4 text-muted-foreground" /> Unverified
                      </>
                    )}
                  </p>
                </div>
                {kycStatus === "verified" && (
                  <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success border border-success/10">
                    Unlimited
                  </span>
                )}
                {kycStatus === "none" && (
                  <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/50">
                    Limit: $10,000
                  </span>
                )}
              </div>

              <div className="space-y-2 text-xs text-zinc-400 leading-relaxed">
                {kycStatus === "none" && (
                  <p>
                    Verify your identity to increase your funding capacity above $10,000 USDC and unlock secondary trade capabilities.
                  </p>
                )}
                {kycStatus === "pending" && (
                  <p>
                    Your documents have been submitted to Synaps and are currently under review. This process usually completes within 5 minutes.
                  </p>
                )}
                {kycStatus === "rejected" && (
                  <p className="text-destructive font-medium">
                    Your verification request was rejected. Please re-submit your verification documents.
                  </p>
                )}
                {kycStatus === "verified" && (
                  <p>
                    Your identity is fully verified! You have access to unlimited funding thresholds and global secondary markets.
                  </p>
                )}
              </div>

              {(kycStatus === "none" || kycStatus === "rejected") && (
                <Button
                  onClick={() => {
                    setKycModalOpen(true);
                    setSettingsOpen(false);
                  }}
                  className="w-full text-xs font-semibold"
                >
                  {kycStatus === "rejected" ? "Re-submit Documents" : "Verify with Synaps"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SynapsKycModal open={kycModalOpen} onOpenChange={setKycModalOpen} />

      {/* Disconnect confirm dialog */}
      <Dialog open={confirmDisconnectOpen} onOpenChange={setConfirmDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("disconnectTitle")}</DialogTitle>
            <DialogDescription>{t("disconnectConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisconnectOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={handleDisconnect}>
              {t("disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
