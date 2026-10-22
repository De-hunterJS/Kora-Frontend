/**
 * Integration coverage for the mock/live InvoiceService factory switch.
 *
 * createInvoiceService() picks MockInvoiceService or LiveInvoiceService based
 * on env.NEXT_PUBLIC_ENABLE_MOCK_DATA. These tests mock the Soroban RPC layer
 * (lib/stellar/contracts, lib/stellar/client) and IPFS layer so both
 * implementations can be exercised without a real network.
 *
 * New suites added:
 *  - "CID cleanup on mint failure (live)" — verifies unpinMultipleFromPinata
 *    is called with every pinned CID when mintInvoice throws, and that the
 *    original error still reaches the caller.
 *  - "CID cleanup on mint failure (mock)" — same guarantee for the mock path
 *    via the __simulateContractError escape-hatch.
 *  - "No unpin on successful mint (live)" — asserts unpinMultipleFromPinata is
 *    never called when mintInvoice resolves.
 *  - "V1 metadata pipeline (live)" — asserts uploadValidatedInvoiceMetadata is
 *    called (not the legacy uploadInvoiceMetadata) and that mintInvoice
 *    receives the metadataCid returned by the validated pipeline.
 *  - "V1 metadata fixture keys" — asserts the V1 input built by
 *    formDataToMetadataV1Input contains required schema keys.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Env stub ────────────────────────────────────────────────────────────────
const mockEnv = {
  NEXT_PUBLIC_ENABLE_MOCK_DATA: true,
  NEXT_PUBLIC_IPFS_GATEWAY: "https://gateway.pinata.cloud/ipfs",
};
vi.mock("@/lib/env", () => ({ env: mockEnv }));

// ─── Soroban contract stubs ───────────────────────────────────────────────────
const getInvoice = vi.fn();
const mintInvoice = vi.fn();
const cancelInvoice = vi.fn();
const fundInvoice = vi.fn();
const repayInvoice = vi.fn();
const claimYield = vi.fn();
const getPositions = vi.fn();

vi.mock("@/lib/stellar/contracts", () => ({
  invoiceContract: { getInvoice, mintInvoice, cancelInvoice },
  marketplaceContract: { fundInvoice, repayInvoice, claimYield, getPositions },
}));

// ─── Stellar client stubs ─────────────────────────────────────────────────────
const submitTransaction = vi.fn();
const waitForTransaction = vi.fn();
vi.mock("@/lib/stellar/client", () => ({ submitTransaction, waitForTransaction }));

// ─── IPFS stubs ───────────────────────────────────────────────────────────────
const uploadFileToPinata = vi.fn().mockResolvedValue("QmDocCid");
const uploadInvoiceMetadata = vi.fn().mockResolvedValue("QmLegacyMetaCid");
const uploadValidatedInvoiceMetadata = vi.fn().mockResolvedValue({
  metadataCid: "QmV1MetaCid",
  imageCid: "QmImageCid",
  thumbnailCid: "QmThumbCid",
});
const unpinMultipleFromPinata = vi.fn().mockResolvedValue(undefined);
const unpinFromPinata = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/ipfs", () => ({
  uploadFileToPinata,
  uploadInvoiceMetadata,
  uploadValidatedInvoiceMetadata,
  unpinMultipleFromPinata,
  unpinFromPinata,
  isValidCID: vi.fn().mockReturnValue(true),
  fetchIpfsJsonWithFallback: vi.fn().mockResolvedValue({ data: {}, gateway: "mock", integrity: "skipped" }),
  IpfsTamperError: class IpfsTamperError extends Error {},
  IpfsUnavailableError: class IpfsUnavailableError extends Error {},
}));

// ─── Security stubs ───────────────────────────────────────────────────────────
vi.mock("@/lib/security", () => ({
  sanitizeIpfsMetadata: vi.fn((data: unknown) => data),
  createMockUploadToken: vi.fn(() => "mock-token"),
}));

// ─── Logger stub (silence warn output in test runner) ─────────────────────────
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Shared form fixture ──────────────────────────────────────────────────────
const VALID_FORM = {
  document: new File(["pdf-content"], "invoice.pdf", { type: "application/pdf" }),
  invoiceNumber: "INV-2026-001",
  description: "Enterprise software services Q1 2026",
  debtorName: "Acme Corp",
  debtorAddress: "123 Business Park, Lagos",
  amount: 50_000,
  currency: "USDC" as const,
  issueDate: "2026-01-15",
  dueDate: "2026-07-15",
  listingExpiryDate: "2026-06-15",
  jurisdiction: "NG" as const,
  category: "technology" as const,
  discountRate: 0.06,
  debtorPrivacy: "full" as const,
  minInvestment: 1_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: factory switch
// ─────────────────────────────────────────────────────────────────────────────
describe("createInvoiceService factory switch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Restore default mock resolutions after each test
    uploadFileToPinata.mockResolvedValue("QmDocCid");
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmV1MetaCid",
      imageCid: "QmImageCid",
      thumbnailCid: "QmThumbCid",
    });
    mintInvoice.mockResolvedValue("unsigned-mint-xdr");
  });

  it("returns a MockInvoiceService that resolves from local fixtures with no RPC calls", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = true;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();
    const result = await service.getInvoices();
    expect(result.ok).toBe(true);
    expect(getInvoice).not.toHaveBeenCalled();
    expect(fundInvoice).not.toHaveBeenCalled();
  });

  it("returns a LiveInvoiceService that reads through the mocked RPC contract client", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    getInvoice.mockResolvedValue({
      owner: "GOWNER",
      ipfs_cid: "QmCid",
      amount: 1_000_000n,
      financing_amount: 900_000n,
      discount_rate: 500,
      due_date: 1893456000n,
      funded_amount: 0n,
      status: 0,
      token_id: 42n,
    });
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();
    const result = await service.getInvoice("inv_42", "GSOURCE");
    expect(getInvoice).toHaveBeenCalledWith(42n, "GSOURCE");
    expect(result.ok).toBe(true);
  });

  it("live getInvoice fails fast without a source public key, without hitting RPC", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();
    const result = await service.getInvoice("inv_42");
    expect(result.ok).toBe(false);
    expect(getInvoice).not.toHaveBeenCalled();
  });

  it("routes live writes (fund/repay) through the mocked contract clients", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    fundInvoice.mockResolvedValue("unsigned-fund-xdr");
    repayInvoice.mockResolvedValue("unsigned-repay-xdr");
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const fundResult = await service.fundInvoice("42", 500, "GINVESTOR");
    expect(fundResult.ok).toBe(true);
    expect(fundInvoice).toHaveBeenCalledWith(
      { tokenId: 42n, amount: 500_000_000n },
      "GINVESTOR"
    );

    const repayResult = await service.repayInvoice("42", "GOWNER");
    expect(repayResult.ok).toBe(true);
    expect(repayInvoice).toHaveBeenCalledWith({ tokenId: 42n }, "GOWNER");
  });

  it("mock writes never touch the RPC contract clients", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = true;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();
    await service.fundInvoice("42", 500, "GINVESTOR");
    expect(fundInvoice).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: V1 metadata pipeline (live service)
// ─────────────────────────────────────────────────────────────────────────────
describe("V1 metadata pipeline — live service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    uploadFileToPinata.mockResolvedValue("QmDocCid");
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmV1MetaCid",
      imageCid: "QmImageCid",
      thumbnailCid: "QmThumbCid",
    });
    mintInvoice.mockResolvedValue("unsigned-mint-xdr");
  });

  it("calls uploadValidatedInvoiceMetadata, not the legacy uploadInvoiceMetadata", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(true);
    expect(uploadValidatedInvoiceMetadata).toHaveBeenCalledTimes(1);
    expect(uploadInvoiceMetadata).not.toHaveBeenCalled();
  });

  it("passes the docCid returned by uploadFileToPinata into the V1 input", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    uploadFileToPinata.mockResolvedValue("QmRealDocCid");
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    const [v1Input] = uploadValidatedInvoiceMetadata.mock.calls[0];
    expect(v1Input.ipfs_document_cid).toBe("QmRealDocCid");
    expect(v1Input.image).toBe("ipfs://QmRealDocCid");
  });

  it("passes the V1 metadataCid (not the docCid) to mintInvoice as ipfsCid", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmCanonicalV1Meta",
      imageCid: "QmImg",
      thumbnailCid: undefined,
    });
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(mintInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ ipfsCid: "QmCanonicalV1Meta" }),
      "GOWNERADDRESS56CHAR1234567890ABCDEF"
    );
  });

  it("returns { unsignedXdr, metadataCid } where metadataCid is the V1 value", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    mintInvoice.mockResolvedValue("xdr-from-contract");
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmV1Meta",
      imageCid: "QmImg",
      thumbnailCid: "QmThumb",
    });
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.unsignedXdr).toBe("xdr-from-contract");
      expect(result.value.metadataCid).toBe("QmV1Meta");
    }
  });

  it("V1 input invoice_number matches the form field", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    const [v1Input] = uploadValidatedInvoiceMetadata.mock.calls[0];
    expect(v1Input.invoice_number).toBe("INV-2026-001");
  });

  it("V1 input discount_rate is the decimal form (not basis points)", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    const [v1Input] = uploadValidatedInvoiceMetadata.mock.calls[0];
    expect(v1Input.discount_rate).toBe(0.06);
  });

  it("mintInvoice discountRate arg is in basis points (0.06 → 600)", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    const [mintParams] = mintInvoice.mock.calls[0];
    expect(mintParams.discountRate).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: CID cleanup on mint failure — live service
// ─────────────────────────────────────────────────────────────────────────────
describe("CID cleanup on mint failure — live service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    uploadFileToPinata.mockResolvedValue("QmDocCid");
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmV1MetaCid",
      imageCid: "QmImageCid",
      thumbnailCid: "QmThumbCid",
    });
    unpinMultipleFromPinata.mockResolvedValue(undefined);
  });

  it("calls unpinMultipleFromPinata with all pinned CIDs when mintInvoice throws", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    mintInvoice.mockRejectedValue(new Error("Soroban contract simulation failed"));
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(false);
    expect(unpinMultipleFromPinata).toHaveBeenCalledTimes(1);

    // Must include docCid, imageCid, thumbnailCid and metadataCid
    const [cidList] = unpinMultipleFromPinata.mock.calls[0] as [string[]];
    expect(cidList).toContain("QmDocCid");
    expect(cidList).toContain("QmImageCid");
    expect(cidList).toContain("QmThumbCid");
    expect(cidList).toContain("QmV1MetaCid");
  });

  it("includes docCid and metadataCid even when thumbnailCid is undefined", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmMeta",
      imageCid: "QmImg",
      thumbnailCid: undefined,
    });
    mintInvoice.mockRejectedValue(new Error("mint error"));
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    const [cidList] = unpinMultipleFromPinata.mock.calls[0] as [string[]];
    expect(cidList).toContain("QmDocCid");
    expect(cidList).toContain("QmImg");
    expect(cidList).toContain("QmMeta");
    // thumbnailCid was undefined — must not be in the list
    expect(cidList).not.toContain(undefined);
    expect(cidList.every((c) => typeof c === "string")).toBe(true);
  });

  it("original mint error still reaches the caller even when unpin succeeds", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    mintInvoice.mockRejectedValue(new Error("Unauthorized"));
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("original mint error still reaches the caller even when unpin itself fails", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    mintInvoice.mockRejectedValue(new Error("Contract error: timeout"));
    unpinMultipleFromPinata.mockRejectedValue(new Error("Pinata gateway unavailable"));
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(false);
    // The unpin failure must not surface — result.error must reflect the mint
    if (!result.ok) {
      expect(result.error.message).not.toContain("Pinata");
    }
  });

  it("calls unpinMultipleFromPinata with docCid only when uploadValidatedInvoiceMetadata throws", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    uploadValidatedInvoiceMetadata.mockRejectedValue(new Error("IPFS gateway unreachable"));
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(false);
    expect(unpinMultipleFromPinata).toHaveBeenCalledTimes(1);
    const [cidList] = unpinMultipleFromPinata.mock.calls[0] as [string[]];
    // Only the docCid was pinned before the failure
    expect(cidList).toEqual(["QmDocCid"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: No unpin on successful mint — live service
// ─────────────────────────────────────────────────────────────────────────────
describe("No unpin on successful mint — live service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    uploadFileToPinata.mockResolvedValue("QmDocCid");
    uploadValidatedInvoiceMetadata.mockResolvedValue({
      metadataCid: "QmV1MetaCid",
      imageCid: "QmImageCid",
      thumbnailCid: "QmThumbCid",
    });
    mintInvoice.mockResolvedValue("unsigned-xdr");
  });

  it("does NOT call unpinMultipleFromPinata when mint succeeds", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = false;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF");

    expect(result.ok).toBe(true);
    expect(unpinMultipleFromPinata).not.toHaveBeenCalled();
    expect(unpinFromPinata).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: CID cleanup on mint failure — mock service
// ─────────────────────────────────────────────────────────────────────────────
describe("CID cleanup on mint failure — mock service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    unpinMultipleFromPinata.mockResolvedValue(undefined);
  });

  it("calls unpinMultipleFromPinata when __simulateContractError is injected", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = true;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(
      { ...VALID_FORM, __simulateContractError: "Simulated contract failure" } as any,
      "GMOCKOWNER"
    );

    expect(result.ok).toBe(false);
    expect(unpinMultipleFromPinata).toHaveBeenCalledTimes(1);
    const [cidList] = unpinMultipleFromPinata.mock.calls[0] as [string[]];
    // Mock service pins a doc CID and an image CID before the error
    expect(cidList.length).toBeGreaterThanOrEqual(2);
    expect(cidList.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
  });

  it("original error still reaches the caller in mock mode", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = true;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(
      { ...VALID_FORM, __simulateContractError: "Simulated failure" } as any,
      "GMOCKOWNER"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CREATE_ERROR");
    }
  });

  it("does NOT call unpinMultipleFromPinata in mock mode on a successful create", async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_MOCK_DATA = true;
    const { createInvoiceService } = await import("../invoiceService");
    const service = createInvoiceService();

    const result = await service.createInvoice(VALID_FORM, "GMOCKOWNER");

    expect(result.ok).toBe(true);
    expect(unpinMultipleFromPinata).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: formDataToMetadataV1Input mapper
// ─────────────────────────────────────────────────────────────────────────────
describe("formDataToMetadataV1Input", () => {
  it("produces required V1 keys from valid form data", async () => {
    const { formDataToMetadataV1Input } = await import("@/lib/invoiceMetadata");
    const input = formDataToMetadataV1Input(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF", "QmDoc");
    expect(input.invoice_number).toBe("INV-2026-001");
    expect(input.amount).toBe(50_000);
    expect(input.currency).toBe("USDC");
    expect(input.due_date).toBe("2026-07-15");
    expect(input.issuer.address).toBe("GOWNERADDRESS56CHAR1234567890ABCDEF");
    expect(input.debtor.name).toBe("Acme Corp");
    expect(input.ipfs_document_cid).toBe("QmDoc");
    expect(input.image).toBe("ipfs://QmDoc");
    expect(input.discount_rate).toBe(0.06);
    expect(input.jurisdiction).toBe("NG");
    expect(input.category).toBe("technology");
  });

  it("due_date is always in YYYY-MM-DD format (no time portion)", async () => {
    const { formDataToMetadataV1Input } = await import("@/lib/invoiceMetadata");
    const input = formDataToMetadataV1Input(
      { ...VALID_FORM, dueDate: "2026-07-15T00:00:00.000Z" },
      "GOWNERADDRESS56CHAR1234567890ABCDEF",
      "QmDoc"
    );
    expect(input.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("attributes array contains Discount Rate as boost_percentage", async () => {
    const { formDataToMetadataV1Input } = await import("@/lib/invoiceMetadata");
    const input = formDataToMetadataV1Input(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF", "QmDoc");
    const attr = input.attributes?.find((a) => a.trait_type === "Discount Rate");
    expect(attr).toBeDefined();
    expect(attr?.display_type).toBe("boost_percentage");
    expect(attr?.value).toBe(6); // 0.06 * 100
  });

  it("input passes the invoiceMetadataV1Schema when metadata_version is injected", async () => {
    const { formDataToMetadataV1Input, invoiceMetadataV1Schema, METADATA_VERSION } =
      await import("@/lib/invoiceMetadata");
    const input = formDataToMetadataV1Input(VALID_FORM, "GOWNERADDRESS56CHAR1234567890ABCDEF", "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco");

    // The input has a placeholder image — replace with a valid one for schema check
    const withVersion = {
      metadata_version: METADATA_VERSION,
      ...input,
      image: "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      issuer: { ...input.issuer, address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    };

    const parsed = invoiceMetadataV1Schema.safeParse(withVersion);
    expect(parsed.success).toBe(true);
  });
});
