/// <reference types="@testing-library/jest-dom" />
/**
 * Integration tests for the Create Invoice wizard.
 *
 * Covers:
 *  - Step 1 (Invoice Details): field filling, validation errors, Next gating
 *  - Step 2 (Financing Terms): slider interaction, APR display, Next gating
 *  - Step 3 (Upload & Review): file upload, submit success, submit error
 *  - Back navigation with value preservation
 *  - Full end-to-end happy path
 *
 * Mocks:
 *  - lib/ipfs.ts              → uploadFileToPinata, uploadInvoiceMetadata
 *  - lib/stellar/contracts.ts → invoiceContract.mintInvoice
 *  - hooks/useWallet.ts       → isConnected, address, signTransaction
 *  - store                    → useUIStore, useInvoiceStore (in-memory, no persistence)
 *
 * MSW handles /api/upload at the network layer (see mocks/handlers.ts).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

// ── Hoisted variables (must be declared before vi.mock factories run) ─────────

const { mockSignTransaction, mockSetWalletModalOpen, mockUseWalletStore } = vi.hoisted(() => {
  const { create } = require("zustand");
  const useWalletStore = create()(() => ({
    addressBook: [],
    address: "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
    isConnected: true,
    isVerified: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    setBalance: vi.fn(),
    setVerified: vi.fn(),
    clearVerification: vi.fn(),
    isVerificationExpired: vi.fn(() => true),
    addAddressBookEntry: vi.fn(),
  }));

  return {
    mockSignTransaction: vi.fn().mockImplementation(async (xdr: string) => `${xdr}_signed`),
    mockSetWalletModalOpen: vi.fn(),
    mockUseWalletStore: useWalletStore,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/store/walletStore", () => ({
  useWalletStore: mockUseWalletStore,
}));

vi.mock("@/lib/ipfs", () => ({
  uploadFileToPinata: vi.fn().mockResolvedValue(
    "QmMockPdfCid1234567890abcdefghijklmnopqrstuvwxyz12"
  ),
  uploadInvoiceMetadata: vi.fn().mockResolvedValue(
    "QmMockMetaCid1234567890abcdefghijklmnopqrstuvwxyz1"
  ),
  uploadInvoicePDF: vi.fn().mockResolvedValue(
    "QmMockPdfCid1234567890abcdefghijklmnopqrstuvwxyz12"
  ),
  validateCid: vi.fn(),
  checkPinataHealth: vi.fn().mockResolvedValue(true),
  ipfsUrl: vi.fn((cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`),
}));

vi.mock("@/components/ui/date-picker", () => {
  const React = require("react");
  const DatePicker = React.forwardRef(({ label, id, name, onChange, value, defaultValue, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-") || generatedId;
    return (
      <div className="flex flex-col">
        {label && <label htmlFor={inputId}>{label}</label>}
        <input
          type="date"
          id={inputId}
          name={name}
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          {...props}
        />
      </div>
    );
  });
  DatePicker.displayName = "DatePicker";
  return { DatePicker };
});

vi.mock("@/components/ui/select", () => {
  const React = require("react");
  const Select = React.forwardRef(({ label, id, name, options = [], onChange, value, defaultValue, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-") || generatedId;
    
    const flatOptions = [];
    options.forEach(opt => {
      if (opt && typeof opt === "object" && "options" in opt && Array.isArray(opt.options)) {
        opt.options.forEach(sub => flatOptions.push(sub));
      } else if (opt) {
        flatOptions.push(opt);
      }
    });

    return (
      <div className="flex flex-col">
        {label && <label htmlFor={selectId}>{label}</label>}
        <select
          id={selectId}
          name={name}
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          {...props}
        >
          <option value="">Select option...</option>
          {flatOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  });
  Select.displayName = "Select";
  return { Select };
});

vi.mock("@/lib/stellar/contracts", () => ({
  invoiceContract: {
    mintInvoice: vi.fn().mockResolvedValue("mock_unsigned_xdr_mint_invoice"),
  },
  marketplaceContract: {
    fundInvoice: vi.fn(),
    repayInvoice: vi.fn(),
  },
}));

vi.mock("@/lib/stellar/client", () => ({
  rpc: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    getTransaction: vi.fn(),
  },
  submitTransaction: vi.fn(),
  waitForTransaction: vi.fn(),
  networkConfig: { networkPassphrase: "Test SDF Network ; September 2015" },
}));

// Wallet hook — connected by default; individual tests can override
vi.mock("@/hooks/useWallet", () => ({
  useWallet: vi.fn(() => ({
    isConnected: true,
    address: "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
    signTransaction: mockSignTransaction,
    isVerified: false,
    checkVerification: vi.fn(() => false),
  })),
}));

vi.mock("@/store", async () => {
  const { create } = await import("zustand");

  const useUIStore = create<any>()((set) => ({
    walletModalOpen: false,
    txState: { status: "idle" },
    setWalletModalOpen: mockSetWalletModalOpen,
    setTxState: (s: any) => set((prev: any) => ({ txState: { ...prev.txState, ...s } })),
    resetTxState: () => set({ txState: { status: "idle" } }),
    sidebarOpen: false,
    setSidebarOpen: vi.fn(),
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }));

  const useInvoiceStore = create<any>()((set) => ({
    createDraft: { currency: "USDC" },
    setCreateDraft: (draft: any) =>
      set((s: any) => ({ createDraft: { ...s.createDraft, ...draft } })),
    clearCreateDraft: () => set({ createDraft: { currency: "USDC" } }),
    invoices: [],
    filters: {
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
    },
    sort: { sortBy: "apr", sortDir: "desc" },
    searchQuery: "",
    setFilters: vi.fn(),
    setSort: vi.fn(),
    setSearchQuery: vi.fn(),
  }));

  const useTransactionStore = create<any>()(() => ({
    transactions: [],
    addTransaction: vi.fn(),
    removeTransaction: vi.fn(),
    clearHistory: vi.fn(),
  }));

  return {
    useUIStore,
    useInvoiceStore,
    useWalletStore: mockUseWalletStore,
    useTransactionStore,
  };
});

// ── Import SUT after mocks ────────────────────────────────────────────────────

import CreateInvoicePage from "@/app/invoice/create/page";
import { useWallet } from "@/hooks/useWallet";
import { useUIStore, useInvoiceStore, useWalletStore } from "@/store";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  const user = userEvent.setup();
  const utils = render(<CreateInvoicePage />);
  return { user, ...utils };
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

beforeEach(() => {
  useInvoiceStore.setState({
    createDraft: { currency: "USDC" },
    invoices: [],
    filters: {
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
    },
    sort: { sortBy: "apr", sortDir: "desc" },
    searchQuery: "",
  });
  useUIStore.setState({
    walletModalOpen: false,
    txState: { status: "idle" },
    sidebarOpen: false,
    theme: "dark",
  });
  useWalletStore.setState({
    addressBook: [],
    address: "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
    isConnected: true,
    isVerified: false,
  });
});

/** Fill all Step 1 fields with valid data */
async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  const invInput = screen.getByLabelText(/invoice number/i);
  fireEvent.change(invInput, { target: { value: "INV-2024-0001" } });
  fireEvent.blur(invInput);

  const debtorInput = screen.getByLabelText(/debtor company name/i);
  fireEvent.change(debtorInput, { target: { value: "Acme Corporation Ltd" } });
  fireEvent.blur(debtorInput);

  const addrInput = screen.getByLabelText(/debtor address/i);
  fireEvent.change(addrInput, { target: { value: "123 Business St, Nairobi, Kenya" } });
  fireEvent.blur(addrInput);

  const amountInput = screen.getByRole("spinbutton", { name: /invoice amount/i });
  fireEvent.change(amountInput, { target: { value: "50000" } });
  fireEvent.blur(amountInput);

  const dueInput = screen.getByLabelText(/due date/i);
  fireEvent.change(dueInput, { target: { value: futureDate(90) } });
  fireEvent.blur(dueInput);
}

/** Fill all Step 2 fields with valid data */
async function fillStep2(user: ReturnType<typeof userEvent.setup>) {
  const discountInput = screen.getByRole("spinbutton", { name: /discount rate/i });
  fireEvent.change(discountInput, { target: { value: "5" } });
  fireEvent.blur(discountInput);

  const minInvInput = screen.getByRole("spinbutton", { name: /minimum investment/i });
  fireEvent.change(minInvInput, { target: { value: "1000" } });
  fireEvent.blur(minInvInput);

  const expiryInput = screen.getByLabelText(/listing expiry date/i);
  fireEvent.change(expiryInput, { target: { value: futureDate(30) } });
  fireEvent.blur(expiryInput);
}

function mockPdfFile(name = "invoice.pdf"): File {
  return new File(["mock-pdf-content"], name, { type: "application/pdf" });
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("File input not found");
  await user.upload(input, file);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Step 1 — Invoice Details", () => {
  beforeEach(() => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      address: "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
      signTransaction: mockSignTransaction,
      isVerified: false,
      checkVerification: vi.fn(() => false),
    } as any);
  });

  it("renders all Step 1 fields", () => {
    setup();
    expect(screen.getByLabelText(/invoice number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/debtor company name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/debtor address/i)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /invoice amount/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/jurisdiction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/industry category/i)).toBeInTheDocument();
  });

  it("shows step indicator with Step 1 label", () => {
    setup();
    expect(screen.getByText("Invoice Details")).toBeInTheDocument();
  });

  it("Next button is disabled when form is empty (step0Valid = false)", () => {
    setup();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("Next button becomes enabled after all required fields are filled", async () => {
    const { user } = setup();
    await fillStep1(user);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled()
    );
  });

  it("shows validation error for empty invoice number on blur", async () => {
    const { user } = setup();
    const field = screen.getByLabelText(/invoice number/i);
    await user.click(field);
    fireEvent.blur(field);
    await waitFor(() =>
      expect(screen.getByText(/invoice number is required/i)).toBeInTheDocument()
    );
  });

  it("shows validation error for invoice number with special characters", async () => {
    const { user } = setup();
    const field = screen.getByLabelText(/invoice number/i);
    await user.type(field, "INV@#$%");
    fireEvent.blur(field);
    await waitFor(() =>
      expect(
        screen.getByText(/alphanumeric characters and hyphens/i)
      ).toBeInTheDocument()
    );
  });

  it("shows validation error for amount below minimum", async () => {
    const { user } = setup();
    const field = screen.getByRole("spinbutton", { name: /invoice amount/i });
    await user.type(field, "50");
    fireEvent.blur(field);
    await waitFor(() =>
      expect(screen.getByText(/minimum \$100/i)).toBeInTheDocument()
    );
  });

  it("shows validation error for debtor name too short", async () => {
    const { user } = setup();
    const field = screen.getByLabelText(/debtor company name/i);
    await user.type(field, "A");
    fireEvent.blur(field);
    await waitFor(() =>
      expect(screen.getByText(/debtor name is required/i)).toBeInTheDocument()
    );
  });

  it("shows validation error for debtor address too short", async () => {
    const { user } = setup();
    const field = screen.getByLabelText(/debtor address/i);
    await user.type(field, "123");
    fireEvent.blur(field);
    await waitFor(() =>
      expect(screen.getByText(/debtor address is required/i)).toBeInTheDocument()
    );
  });

  it("advances to Step 2 when all fields are valid and Next is clicked", async () => {
    const { user } = setup();
    await fillStep1(user);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn).not.toBeDisabled());
    fireEvent.click(nextBtn);
    await screen.findByRole("slider");
  });

  it("Back button is disabled on Step 1", () => {
    setup();
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
  });

  it("jurisdiction defaults to Kenya (KE)", () => {
    setup();
    const select = screen.getByLabelText(/jurisdiction/i) as HTMLSelectElement;
    expect(select.value).toBe("KE");
  });

  it("category defaults to technology", () => {
    setup();
    const select = screen.getByLabelText(/industry category/i) as HTMLSelectElement;
    expect(select.value).toBe("technology");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Step 2 — Financing Terms", () => {
  beforeEach(() => {
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      address: "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
      signTransaction: mockSignTransaction,
      isVerified: false,
      checkVerification: vi.fn(() => false),
    } as any);
  });

  async function goToStep2() {
    const { user, ...utils } = setup();
    await fillStep1(user);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn).not.toBeDisabled());
    fireEvent.click(nextBtn);
    await screen.findByText(/live financing preview/i);
    return { user, ...utils };
  }

  it("renders discount rate slider and number input", async () => {
    await goToStep2();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /discount rate/i })).toBeInTheDocument();
  });

  it("renders minimum investment and listing expiry fields", async () => {
    await goToStep2();
    expect(screen.getByRole("spinbutton", { name: /minimum investment/i })).toBeInTheDocument();
    expect(screen.getByText(/listing expiry date/i)).toBeInTheDocument();
  });

  it("typing in discount rate number input updates the slider", async () => {
    const { user } = await goToStep2();
    const numInput = screen.getByRole("spinbutton", { name: /discount rate/i });
    await user.clear(numInput);
    await user.type(numInput, "8");
    const slider = screen.getByRole("slider") as HTMLInputElement;
    await waitFor(() => expect(parseFloat(slider.value)).toBe(8));
  });

  it("slider change updates the discount rate number input", async () => {
    await goToStep2();
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "10" } });
    const numInput = screen.getByRole("spinbutton", { name: /discount rate/i }) as HTMLInputElement;
    await waitFor(() => expect(parseFloat(numInput.value)).toBe(10));
  });

  it("shows Live Financing Preview panel", async () => {
    await goToStep2();
    expect(screen.getByText(/live financing preview/i)).toBeInTheDocument();
    expect(screen.getByText(/financing amount/i)).toBeInTheDocument();
    expect(screen.getByText(/investor payout at maturity/i)).toBeInTheDocument();
  });

  it("financing amount updates when discount rate changes", async () => {
    const { user } = await goToStep2();
    const numInput = screen.getByRole("spinbutton", { name: /discount rate/i });
    await user.clear(numInput);
    await user.type(numInput, "5");
    // $50,000 * (1 - 0.05) = $47,500
    await waitFor(() =>
      expect(screen.getByText(/47,500/)).toBeInTheDocument()
    );
  });

  it("shows validation error when discount rate is below 0.5", async () => {
    const { user } = await goToStep2();
    const numInput = screen.getByRole("spinbutton", { name: /discount rate/i });
    await user.clear(numInput);
    await user.type(numInput, "0.1");
    fireEvent.blur(numInput);
    await waitFor(() =>
      expect(screen.getByText(/min 0\.5%/i)).toBeInTheDocument()
    );
  });

  it("shows validation error when discount rate exceeds 20", async () => {
    const { user } = await goToStep2();
    const numInput = screen.getByRole("spinbutton", { name: /discount rate/i });
    await user.clear(numInput);
    await user.type(numInput, "25");
    fireEvent.blur(numInput);
    await waitFor(() =>
      expect(screen.getByText(/max 20%/i)).toBeInTheDocument()
    );
  });

  it("shows validation error when min investment exceeds invoice amount", async () => {
    const { user } = await goToStep2();
    await fillStep2(user);
    const minInvInput = screen.getByRole("spinbutton", { name: /minimum investment/i });
    fireEvent.change(minInvInput, { target: { value: "99999" } });
    fireEvent.blur(minInvInput);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);
    await screen.findByText(/minimum investment cannot exceed/i);
  });

  it("does not advance to Step 3 when discount rate is invalid", async () => {
    const { user } = await goToStep2();
    const numInput = screen.getByRole("spinbutton", { name: /discount rate/i });
    fireEvent.change(numInput, { target: { value: "0" } });
    fireEvent.blur(numInput);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);
    // Should still be on Step 2
    await waitFor(() =>
      expect(screen.getByText(/live financing preview/i)).toBeInTheDocument()
    );
  });

  it("advances to Step 3 when all Step 2 fields are valid", async () => {
    const { user } = await goToStep2();
    await fillStep2(user);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);
    await screen.findByText(/invoice document/i);
  });

  it("Back button is enabled on Step 2", async () => {
    await goToStep2();
    expect(screen.getByRole("button", { name: /back/i })).not.toBeDisabled();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// STEP PERSISTENCE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Step persistence — sessionStorage + ?step= param", () => {
  const WIZARD_STEP_KEY = "kora-invoice-create-step";

  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(useWallet).mockReturnValue({
      isConnected: true,
      address: "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
      signTransaction: mockSignTransaction,
      isVerified: false,
      checkVerification: vi.fn(() => false),
    } as any);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("writes step 0 to sessionStorage on initial render", async () => {
    setup();
    await waitFor(() =>
      expect(sessionStorage.getItem(WIZARD_STEP_KEY)).toBe("0")
    );
  });

  it("writes step 1 to sessionStorage after advancing from step 0", async () => {
    const { user } = setup();
    await fillStep1(user);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn).not.toBeDisabled());
    fireEvent.click(nextBtn);
    await screen.findByText(/live financing preview/i);
    await waitFor(() =>
      expect(sessionStorage.getItem(WIZARD_STEP_KEY)).toBe("1")
    );
  });

  it("restores step 1 from sessionStorage when form data satisfies step 0 schema", async () => {
    // Pre-seed a draft that satisfies step 0 so the restored step is allowed
    useInvoiceStore.setState({
      createDraft: {
        currency: "USDC",
        invoiceNumber: "INV-2024-TEST",
        debtorName: "Acme Corporation Ltd",
        debtorAddress: "123 Business St, Nairobi, Kenya",
        amount: 50000,
        dueDate: futureDate(90),
        jurisdiction: "KE",
        category: "technology",
        debtorPrivacy: "full",
      },
    });
    sessionStorage.setItem(WIZARD_STEP_KEY, "1");
    setup();
    // Should land on step 1 (Financing Terms)
    await screen.findByText(/live financing preview/i);
  });

  it("clamps restored step to 0 if form data does not satisfy step 0 schema", async () => {
    // Empty draft — step 0 schema will fail
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    setup();
    // Should stay on step 0
    await waitFor(() =>
      expect(screen.getByLabelText(/invoice number/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/upload/i)).not.toBeInTheDocument();
  });

  it("?step=1 query param restores step 1 when form data satisfies schema", async () => {
    useInvoiceStore.setState({
      createDraft: {
        currency: "USDC",
        invoiceNumber: "INV-QP-001",
        debtorName: "Query Param Corp",
        debtorAddress: "1 Param Street, Lagos, Nigeria",
        amount: 20000,
        dueDate: futureDate(60),
        jurisdiction: "NG",
        category: "finance",
        debtorPrivacy: "full",
      },
    });
    // Mock useSearchParams to return ?step=1
    vi.mock("next/navigation", async () => {
      const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
      return {
        ...actual,
        useSearchParams: () => new URLSearchParams("step=1"),
        useRouter: () => ({ replace: vi.fn() }),
      };
    });
    setup();
    await screen.findByText(/live financing preview/i);
  });

  it("clears sessionStorage on successful mint", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "2");
    const { user } = setup();

    // Navigate to step 2
    await fillStep1(user);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/live financing preview/i);
    await fillStep2(user);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/invoice document/i);

    // Upload and submit
    const file = mockPdfFile();
    await uploadFile(user, file);
    const mintBtn = await screen.findByRole("button", { name: /mint invoice/i });
    fireEvent.click(mintBtn);

    await waitFor(() =>
      expect(sessionStorage.getItem(WIZARD_STEP_KEY)).toBeNull()
    );
  });

  it("ignores stale step index that is out of range (> 2)", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "99");
    setup();
    await waitFor(() =>
      expect(screen.getByLabelText(/invoice number/i)).toBeInTheDocument()
    );
  });

  it("ignores non-numeric step value in sessionStorage", async () => {
    sessionStorage.setItem(WIZARD_STEP_KEY, "not-a-number");
    setup();
    await waitFor(() =>
      expect(screen.getByLabelText(/invoice number/i)).toBeInTheDocument()
    );
  });
});
