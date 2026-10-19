"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import { Toaster } from "sonner";
import { useWatchlistAlerts } from "@/hooks/useWatchlistAlerts";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const WalletConnectModal = dynamic(
  () => import("@/components/wallet/WalletConnectModal").then((m) => m.WalletConnectModal),
  { ssr: false, loading: () => null }
);
const InstallPrompt = dynamic(
  () => import("@/components/pwa/InstallPrompt").then((m) => m.InstallPrompt),
  { ssr: false, loading: () => null }
);
const OnboardingTour = dynamic(
  () => import("@/components/onboarding/OnboardingTour").then((m) => m.default),
  { ssr: false, loading: () => null }
);
const CommandPalette = dynamic(
  () => import("@/components/command/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false, loading: () => null }
);
const ChangelogModal = dynamic(
  () => import("@/components/changelog/ChangelogModal").then((m) => m.ChangelogModal),
  { ssr: false, loading: () => null }
);
const InProgressOverlay = dynamic(
  () => import("@/components/transactions").then((m) => m.InProgressOverlay),
  { ssr: false, loading: () => null }
);
const TransactionAnnouncer = dynamic(
  () => import("@/components/transactions").then((m) => m.TransactionAnnouncer),
  { ssr: false, loading: () => null }
);
const FeatureFlagPanel = dynamic(
  () => import("@/components/dev/FeatureFlagPanel").then((m) => m.FeatureFlagPanel),
  { ssr: false, loading: () => null }
);

import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { VerificationProvider } from "@/components/wallet/VerificationProvider";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { useUIStore } from "@/store/uiStore";
import { useWalletStore } from "@/store/walletStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useFeatureFlag } from "@/lib/featureFlags";
import {
  createIndexedDbPersister,
  MARKETPLACE_CACHE_MAX_AGE_MS,
  shouldPersistMarketplaceQuery,
} from "@/lib/queryPersistence";

// Pre-load both locale message files at the module level so they are
// bundled and available synchronously on the client.
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import arMessages from "@/messages/ar.json";
import ptBRMessages from "@/messages/pt-BR.json";
import type { Locale } from "@/i18n/config";

const ALL_MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: enMessages as Record<string, unknown>,
  es: esMessages as Record<string, unknown>,
  ar: arMessages as Record<string, unknown>,
  "pt-BR": ptBRMessages as Record<string, unknown>,
};
const FeedbackWidget = dynamic(
  () => import("@/components/feedback/FeedbackWidget").then((m) => m.FeedbackWidget),
  { ssr: false, loading: () => null }
);
const KeyboardShortcutsProvider = dynamic(
  () =>
    import("@/components/keyboard/KeyboardShortcutsProvider").then(
      (m) => m.KeyboardShortcutsProvider
    ),
  { ssr: false, loading: () => null }
);

function ThemedToaster() {
  const theme = useUIStore((s) => s.theme);
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      style={{ zIndex: 99999 }}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast: "bg-card border border-border text-foreground z-[99999]",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}

function WatchlistAlertObserver() {
  useWatchlistAlerts();
  return null;
}

/**
 * Keeps `settingsStore` scoped to the connected wallet (#992).
 *
 * The settings store persists per-wallet buckets (`kora-settings-store-${address}`)
 * but has no way to observe wallet changes on its own. Subscribing to the wallet
 * store's address here means connect, disconnect and account-switch all re-key
 * and rehydrate persistence without any settings surface needing to know.
 */
function SettingsWalletSync() {
  const address = useWalletStore((s) => s.address);
  const isConnected = useWalletStore((s) => s.isConnected);

  useEffect(() => {
    useSettingsStore
      .getState()
      .setActiveWallet(isConnected ? address : null);
  }, [isConnected, address]);

  return null;
}

export function Providers({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const onboardingTourEnabled = useFeatureFlag("onboarding-tour");
  const devtoolsEnabled = useFeatureFlag("devtools");
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      })
  );

  // The tree renders immediately rather than waiting for the restore: gating it
  // on a client-only flag rendered `null` during hydration against server HTML
  // that had the full tree, so React failed hydration and mounted a second copy
  // of the app beside the first. Restoring into a live cache is safe — hydrate
  // never overwrites newer query data.
  useEffect(() => {
    const persister = createIndexedDbPersister();
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const setupPersistence = async () => {
      try {
        await persistQueryClientRestore({
          queryClient,
          persister,
          maxAge: MARKETPLACE_CACHE_MAX_AGE_MS,
        });

        if (cancelled) return;

        unsubscribe = persistQueryClientSubscribe({
          queryClient,
          persister,
          dehydrateOptions: {
            shouldDehydrateQuery: shouldPersistMarketplaceQuery,
          },
        });
      } catch (error) {
        console.warn("[QueryPersistence] Failed to restore marketplace cache.", error);
      }
    };

    void setupPersistence();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const handleControllerChange = () => {
      // Guard: do not reload or interrupt if user is currently signing a transaction
      const isSigning = useUIStore.getState().txState.status === "signing";
      if (isSigning) {
        console.warn("[PWA] Service worker update deferred during active wallet signing session.");
        return;
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider allMessages={ALL_MESSAGES} initialLocale={initialLocale}>
        <ThemeProvider>
          {/* Raises the re-verification modal that `useVerifiedAction` awaits
              (#681). It was imported here but never mounted, so every gated
              action — fund, repay, and now claim — silently fell back to the
              "no provider" branch and no prompt was ever shown. */}
          <VerificationProvider>
          {children}
          {onboardingTourEnabled && <OnboardingTour />}
          <SettingsWalletSync />
          <WalletConnectModal />
          <InProgressOverlay />
          <TransactionAnnouncer />
          <InstallPrompt />
          <FeedbackWidget />
          <KeyboardShortcutsProvider />
          <CommandPalette />
          <ChangelogModal />
          <ThemedToaster />
          <FeatureFlagPanel />
          {devtoolsEnabled && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
          </VerificationProvider>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
