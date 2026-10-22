/**
 * Invoice service — factory pattern supporting mock and live Soroban contracts.
 * Set NEXT_PUBLIC_ENABLE_MOCK_DATA=true to use mock data.
 */
import type {
  Invoice,
  CreateInvoiceFormData,
  PaginatedResponse,
  MarketplaceFilters,
  MarketplaceSort,
  InvoicePosition,
  IInvoiceService,
  ServiceError,
  ServiceErrorCode,
  Result,
  InvoiceStatus,
} from "@/types";
import { MOCK_INVOICES } from "./mockData";
import {
  uploadFileToPinata,
  uploadInvoiceMetadata,
  uploadValidatedInvoiceMetadata,
  unpinMultipleFromPinata,
  isValidCID,
  fetchIpfsJsonWithFallback,
  IpfsTamperError,
  IpfsUnavailableError,
} from "@/lib/ipfs";
import { formDataToMetadataV1Input } from "@/lib/invoiceMetadata";
import { invoiceContract, marketplaceContract } from "@/lib/stellar/contracts";
import { indexerClient, RpcNetworkError } from "@/lib/stellar/indexerClient";
import { BadSequenceError, submitTransaction, waitForTransaction } from "@/lib/stellar/client";
import { sanitizeIpfsMetadata } from "@/lib/security";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { isValidStellarAddress } from "@/lib/utils";

// ─── Helper: Create successful result ──────────────────────────────────────
function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

// ─── Helper: Create error result ──────────────────────────────────────────
function failure(code: ServiceErrorCode, message: string, details?: any): Result<never> {
  return { ok: false, error: { code, message, details } };
}

// ─── Helper: Map contract errors to user-friendly messages ────────────────
function mapContractError(error: unknown): ServiceError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Invoice not found")) {
    return { code: "NOT_FOUND", message: "Invoice not found" };
  }
  if (message.includes("Insufficient balance")) {
    return { code: "INSUFFICIENT_BALANCE", message: "Insufficient balance to fund this invoice" };
  }
  if (message.includes("Unauthorized")) {
    return { code: "UNAUTHORIZED", message: "You do not have permission to perform this action" };
  }
  if (message.includes("already funded")) {
    return { code: "ALREADY_FUNDED", message: "This invoice has already been funded" };
  }
  if (message.includes("already been repaid")) {
    return { code: "ALREADY_REPAID", message: "This invoice has already been repaid" };
  }
  return { code: "CONTRACT_ERROR", message: `Contract error: ${message}` };
}

// ─── Helper: Map contract errors for the transfer_position flow ───────────
function mapTransferError(error: unknown): ServiceError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Invoice not found")) {
    return { code: "NOT_FOUND", message: "Position not found" };
  }
  if (message.includes("Unauthorized")) {
    return {
      code: "UNAUTHORIZED",
      message: "Only the current position owner can transfer it",
    };
  }
  return { code: "TRANSFER_ERROR", message: `Transfer failed: ${message}` };
}

/**
 * Fetch, verify, and sanitize invoice metadata from IPFS.
 *
 * Uses multi-gateway fallback with per-gateway timeout/retry (#393): if the
 * configured gateway is down we rotate to public gateways. The content hash is
 * verified against the CID where possible, and tampered content is surfaced as
 * a distinct IPFS_TAMPERED error so the UI can warn the user.
 */
async function fetchAndSanitizeIpfsMetadata(
  cid: string
): Promise<Result<Record<string, unknown>>> {
  if (!isValidCID(cid)) {
    return failure("INVALID_CID", "Invalid IPFS CID format");
  }
  try {
    const { data } = await fetchIpfsJsonWithFallback<unknown>(cid, {
      timeoutMs: 10_000,
      // In mock mode the CID is synthetic and won't hash-match — skip verification.
      skipIntegrity: env.NEXT_PUBLIC_ENABLE_MOCK_DATA,
    });
    return success(sanitizeIpfsMetadata(data));
  } catch (error) {
    if (error instanceof IpfsTamperError) {
      return failure("IPFS_TAMPERED", error.message, { cid });
    }
    if (error instanceof IpfsUnavailableError) {
      return failure("IPFS_ERROR", error.message, { cid });
    }
    return failure("IPFS_ERROR", "Failed to fetch IPFS metadata", {
      cause: String(error),
    });
  }
}

// ─── Mock Invoice Service ─────────────────────────────────────────────────
class MockInvoiceService implements IInvoiceService {
  private readonly MOCK_DELAY = 300; // ms

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.MOCK_DELAY));
  }

  async getInvoices(
    filters: MarketplaceFilters = {},
    sort: MarketplaceSort = { key: "apr", direction: "desc" },
    page = 1,
    pageSize = 12
  ): Promise<Result<PaginatedResponse<Invoice>>> {
    try {
      await this.delay();
      let data = [...MOCK_INVOICES];

      // Apply filters
      if (filters.category) data = data.filter((i) => i.metadata.category === filters.category);
      if (filters.categories && filters.categories.length > 0) {
        data = data.filter((i) => filters.categories!.includes(i.metadata.category));
      }
      if (filters.jurisdiction) data = data.filter((i) => i.metadata.jurisdiction === filters.jurisdiction);
      if (filters.jurisdictions && filters.jurisdictions.length > 0) {
        data = data.filter((i) => filters.jurisdictions!.includes(i.metadata.jurisdiction));
      }
      if (filters.riskTier) data = data.filter((i) => i.riskTier === filters.riskTier);
      if (filters.riskTiers && filters.riskTiers.length > 0) {
        data = data.filter((i) => filters.riskTiers!.includes(i.riskTier));
      }
      if (filters.currency) data = data.filter((i) => i.metadata.currency === filters.currency);
      if (filters.minApr) data = data.filter((i) => i.terms.apr >= filters.minApr!);
      if (filters.maxApr) data = data.filter((i) => i.terms.apr <= filters.maxApr!);
      if (filters.aprRange) {
        const [min, max] = filters.aprRange;
        data = data.filter((i) => i.terms.apr >= min && i.terms.apr <= max);
      }
      if (filters.status) data = data.filter((i) => i.status === filters.status);
      if (filters.activeOnly) {
        data = data.filter((i) => i.status === "listed" || i.status === "partially_funded");
      }

      // Apply sort
      data.sort((a, b) => {
        let aVal: number, bVal: number;
        switch (sort.key) {
          case "apr":
            aVal = a.terms.apr;
            bVal = b.terms.apr;
            break;
          case "amount":
            aVal = a.metadata.amount;
            bVal = b.metadata.amount;
            break;
          case "duration":
            aVal = a.terms.tenor;
            bVal = b.terms.tenor;
            break;
          case "riskScore":
            aVal = a.riskScore;
            bVal = b.riskScore;
            break;
          default:
            aVal = new Date(a.createdAt).getTime();
            bVal = new Date(b.createdAt).getTime();
        }
        return sort.direction === "asc" ? aVal - bVal : bVal - aVal;
      });

      const start = (page - 1) * pageSize;
      return success({
        data: data.slice(start, start + pageSize),
        total: data.length,
        page,
        pageSize,
        hasMore: start + pageSize < data.length,
      });
    } catch (error) {
      return failure("FETCH_ERROR", "Failed to fetch invoices", { cause: String(error) });
    }
  }

  async getInvoice(id: string): Promise<Result<Invoice | null>> {
    try {
      await this.delay();
      // Resolve by app id OR on-chain token ID deep links (#383)
      return success(
        MOCK_INVOICES.find((i) => i.id === id || i.tokenId === id) ?? null
      );
    } catch (error) {
      return failure("FETCH_ERROR", "Failed to fetch invoice", { cause: String(error) });
    }
  }

  async getInvoicesByOwner(ownerAddress: string): Promise<Result<Invoice[]>> {
    try {
      await this.delay();
      return success(MOCK_INVOICES.filter((i) => i.ownerAddress === ownerAddress));
    } catch (error) {
      return failure("FETCH_ERROR", "Failed to fetch invoices by owner", { cause: String(error) });
    }
  }

  async getPositions(investorAddress: string): Promise<Result<InvoicePosition[]>> {
    try {
      await this.delay();
      const amounts = [15000, 50000, 5000, 100000, 25000, 8000];
      const positions = MOCK_INVOICES.slice(0, 6).map((inv, i) => {
        const invested = amounts[i % 6];
        const isRepaid = inv.status === "repaid" || i === 1;
        const yieldEarned = isRepaid ? Math.round(invested * inv.terms.discountRate) : 0;
        return {
          invoiceId: inv.id,
          invoice: inv,
          investedAmount: invested,
          expectedReturn: invested * (1 + inv.terms.discountRate),
          yieldEarned,
          investedAt: new Date().toISOString(),
          status: (isRepaid ? "repaid" : "active") as "repaid" | "active",
        };
      });
      return success(positions);
    } catch (error) {
      return failure("FETCH_ERROR", "Failed to fetch positions", { cause: String(error) });
    }
  }

  async getIpfsMetadata(cid: string): Promise<Result<Record<string, unknown>>> {
    return fetchAndSanitizeIpfsMetadata(cid);
  }

  async createInvoice(
    formData: CreateInvoiceFormData,
    ownerAddress: string,
    onProgress?: (progress: number) => void
  ): Promise<Result<{ unsignedXdr: string; metadataCid: string }>> {
    if (!formData.document) {
      return failure("INVALID_FORM", "Invoice document is required");
    }

    // Mirror the live-service CID tracking pattern for test parity.
    // In mock mode we don't actually call Pinata, so pinnedCids holds
    // synthetic IDs.  The compensating unpin path is exercised the same
    // way as in the live service when simulateContractError is injected.
    const pinnedCids: string[] = [];

    try {
      await this.delay();

      onProgress?.(15);
      const mockDocCid = `mock_doc_${Date.now()}`;
      pinnedCids.push(mockDocCid);

      onProgress?.(55);
      const mockImageCid = `mock_image_${Date.now()}`;
      const mockMetadataCid = `mock_metadata_${Date.now()}`;
      pinnedCids.push(mockImageCid, mockMetadataCid);

      onProgress?.(75);

      // Allow test injection of a contract-level failure after successful pins
      if ((formData as any).__simulateContractError) {
        throw new Error((formData as any).__simulateContractError);
      }

      onProgress?.(100);
      return success({
        unsignedXdr: `mock_unsigned_xdr_create_${Date.now()}`,
        metadataCid: mockMetadataCid,
      });
    } catch (error) {
      // Best-effort compensating unpin — mirrors live service behaviour
      if (pinnedCids.length > 0) {
        logger.warn("[mock createInvoice] mint failed after IPFS pin; unpin attempted", {
          cidCount: pinnedCids.length,
        });
        // In mock mode unpinMultipleFromPinata is also mocked in tests,
        // so this call exercising the same code path is intentional.
        await unpinMultipleFromPinata(pinnedCids).catch(() => {
          // suppress — never mask the original error
        });
      }
      return failure("CREATE_ERROR", "Failed to prepare invoice creation", { cause: String(error) });
    }
  }

  async fundInvoice(
    tokenId: string,
    amount: number,
    investorAddress: string
  ): Promise<Result<string>> {
    try {
      await this.delay();
      return success(`mock_unsigned_xdr_fund_${tokenId}_${amount}_${investorAddress}`);
    } catch (error) {
      return failure("FUND_ERROR", "Failed to prepare invoice funding", { cause: String(error) });
    }
  }

  async repayInvoice(
    tokenId: string,
    ownerAddress: string,
    invoiceOwnerAddress?: string
  ): Promise<Result<string>> {
    try {
      if (
        invoiceOwnerAddress &&
        ownerAddress.toLowerCase() !== invoiceOwnerAddress.toLowerCase()
      ) {
        return failure("UNAUTHORIZED", "Caller is not the invoice owner");
      }
      await this.delay();
      return success(`mock_unsigned_xdr_repay_${tokenId}_${ownerAddress}`);
    } catch (error) {
      return failure("REPAY_ERROR", "Failed to prepare invoice repayment", { cause: String(error) });
    }
  }

  async claimPosition(positionId: string, investorAddress: string): Promise<Result<string>> {
    try {
      await this.delay();
      return success(`mock_unsigned_xdr_claim_${positionId}_${investorAddress}`);
    } catch (error) {
      return failure("CLAIM_ERROR", "Failed to prepare position claim", { cause: String(error) });
    }
  }

  async cancelInvoice(tokenId: string, ownerAddress: string, reason?: string): Promise<Result<string>> {
    try {
      await this.delay();
      return success(`mock_unsigned_xdr_cancel_${tokenId}_${ownerAddress}`);
    } catch (error) {
      return failure("CANCEL_ERROR", "Failed to prepare invoice cancellation", { cause: String(error) });
    }
  }

  async transferPosition(
    positionId: string,
    toAddress: string,
    sellerAddress: string
  ): Promise<Result<string>> {
    try {
      if (!isValidStellarAddress(toAddress)) {
        return failure("INVALID_INPUT", "Recipient address is not a valid Stellar G-address");
      }
      if (toAddress === sellerAddress) {
        return failure("INVALID_INPUT", "Cannot transfer a position to yourself");
      }
      await this.delay();
      return success(
        `mock_unsigned_xdr_transfer_${positionId}_${toAddress}_${sellerAddress}`
      );
    } catch (error) {
      return failure("TRANSFER_ERROR", "Failed to prepare position transfer", { cause: String(error) });
    }
  }

  async submitTransaction(signedXdr: string): Promise<Result<string>> {
    try {
      await this.delay();
      return success(
        Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
      );
    } catch (error) {
      return failure("SUBMIT_ERROR", "Failed to submit transaction", { cause: String(error) });
    }
  }
}

// ─── Live Invoice Service ─────────────────────────────────────────────────
class LiveInvoiceService implements IInvoiceService {
  async getInvoices(
    filters: MarketplaceFilters = {},
    sort: MarketplaceSort = { key: "apr", direction: "desc" },
    page = 1,
    pageSize = 12
  ): Promise<Result<PaginatedResponse<Invoice>>> {
    try {
      const response = await indexerClient.getInvoices(filters, sort, page, pageSize);
      return success(response);
    } catch (error) {
      if (error instanceof RpcNetworkError) {
        const message = error.message;
        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
          return failure("RATE_LIMITED", "Stellar Soroban RPC rate limit exceeded. Please try again in a few moments.");
        }
        if (lowerMessage.includes("timeout") || lowerMessage.includes("deadline")) {
          return failure("NETWORK_ERROR", "Connection timed out while syncing with Soroban RPC. Please check your network connection and try again.");
        }
        if (lowerMessage.includes("connection refused") || lowerMessage.includes("fetch failed")) {
          return failure("NETWORK_ERROR", "Unable to connect to the Stellar Soroban network. The RPC server might be temporarily down.");
        }

        return failure("NETWORK_ERROR", `Soroban RPC error: ${message}`, { cause: error.cause });
      }

      const message = error instanceof Error ? error.message : String(error);
      return failure("FETCH_ERROR", `Failed to fetch live invoices: ${message}`, { cause: message });
    }
  }

  async getInvoice(id: string, sourcePublicKey?: string): Promise<Result<Invoice | null>> {
    try {
      // Extract token ID from route id (supports both "inv_123" and "123" formats)
      const tokenIdStr = id.replace(/^inv_/, "");
      const tokenId = BigInt(tokenIdStr);

      // Require a source public key for RPC read simulations
      if (!sourcePublicKey) {
        return failure("INVALID_INPUT", "Wallet address required for on-chain reads");
      }

      // Fetch on-chain invoice state
      const { invoiceContract } = await import("@/lib/stellar/contracts");
      const onChain = await invoiceContract.getInvoice(tokenId, sourcePublicKey);

      // Fetch IPFS metadata in parallel with on-chain data
      const [ipfsResult] = await Promise.allSettled([
        this.getIpfsMetadata(onChain.ipfs_cid),
      ]);

      // Build invoice from on-chain data + IPFS metadata
      const invoice = mapOnChainToInvoiceLive(id, onChain, ipfsResult);
      return success(invoice);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Invoice not found") || message.includes("#1")) {
        return success(null);
      }
      return failure("FETCH_ERROR", "Failed to fetch invoice from chain", { cause: message });
    }
  }

  async getInvoicesByOwner(ownerAddress: string): Promise<Result<Invoice[]>> {
    try {
      const invoices = await indexerClient.getInvoicesByOwner(ownerAddress);
      return success(invoices);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure("FETCH_ERROR", `Failed to fetch live invoices by owner: ${message}`, { cause: message });
    }
  }

  async getPositions(investorAddress: string): Promise<Result<InvoicePosition[]>> {
    try {
      const positions = await marketplaceContract.getPositions(
        investorAddress,
        investorAddress
      );
      return success(positions);
    } catch (error) {
      return failure("FETCH_ERROR", "Failed to fetch live positions", {
        cause: String(error),
      });
    }
  }

  async getIpfsMetadata(cid: string): Promise<Result<Record<string, unknown>>> {
    return fetchAndSanitizeIpfsMetadata(cid);
  }

  async createInvoice(
    formData: CreateInvoiceFormData,
    ownerAddress: string,
    onProgress?: (progress: number) => void
  ): Promise<Result<{ unsignedXdr: string; metadataCid: string }>> {
    if (!formData.document) {
      return failure("INVALID_FORM", "Invoice document is required");
    }

    // Track every CID pinned during this pipeline so we can roll back if
    // the on-chain step fails.  Best-effort: we never let unpin failures
    // mask the original mint error.
    const pinnedCids: string[] = [];
    const requestId = crypto.randomUUID();

    try {
      // ── Stage 1: upload PDF document (0 → 15 %) ────────────────────────
      onProgress?.(5);
      const docCid = await uploadFileToPinata(
        formData.document,
        `invoice-${formData.invoiceNumber}.pdf`,
        ownerAddress,
        (p) => onProgress?.(Math.round(p * 0.15))
      );
      pinnedCids.push(docCid);

      onProgress?.(15);

      // ── Stage 2: build V1 metadata input ───────────────────────────────
      const metadataInput = formDataToMetadataV1Input(formData, ownerAddress, docCid);

      // ── Stage 3: upload SVG preview + optional thumbnail + metadata JSON
      //    (15 → 75 %)  via the validated V1 pipeline ─────────────────────
      const { metadataCid, imageCid, thumbnailCid } =
        await uploadValidatedInvoiceMetadata(
          metadataInput,
          ownerAddress,
          (p) => onProgress?.(15 + Math.round(p * 0.6))
        );

      pinnedCids.push(imageCid);
      if (thumbnailCid) pinnedCids.push(thumbnailCid);
      pinnedCids.push(metadataCid);

      onProgress?.(75);

      // ── Stage 4: build Soroban mint XDR (75 → 85 %) ───────────────────
      const dueTimestamp = BigInt(
        Math.floor(new Date(formData.dueDate).getTime() / 1000)
      );
      const financingAmount = BigInt(
        Math.round(formData.amount * (1 - formData.discountRate) * 1_000_000)
      );

      onProgress?.(80);

      const unsignedXdr = await invoiceContract.mintInvoice(
        {
          ipfsCid: metadataCid,
          amount: BigInt(Math.round(formData.amount * 1_000_000)),
          financingAmount,
          discountRate: Math.round(formData.discountRate * 10_000),
          dueDate: dueTimestamp,
        },
        ownerAddress
      );

      onProgress?.(100);

      // ── Mint succeeded — do NOT unpin anything ──────────────────────────
      return success({ unsignedXdr, metadataCid });
    } catch (error) {
      // ── Compensating unpin for all CIDs pinned before the failure ──────
      // Runs best-effort in the background; we await it so unpin attempts
      // complete before the caller receives the error, but failures here
      // never replace the original error.
      if (pinnedCids.length > 0) {
        try {
          await unpinMultipleFromPinata(pinnedCids);
        } catch (unpinError) {
          // unpinMultipleFromPinata itself never throws (Promise.allSettled),
          // but guard here anyway so we never mask the mint error.
          logger.warn("[createInvoice] compensating unpin threw unexpectedly", {
            requestId,
            cidCount: pinnedCids.length,
            error: unpinError instanceof Error ? unpinError.message : String(unpinError),
          });
        }

        logger.warn("[createInvoice] mint failed after IPFS pin; unpin attempted", {
          requestId,
          cidCount: pinnedCids.length,
        });
      }

      const err = mapContractError(error);
      return failure(err.code, err.message, err.details);
    }
  }

  async fundInvoice(
    tokenId: string,
    amount: number,
    investorAddress: string
  ): Promise<Result<string>> {
    try {
      const xdr = await marketplaceContract.fundInvoice(
        { tokenId: BigInt(tokenId), amount: BigInt(Math.round(amount * 1_000_000)) },
        investorAddress
      );
      return success(xdr);
    } catch (error) {
      const err = mapContractError(error);
      return failure(err.code, err.message, err.details);
    }
  }

  async repayInvoice(
    tokenId: string,
    ownerAddress: string,
    invoiceOwnerAddress?: string
  ): Promise<Result<string>> {
    try {
      if (
        invoiceOwnerAddress &&
        ownerAddress.toLowerCase() !== invoiceOwnerAddress.toLowerCase()
      ) {
        return failure("UNAUTHORIZED", "Caller is not the invoice owner");
      }

      const xdr = await marketplaceContract.repayInvoice(
        { tokenId: BigInt(tokenId) },
        ownerAddress
      );
      return success(xdr);
    } catch (error) {
      const err = mapContractError(error);
      return failure(err.code, err.message, err.details);
    }
  }

  async claimPosition(positionId: string, investorAddress: string): Promise<Result<string>> {
    try {
      const xdr = await marketplaceContract.claimYield(
        { tokenId: BigInt(positionId) },
        investorAddress
      );
      return success(xdr);
    } catch (error) {
      const err = mapContractError(error);
      return failure(err.code, err.message, err.details);
    }
  }

  /**
   * Note on Live Mode On-Chain Limitations:
   * Soroban contract `cancel_invoice` takes (token_id, owner).
   * The structured cancellation reason string is captured off-chain in audit logs
   * and local transaction history.
   */
  async cancelInvoice(tokenId: string, ownerAddress: string, reason?: string): Promise<Result<string>> {
    try {
      const xdr = await invoiceContract.cancelInvoice(
        BigInt(tokenId),
        ownerAddress
      );
      return success(xdr);
    } catch (error) {
      const err = mapContractError(error);
      return failure(err.code, err.message, err.details);
    }
  }

  async transferPosition(
    positionId: string,
    toAddress: string,
    sellerAddress: string
  ): Promise<Result<string>> {
    try {
      if (!isValidStellarAddress(toAddress)) {
        return failure("INVALID_INPUT", "Recipient address is not a valid Stellar G-address");
      }
      if (toAddress === sellerAddress) {
        return failure("INVALID_INPUT", "Cannot transfer a position to yourself");
      }

      const xdr = await marketplaceContract.transferPosition(
        { positionId: BigInt(positionId), toAddress },
        sellerAddress
      );
      return success(xdr);
    } catch (error) {
      const err = mapTransferError(error);
      return failure(err.code, err.message, err.details);
    }
  }

  async submitTransaction(signedXdr: string): Promise<Result<string>> {
    try {
      const result = await submitTransaction(signedXdr);
      if (result.status === "ERROR") {
        return failure("SUBMISSION_ERROR", "Transaction submission failed", { hash: result.hash });
      }
      const confirmed = await waitForTransaction(result.hash);
      if (confirmed.status !== "SUCCESS") {
        return failure("CONFIRMATION_ERROR", "Transaction failed on-chain", { hash: result.hash });
      }
      return success(result.hash);
    } catch (error) {
      if (error instanceof BadSequenceError) {
        throw error;
      }
      return failure("SUBMIT_ERROR", "Failed to submit transaction", { cause: String(error) });
    }
  }
}

// ─── Factory Function ─────────────────────────────────────────────────────
export function createInvoiceService(): IInvoiceService {
  if (env.NEXT_PUBLIC_ENABLE_MOCK_DATA) {
    return new MockInvoiceService();
  }
  return new LiveInvoiceService();
}

// ─── Backward Compatibility Functions (legacy API) ──────────────────────
const service = createInvoiceService();

export async function fetchInvoices(
  filters?: MarketplaceFilters,
  sort?: MarketplaceSort,
  page?: number,
  pageSize?: number
): Promise<PaginatedResponse<Invoice>> {
  const result = await service.getInvoices(filters, sort, page, pageSize);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function fetchInvoiceById(id: string, _sourcePublicKey?: string): Promise<Invoice | null> {
  const result = await service.getInvoice(id, _sourcePublicKey);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function fetchIpfsMetadata(cid: string): Promise<Record<string, unknown>> {
  const result = await service.getIpfsMetadata(cid);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * Fetch invoices similar to the given reference invoice.
 *
 * Works entirely offline against the cached/mock invoice list so it
 * degrades gracefully when the live indexer is sparse or unavailable.
 *
 * @param referenceId  ID of the invoice currently being viewed.
 * @param maxResults   Maximum candidates to return (default 6).
 */
export async function fetchSimilarInvoices(
  referenceId: string,
  maxResults = 6
): Promise<import("@/lib/comparison").SimilarInvoice[]> {
  const { getSimilarInvoices } = await import("@/lib/comparison");

  // Always resolve candidates from the mock list (or replace with live call).
  const candidates = USE_MOCK
    ? MOCK_INVOICES
    : (await fetchInvoices({}, { key: "apr", direction: "desc" }, 1, 100)).data;

  const reference = candidates.find((i) => i.id === referenceId);
  if (!reference) return [];

  return getSimilarInvoices(reference, candidates, maxResults);
}

export async function fetchInvoicesByOwner(ownerAddress: string): Promise<Invoice[]> {
  const result = await service.getInvoicesByOwner(ownerAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * Batch-fetch invoices by their on-chain token IDs.
 * In mock mode returns matching mock invoices without hitting RPC.
 * In live mode delegates to batchGetInvoices() — results are OnChainInvoice
 * (raw on-chain data); callers must map/enrich as needed.
 *
 * Batch size is capped at BATCH_SIZE_LIMIT (20) upstream by batchGetInvoices.
 */
export async function fetchInvoicesByTokenIds(
  tokenIds: string[],
  sourcePublicKey: string
): Promise<Invoice[]> {
  if (env.NEXT_PUBLIC_ENABLE_MOCK_DATA) {
    // No RPC calls in mock mode — just look up from static mock data
    const idSet = new Set(tokenIds);
    return MOCK_INVOICES.filter((i) => idSet.has(i.tokenId));
  }

  const { batchGetInvoices } = await import("@/lib/stellar/client");
  const results = await batchGetInvoices(tokenIds, sourcePublicKey);

  // Map on-chain structs back to Invoice shape (best-effort; non-critical fields
  // that don't exist on-chain retain their cached values from the store).
  return results
    .filter((r) => r.data !== null)
    .map((r) => {
      const onChain = r.data!;
      // We only have on-chain fields — return a partial that callers merge
      // into the existing store entry via mergeInvoicesBatch.
      return {
        tokenId: r.tokenId,
        ownerAddress: onChain.owner,
        ipfsCid: onChain.ipfs_cid,
        // funding.totalRaised reflects the live funded_amount from chain
        funding: {
          totalRaised: Number(onChain.funded_amount) / 1_000_000,
          targetAmount: Number(onChain.financing_amount) / 1_000_000,
          fundingProgress:
            Number(onChain.financing_amount) > 0
              ? Number(onChain.funded_amount) / Number(onChain.financing_amount)
              : 0,
          investorCount: 0, // not available on-chain; preserve cached value
          remainingCapacity:
            Math.max(
              0,
              (Number(onChain.financing_amount) - Number(onChain.funded_amount)) /
              1_000_000
            ),
        },
        status: ON_CHAIN_STATUS_MAP[onChain.status] ?? "listed",
      } as Partial<Invoice> & Pick<Invoice, "tokenId">;
    }) as Invoice[];
}

/** Maps Soroban contract status enum index → InvoiceStatus string. */
const ON_CHAIN_STATUS_MAP: Record<number, import("@/types").InvoiceStatus> = {
  0: "pending_mint",
  1: "listed",
  2: "partially_funded",
  3: "fully_funded",
  4: "active",
  5: "repaid",
  6: "defaulted",
  7: "cancelled",
};

/**
 * Map on-chain invoice data to the full Invoice shape, merging with IPFS metadata.
 * Falls back to safe defaults when IPFS metadata is missing or stale.
 */
function mapOnChainToInvoiceLive(
  id: string,
  onChain: import("@/types/contract").OnChainInvoice,
  ipfsResult: PromiseSettledResult<Result<Record<string, unknown>>>
): Invoice {
  const ipfsMetadata = ipfsResult.status === "fulfilled" && ipfsResult.value.ok
    ? ipfsResult.value.value
    : null;

  const dueDate = new Date(Number(onChain.due_date) * 1000).toISOString();
  const amount = Number(onChain.amount) / 1_000_000;
  const financingAmount = Number(onChain.financing_amount) / 1_000_000;
  const fundedAmount = Number(onChain.funded_amount) / 1_000_000;
  const discountRate = onChain.discount_rate / 10_000;
  const fundingProgress = financingAmount > 0 ? Math.min(fundedAmount / financingAmount, 1) : 0;

  // Extract metadata from IPFS, with safe fallbacks
  const metadata = {
    invoiceNumber: (ipfsMetadata?.invoiceNumber as string) || `INV-${onChain.token_id}`,
    issuerName: (ipfsMetadata?.issuerName as string) || "",
    issuerAddress: (ipfsMetadata?.issuerAddress as string) || onChain.owner,
    debtorName: (ipfsMetadata?.debtorName as string) || "",
    debtorAddress: (ipfsMetadata?.debtorAddress as string) || "",
    amount: (ipfsMetadata?.amount as number) || amount,
    currency: (ipfsMetadata?.currency as string) || "USDC",
    issueDate: (ipfsMetadata?.issueDate as string) || new Date().toISOString(),
    dueDate: (ipfsMetadata?.dueDate as string) || dueDate,
    description: (ipfsMetadata?.description as string) || "",
    jurisdiction: (ipfsMetadata?.jurisdiction as string) || "OTHER",
    category: (ipfsMetadata?.category as string) || "other",
    documentHash: (ipfsMetadata?.documentHash as string) || onChain.ipfs_cid,
    documentUrl: (ipfsMetadata?.documentUrl as string) || `${env.NEXT_PUBLIC_IPFS_GATEWAY}/${onChain.ipfs_cid}`,
    // NFT-standard preview image (Issue #438). Carried through so the
    // marketplace card can render a thumbnail via next/image; left undefined
    // for invoices minted before thumbnails existed, which fall back to the
    // generated placeholder.
    image: ipfsMetadata?.image as string | undefined,
  };

  // Determine status from on-chain enum
  const status = ON_CHAIN_STATUS_MAP[onChain.status] ?? "listed";

  // Calculate APR from discount rate and tenor (if available from IPFS)
  const tenorDays = ipfsMetadata?.tenor ? Number(ipfsMetadata.tenor) : 90;
  const apr = discountRate * (365 / tenorDays) * 100;

  return {
    id,
    tokenId: onChain.token_id.toString(),
    contractAddress: env.NEXT_PUBLIC_INVOICE_CONTRACT_ID ?? "",
    ipfsCid: onChain.ipfs_cid,
    metadata,
    terms: {
      discountRate,
      apr,
      financingAmount,
      minInvestment: 0,
      maxInvestment: financingAmount,
      tenor: tenorDays,
      repaymentDate: dueDate,
    },
    funding: {
      totalRaised: fundedAmount,
      targetAmount: financingAmount,
      fundingProgress,
      investorCount: 0,
      remainingCapacity: Math.max(0, financingAmount - fundedAmount),
    },
    riskTier: "A",
    riskScore: 0,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ownerAddress: onChain.owner,
  } as Invoice;
}

export async function fetchPositions(investorAddress: string) {
  const result = await service.getPositions(investorAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function prepareCreateInvoice(
  formData: CreateInvoiceFormData,
  ownerAddress: string,
  onProgress?: (progress: number) => void
): Promise<{ unsignedXdr: string; metadataCid: string }> {
  const result = await service.createInvoice(formData, ownerAddress, onProgress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function prepareFundInvoice(
  tokenId: string,
  amount: number,
  investorAddress: string
): Promise<string> {
  const result = await service.fundInvoice(tokenId, amount, investorAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function prepareRepayInvoice(
  tokenId: string,
  ownerAddress: string,
  invoiceOwnerAddress?: string
): Promise<string> {
  const result = await service.repayInvoice(tokenId, ownerAddress, invoiceOwnerAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function prepareClaimPosition(
  positionId: string,
  investorAddress: string
): Promise<string> {
  const result = await service.claimPosition(positionId, investorAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function prepareCancelInvoice(
  tokenId: string,
  ownerAddress: string
): Promise<string> {
  const result = await service.cancelInvoice(tokenId, ownerAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * Build an unsigned XDR to transfer an investor position to a new owner
 * (P2P secondary-market sale). Signed by the current position owner.
 *
 * See the `TransferPositionParams` doc comment in types/contract.ts for the
 * assumed single-call contract ABI.
 */
export async function prepareTransferPosition(
  positionId: string,
  toAddress: string,
  sellerAddress: string
): Promise<string> {
  const result = await service.transferPosition(positionId, toAddress, sellerAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * Buyer acceptance flow — STUB (#443).
 *
 * `transferPosition`/`prepareTransferPosition` above assume the deployed
 * `transfer_position` contract method is a single call authorized only by
 * the seller (no separate buyer co-signature), matching `claim_position`.
 * If that assumption doesn't hold once the deployed contract's ABI is
 * confirmed and a two-step propose/accept pattern is required instead, this
 * is the intended integration point for the buyer's acceptance transaction:
 * build the buyer-signed accept call here (e.g. `accept_position_transfer`
 * or similar) the same way `prepareTransferPosition` builds the seller's.
 *
 * Deliberately unimplemented until the contract ABI is confirmed — mirrors
 * the NOT_IMPLEMENTED pattern already used by `getInvoices`/
 * `getInvoicesByOwner` in LiveInvoiceService for the same reason.
 */
export async function prepareAcceptPositionTransfer(
  _positionId: string,
  _buyerAddress: string
): Promise<never> {
  throw new Error(
    "Buyer acceptance for transfer_position is not yet implemented — " +
      "pending confirmation of the deployed contract's transfer ABI. " +
      "See prepareAcceptPositionTransfer in services/invoiceService.ts."
  );
}

export async function submitAndConfirm(signedXdr: string): Promise<string> {
  const result = await service.submitTransaction(signedXdr);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function fetchInvestorPositions(
  investorAddress: string
): Promise<InvoicePosition[]> {
  const result = await service.getPositions(investorAddress);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * Fetch a batch of invoices by tokenIds.
 *
 * - Mock mode: resolves immediately from MOCK_INVOICES (no RPC).
 * - Live mode: fires concurrent get_invoice simulations, chunked at BATCH_SIZE.
 *   On-chain data (OnChainInvoice) is mapped back to the Invoice shape used
 *   by the UI. Fields not available on-chain are preserved from the cache when
 *   present, or filled with sensible defaults.
 *
 * @param tokenIds  String token IDs to fetch (BigInt-convertible).
 * @param sourcePublicKey  Used as the fee-source for read simulations.
 * @returns Invoice[] — only found invoices are included (missing IDs are dropped).
 */
export const BATCH_SIZE = 20;

export async function fetchBatchInvoicesByTokenIds(
  tokenIds: string[],
  sourcePublicKey: string
): Promise<Invoice[]> {
  if (tokenIds.length === 0) return [];

  const useMock = env.NEXT_PUBLIC_ENABLE_MOCK_DATA;
  if (useMock) {
    const idSet = new Set(tokenIds);
    return MOCK_INVOICES.filter((i) => idSet.has(i.tokenId));
  }

  const { batchGetInvoices } = await import("@/lib/stellar/client");
  const results = await batchGetInvoices(tokenIds, sourcePublicKey);

  return results
    .filter((r) => r.data !== null)
    .map((r) => {
      const onChain = r.data!;
      return mapOnChainToInvoice(r.tokenId, onChain);
    });
}

function mapOnChainToInvoice(tokenId: string, onChain: any): Invoice {
  const STATUS_MAP: Record<number, InvoiceStatus> = {
    0: "listed",
    1: "partially_funded",
    2: "fully_funded",
    3: "repaid",
    4: "defaulted",
    5: "cancelled",
  };

  const dueDate = new Date(Number(onChain.due_date) * 1000).toISOString();
  const amount = Number(onChain.amount) / 1_000_000;
  const financingAmount = Number(onChain.financing_amount) / 1_000_000;
  const fundedAmount = Number(onChain.funded_amount) / 1_000_000;
  const discountRate = onChain.discount_rate / 10_000;
  const fundingProgress = financingAmount > 0 ? Math.min(fundedAmount / financingAmount, 1) : 0;

  return {
    id: `inv_${tokenId}`,
    tokenId,
    contractAddress: env.NEXT_PUBLIC_INVOICE_CONTRACT_ID ?? "",
    ipfsCid: onChain.ipfs_cid,
    metadata: {
      invoiceNumber: `INV-${tokenId}`,
      issuerName: "",
      issuerAddress: onChain.owner,
      debtorName: "",
      debtorAddress: "",
      amount,
      currency: "USDC",
      issueDate: new Date().toISOString(),
      dueDate,
      description: "",
      jurisdiction: "OTHER",
      category: "other",
      documentHash: onChain.ipfs_cid,
      documentUrl: `${env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs"}/${onChain.ipfs_cid}`,
    },
    terms: {
      discountRate,
      apr: discountRate * (365 / 90) * 100, // approximate; real tenor unknown on-chain
      financingAmount,
      minInvestment: 0,
      maxInvestment: financingAmount,
      tenor: 90,
      repaymentDate: dueDate,
    },
    funding: {
      totalRaised: fundedAmount,
      targetAmount: financingAmount,
      fundingProgress,
      investorCount: 0,
      remainingCapacity: Math.max(0, financingAmount - fundedAmount),
    },
    riskTier: "A",
    riskScore: 0,
    status: STATUS_MAP[onChain.status] ?? "listed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ownerAddress: onChain.owner,
  } as any;
}

/**
 * Update the on-chain status of an invoice.
 * Validates the transition client-side before building the transaction.
 *
 * @param tokenId         On-chain token ID string.
 * @param from            Current InvoiceStatus (for client-side validation).
 * @param to              Target InvoiceStatus.
 * @param ownerAddress    Must match invoice.ownerAddress — enforced here AND on-chain.
 */
export async function prepareUpdateInvoiceStatus(
  tokenId: string,
  from: InvoiceStatus,
  to: InvoiceStatus,
  ownerAddress: string
): Promise<string> {
  const { isValidTransition, STATUS_TO_CHAIN_INDEX } = await import("@/lib/invoiceStateMachine");

  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }

  const chainIndex = STATUS_TO_CHAIN_INDEX[to];
  if (chainIndex < 0) throw new Error(`Status "${to}" has no on-chain representation`);

  const useMock = env.NEXT_PUBLIC_ENABLE_MOCK_DATA;
  if (useMock) {
    return `mock_unsigned_xdr_update_status_${tokenId}_${to}_${ownerAddress}`;
  }

  const { updateInvoiceStatus } = await import("@/lib/stellar/contracts");
  return updateInvoiceStatus(tokenId, chainIndex, ownerAddress);
}




// ─── Invoice Amendment (#568) ─────────────────────────────────────────────────

/**
 * Prepare an invoice metadata amendment.
 *
 * Validates that:
 *  1. The invoice is in an eligible status (listed / partially_funded).
 *  2. Only allowed fields (description, category) are included.
 *  3. The caller is the invoice owner (enforced client-side + on-chain).
 *
 * In mock mode, the amendment is applied in-memory and returned immediately.
 * In live mode the updated metadata is re-pinned to IPFS and the new CID is
 * recorded on-chain.
 *
 * @param invoiceId      App-level invoice ID.
 * @param status         Current invoice status (used for eligibility check).
 * @param ownerAddress   Must match invoice.ownerAddress.
 * @param amendment      Partial record of amendable fields.
 * @returns              The new IPFS CID for the amended metadata.
 */
export async function prepareAmendInvoiceMetadata(
  invoiceId: string,
  status: import("@/types").InvoiceStatus,
  ownerAddress: string,
  amendment: import("@/lib/invoiceStateMachine").InvoiceAmendment
): Promise<string> {
  const {
    canAmend,
    sanitizeAmendment,
  } = await import("@/lib/invoiceStateMachine");

  if (!canAmend(status)) {
    throw new Error(
      `Cannot amend invoice with status "${status}". Only listed or partially_funded invoices may be amended.`
    );
  }

  const safe = sanitizeAmendment(amendment as Record<string, unknown>);
  if (Object.keys(safe).length === 0) {
    throw new Error("No amendable fields provided. Allowed fields: description, category.");
  }

  // In mock mode: return a synthetic CID immediately (no IPFS call).
  if (env.NEXT_PUBLIC_ENABLE_MOCK_DATA) {
    return `mock_amended_metadata_cid_${invoiceId}_${Date.now()}`;
  }

  // Live mode: fetch current IPFS metadata, apply the amendment, re-pin.
  const currentResult = await service.getIpfsMetadata(invoiceId);
  if (!currentResult.ok) {
    throw new Error(`Could not fetch current metadata: ${currentResult.error.message}`);
  }
  const updated = { ...currentResult.value, ...safe };

  const newCid = await uploadInvoiceMetadata(
    updated as import("@/types").InvoiceMetadata,
    ownerAddress
  );

  return newCid;
}
