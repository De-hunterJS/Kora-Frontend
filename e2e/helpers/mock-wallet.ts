/**
 * Playwright browser-context helpers for wallet mocking.
 *
 * Because the Stellar wallet extensions (Freighter, xBull, etc.) are not
 * available in a headless Chromium context, we inject lightweight window
 * stubs before each page load so the app's wallet-detection logic sees a
 * "connected" wallet without any real extension.
 *
 * The stubs mirror the minimal API surface that useWallet / StellarWalletsKit
 * actually calls during the E2E journeys under test.
 */

import type { BrowserContext, Page } from "@playwright/test";

export const MOCK_ADDRESS =
  "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

/**
 * Inject wallet stubs into every new page opened in this context.
 * Call once per test that needs a "connected" wallet state.
 */
export async function injectWalletStubs(
  context: BrowserContext,
  options: { usdcBalance?: string } = {},
) {
  await context.addInitScript(
    ({ address, usdcBalance }) => {
      // Freighter stub — minimal API surface used by StellarWalletsKit
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        getPublicKey: () => Promise.resolve(address),
        signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr }),
        getNetwork: () =>
          Promise.resolve({
            network: "TESTNET",
            networkPassphrase: "Test SDF Network ; September 2015",
          }),
        getNetworkDetails: () =>
          Promise.resolve({
            network: "TESTNET",
            networkPassphrase: "Test SDF Network ; September 2015",
            sorobanRpcUrl: "https://soroban-testnet.stellar.org",
          }),
      };

      // Persist a connected wallet state in localStorage so the Zustand
      // walletStore rehydrates as connected on page load.
      const walletState = {
        state: {
          address,
          publicKey: address,
          status: "connected",
          isConnected: true,
          provider: "freighter",
          network: "testnet",
          balance: {
            xlm: "1000.00",
            usdc: usdcBalance,
            eurc: "0",
          },
          isVerified: false,
          verifiedAt: null,
          walletPassphrase: "Test SDF Network ; September 2015",
        },
        version: 0,
      };
      localStorage.setItem("kora-wallet", JSON.stringify(walletState));
      localStorage.setItem("kora-wallet-store", JSON.stringify(walletState));
    },
    { address: MOCK_ADDRESS, usdcBalance: options.usdcBalance ?? "1000.00" },
  );
}

/**
 * Dismiss any wallet-connect modal that may appear by clicking the first
 * available wallet option (Freighter).
 */
export async function connectWalletViaModal(page: Page) {
  const modal = page.getByRole("dialog");
  if (await modal.isVisible()) {
    // Click Freighter — always the first wallet button in the list
    await modal
      .getByRole("button", { name: /freighter/i })
      .first()
      .click();
  }
}
