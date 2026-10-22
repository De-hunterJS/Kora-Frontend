import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const keys: Record<string, string> = {
      balances: "Balances",
        balanceLoadFailed: "Failed to load balances",
      copyAddress: "Copy address",
      retry: "Retry",
      unfundedAccountTitle: "Activate your Stellar account",
      unfundedAccountDescription: "Fund this account with XLM to activate it.",
      fundWithXlm: "Fund with XLM using Friendbot",
    };
    return keys[key] || key;
  },
}));

// Mock @/lib/env
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    NEXT_PUBLIC_ENABLE_MOCK_DATA: true,
    NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    NEXT_PUBLIC_INVOICE_CONTRACT_ID: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID: "CBWOAOZCOAJQH7HHZRE5BVNL2C4HRP4JCQZF3YQCQYDL5BZJRN4YGK4A",
    NEXT_PUBLIC_TOKEN_CONTRACT_ID: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    NEXT_PUBLIC_IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_APP_NAME: "Kora",
    NEXT_PUBLIC_APP_DESCRIPTION: "On-chain Invoice Financing Protocol",
  },
}));

let mockStoreAddress: string | null = "GBOOM";

// Mock useWalletStore to support both selector and non-selector calls
vi.mock("@/store", () => ({
  useWalletStore: (selector?: (s: any) => any) => {
    const state = {
      address: mockStoreAddress,
      publicKey: mockStoreAddress,
      isConnected: Boolean(mockStoreAddress),
      provider: "freighter",
      balance: { xlm: "100", usdc: "500", eurc: "50" },
      network: "testnet",
      kitSessionActive: true,
      kycStatus: "none",
      connect: vi.fn(),
      disconnect: vi.fn(),
      setBalance: vi.fn(),
      setKitSessionActive: vi.fn(),
      isWrongNetwork: () => false,
      hasPassphraseMismatch: () => false,
    };
    if (typeof selector === "function") {
      return selector(state);
    }
    return state;
  },
}));

// Mock useWalletBalances
const mockBalances = vi.fn();
const mockFundingAsset = vi.fn();
const mockLowBalanceAsset = vi.fn();
const mockIsLoading = vi.fn();
const mockIsError = vi.fn();
const mockError = vi.fn();
const mockIsUnfunded = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/hooks/useWalletBalances", () => ({
  useWalletBalances: () => ({
    balances: mockBalances(),
    fundingAsset: mockFundingAsset(),
    lowBalanceAsset: mockLowBalanceAsset(),
    isLoading: mockIsLoading(),
    isError: mockIsError(),
    error: mockError(),
    isUnfunded: mockIsUnfunded(),
    refresh: mockRefresh,
  }),
}));

// Mock useBreakpoint
const mockIsDesktop = vi.fn();
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: () => ({
    isDesktop: mockIsDesktop(),
  }),
}));

// Mock CopyToClipboard
const mockCopy = vi.fn();
const mockCopied = vi.fn();
vi.mock("@/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    copied: mockCopied(),
  }),
}));

// Mock StellarAddress (so we don't worry about tooltip rendering in jsdom details)
vi.mock("@/components/ui/stellar-address", () => ({
  StellarAddress: ({ address }: { address: string }) => (
    <div data-testid="mock-stellar-address">{address.slice(0, 4)}...{address.slice(-4)}</div>
  ),
}));

// Mock BottomSheet (we can just render its children for easy testing)
vi.mock("@/components/ui/bottom-sheet", () => ({
  BottomSheet: ({ open, children, title }: any) => {
    if (!open) return null;
    return (
      <div data-testid="mock-bottom-sheet">
        <h2>{title}</h2>
        {children}
      </div>
    );
  },
}));

// Mock TestnetUsdcFaucet
vi.mock("@/components/wallet/TestnetUsdcFaucet", () => ({
  TestnetUsdcFaucet: ({ compact, onSuccess }: any) => (
    <div data-testid="mock-usdc-faucet">
      <span>Mock Faucet (compact: {String(compact)})</span>
      <button onClick={() => onSuccess?.(10000)}>Mint Mock USDC</button>
    </div>
  ),
}));

import { WalletBalance } from "@/components/wallet/WalletBalance";

describe("WalletBalancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreAddress = "GBOOM";
    mockIsDesktop.mockReturnValue(true);
    mockIsLoading.mockReturnValue(false);
    mockIsError.mockReturnValue(false);
    mockError.mockReturnValue(null);
    mockIsUnfunded.mockReturnValue(false);
    mockRefresh.mockResolvedValue(undefined);
    mockBalances.mockReturnValue([
      { symbol: "XLM", rawAmount: 100, formattedAmount: "100.00", usdValue: undefined, isLowBalance: false },
      { symbol: "USDC", rawAmount: 500, formattedAmount: "500.00", usdValue: 500, isLowBalance: false },
      { symbol: "EURC", rawAmount: 50, formattedAmount: "50.00", usdValue: 50, isLowBalance: false },
    ]);
    mockFundingAsset.mockReturnValue({ symbol: "USDC", rawAmount: 500, formattedAmount: "500.00" });
    mockLowBalanceAsset.mockReturnValue(null);
  });

  it("renders null when wallet is disconnected", () => {
    mockStoreAddress = null;
    const { container } = render(<WalletBalance />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders trigger button with USDC balance", () => {
    render(<WalletBalance />);
    expect(screen.getByTestId("wallet-balance-trigger")).toBeInTheDocument();
    expect(screen.getByText("500.00 USDC")).toBeInTheDocument();
  });

  it("toggles desktop dropdown on click", async () => {
    const user = userEvent.setup();
    render(<WalletBalance />);
    
    expect(screen.queryByTestId("wallet-balance-dropdown")).not.toBeInTheDocument();
    
    await user.click(screen.getByTestId("wallet-balance-trigger"));
    expect(screen.getByTestId("wallet-balance-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("mock-stellar-address")).toHaveTextContent("GBOO...BOOM");
  });

  it("renders loading skeletons when loading", async () => {
    mockIsLoading.mockReturnValue(true);
    mockBalances.mockReturnValue([
      { symbol: "XLM", rawAmount: 0, formattedAmount: "0.00" },
      { symbol: "USDC", rawAmount: 0, formattedAmount: "0.00" },
      { symbol: "EURC", rawAmount: 0, formattedAmount: "0.00" },
    ]);
    
    const user = userEvent.setup();
    render(<WalletBalance />);
    await user.click(screen.getByTestId("wallet-balance-trigger"));
    
    expect(screen.getByTestId("wallet-balance-skeletons")).toBeInTheDocument();
  });

  it("renders error state with retry button", async () => {
    mockIsError.mockReturnValue(true);
    mockError.mockReturnValue(new Error("Connection timeout"));
    
    const user = userEvent.setup();
    render(<WalletBalance />);
    await user.click(screen.getByTestId("wallet-balance-trigger"));
    
    expect(screen.getByTestId("wallet-balance-error")).toBeInTheDocument();
    expect(screen.getByText("Failed to load balances")).toBeInTheDocument();
    
    await user.click(screen.getByTestId("wallet-balance-retry"));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders low balance warning badge", async () => {
    mockLowBalanceAsset.mockReturnValue({ symbol: "USDC", lowBalanceThreshold: 100 });
    
    const user = userEvent.setup();
    render(<WalletBalance />);
    await user.click(screen.getByTestId("wallet-balance-trigger"));
    
    expect(screen.getByTestId("wallet-balance-low-warning")).toBeInTheDocument();
    expect(screen.getByText("Low USDC balance (under 100)")).toBeInTheDocument();
  });

  it("shows activation guidance and suppresses balance warnings for unfunded accounts", async () => {
    mockIsError.mockReturnValue(true);
    mockIsUnfunded.mockReturnValue(true);
    mockLowBalanceAsset.mockReturnValue({ symbol: "USDC", lowBalanceThreshold: 100 });

    const user = userEvent.setup();
    render(<WalletBalance />);
    await user.click(screen.getByTestId("wallet-balance-trigger"));

    expect(screen.getByTestId("wallet-balance-unfunded")).toBeInTheDocument();
    expect(screen.getByTestId("wallet-balance-friendbot-link")).toHaveAttribute(
      "href",
      "https://friendbot.stellar.org?addr=GBOOM",
    );
    expect(screen.queryByTestId("wallet-balance-low-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wallet-balance-success")).not.toBeInTheDocument();
  });

  it("uses BottomSheet on mobile", async () => {
    mockIsDesktop.mockReturnValue(false);
    
    const user = userEvent.setup();
    render(<WalletBalance />);
    await user.click(screen.getByTestId("wallet-balance-trigger"));
    
    expect(screen.queryByTestId("wallet-balance-dropdown")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-bottom-sheet")).toBeInTheDocument();
  });
});
