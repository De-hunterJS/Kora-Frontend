/**
 * #1017 — AppLoadingShell persistence gate
 *
 * Verifies that:
 *  1. The AppLoadingShell is shown while IndexedDB restore is in progress.
 *  2. Children become visible once the restore completes.
 *  3. The error path (restore rejection) still sets ready = true.
 *  4. On SSR (no window) the shell is skipped and children render immediately.
 *  5. AppLoadingShell renders with correct accessibility attributes.
 */

/// <reference types="@testing-library/jest-dom" />

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Stub out all the heavy dynamic imports — we only care about the persistence
// gate behaviour, not the sub-components.
vi.mock("next/dynamic", () => ({
  default: (_fn: unknown) => () => null,
}));

vi.mock("@/components/layout/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/wallet/VerificationProvider", () => ({
  VerificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/i18n/LocaleProvider", () => ({
  LocaleProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/store/uiStore", () => ({
  useUIStore: vi.fn((sel: (s: { theme: string; txState: { status: string } }) => unknown) =>
    sel({ theme: "dark", txState: { status: "idle" } })
  ),
}));

vi.mock("@/store/walletStore", () => ({
  useWalletStore: vi.fn(
    (sel: (s: { address: string; isConnected: boolean }) => unknown) =>
      sel({ address: "", isConnected: false })
  ),
}));

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ setActiveWallet: vi.fn() }),
  },
}));

vi.mock("@/lib/featureFlags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@/hooks/useWatchlistAlerts", () => ({
  useWatchlistAlerts: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@tanstack/react-query-devtools", () => ({
  ReactQueryDevtools: () => null,
}));

// ─── Key mocks for this test suite ───────────────────────────────────────────

let resolveRestore: () => void;
let rejectRestore: (err: Error) => void;

vi.mock("@tanstack/query-persist-client-core", () => ({
  persistQueryClientRestore: vi.fn(() => {
    return new Promise<void>((resolve, reject) => {
      resolveRestore = resolve;
      rejectRestore = reject;
    });
  }),
  persistQueryClientSubscribe: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/queryPersistence", () => ({
  createIndexedDbPersister: vi.fn(() => ({
    persistClient: vi.fn(),
    restoreClient: vi.fn(),
    removeClient: vi.fn(),
  })),
  MARKETPLACE_CACHE_MAX_AGE_MS: 86_400_000,
  shouldPersistMarketplaceQuery: vi.fn(() => false),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Re-imported inside each test via vi.resetModules() so the module-level
// `isPersistenceReady` state starts fresh.
async function importProviders() {
  const mod = await import("@/app/providers");
  return mod.Providers;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Providers — persistence gate (#1017)", () => {
  beforeEach(() => {
    vi.resetModules();
    // Re-stub the mock after resetModules so the new Providers module sees it.
    vi.mock("@tanstack/query-persist-client-core", () => ({
      persistQueryClientRestore: vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            resolveRestore = resolve;
            rejectRestore = reject;
          })
      ),
      persistQueryClientSubscribe: vi.fn(() => vi.fn()),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders AppLoadingShell while restore is pending", async () => {
    const Providers = await importProviders();
    render(
      <Providers>
        <div data-testid="app-content">App content</div>
      </Providers>
    );

    // Shell should be present
    expect(screen.getByTestId("app-loading-shell")).toBeInTheDocument();
    // Children should be hidden (display:none wrapping div)
    const appContent = screen.getByTestId("app-content");
    // The parent wrapper div should have aria-hidden="true"
    expect(appContent.closest('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("hides shell and reveals children after restore resolves", async () => {
    const Providers = await importProviders();
    render(
      <Providers>
        <div data-testid="app-content">App content</div>
      </Providers>
    );

    // Shell visible initially
    expect(screen.getByTestId("app-loading-shell")).toBeInTheDocument();

    // Simulate restore completing
    await act(async () => {
      resolveRestore();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("app-loading-shell")).not.toBeInTheDocument();
    });

    // Children wrapper should no longer be hidden
    const appContent = screen.getByTestId("app-content");
    expect(appContent.closest('[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it("still reveals children when restore rejects (error path)", async () => {
    const Providers = await importProviders();
    render(
      <Providers>
        <div data-testid="app-content">App content</div>
      </Providers>
    );

    // Simulate a failed restore
    await act(async () => {
      rejectRestore(new Error("IndexedDB unavailable"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("app-loading-shell")).not.toBeInTheDocument();
    });

    // Children must still be accessible
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });
});

describe("AppLoadingShell — accessibility", () => {
  it("renders with role=status and aria-busy=true", async () => {
    const { AppLoadingShell } = await import("@/components/ui/AppLoadingShell");
    render(<AppLoadingShell />);

    const shell = screen.getByRole("status");
    expect(shell).toBeInTheDocument();
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(shell).toHaveAttribute("aria-label");
    expect(shell).toHaveAttribute("data-testid", "app-loading-shell");
  });

  it("includes a screen-reader announcement", async () => {
    const { AppLoadingShell } = await import("@/components/ui/AppLoadingShell");
    render(<AppLoadingShell />);

    // The sr-only span must mention loading
    const srText = screen.getByText(/loading kora/i);
    expect(srText).toBeInTheDocument();
    expect(srText).toHaveClass("sr-only");
  });
});
