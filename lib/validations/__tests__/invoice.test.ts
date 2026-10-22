/**
 * Validation schema unit tests for lib/validations/invoice.ts
 *
 * Run with: npx tsx --test lib/validations/__tests__/invoice.test.ts
 * (requires tsx >= 4.x; no additional test runner needed)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  invoiceDetailsSchema,
  financingTermsSchema,
  uploadSchema,
  fundingAmountSchema,
  repaymentSchema,
  userProfileSchema,
} from "../invoice";
import { MAX_INVOICE_PDF_BYTES } from "../upload";
import { MAX_FILE_SIZE } from "@/lib/ipfs";

// ─── helpers ─────────────────────────────────────────────────────────────────

function ok<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, value: unknown): T {
  const result = schema.safeParse(value);
  assert.equal(result.success, true, `Expected success but got failure for: ${JSON.stringify(value)}`);
  return result.data as T;
}

function fail(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } }, value: unknown, expectedPath?: string) {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, `Expected failure but got success for: ${JSON.stringify(value)}`);
  if (expectedPath && result.error) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    assert.ok(paths.some((p) => p === expectedPath), `Expected error on '${expectedPath}', got: ${paths.join(", ")}`);
  }
}

// ─── invoiceDetailsSchema ────────────────────────────────────────────────────

describe("invoiceDetailsSchema", () => {
  const base = {
    invoiceNumber: "INV-001",
    debtorName: "Acme Corp",
    debtorAddress: "123 Main Street",
    amount: 5000,
    dueDate: "2026-12-01",
    jurisdiction: "US",
    category: "technology",
  };

  it("accepts a valid invoice details object", () => {
    ok(invoiceDetailsSchema, base);
  });

  it("rejects missing invoiceNumber", () => {
    fail(invoiceDetailsSchema, { ...base, invoiceNumber: "" }, "invoiceNumber");
  });

  it("rejects invoice number with special characters", () => {
    fail(invoiceDetailsSchema, { ...base, invoiceNumber: "INV #001" }, "invoiceNumber");
  });

  it("accepts alphanumeric and hyphenated invoice numbers", () => {
    ok(invoiceDetailsSchema, { ...base, invoiceNumber: "INV-2024-001" });
    ok(invoiceDetailsSchema, { ...base, invoiceNumber: "ABC123" });
  });

  it("rejects amount below minimum (100)", () => {
    fail(invoiceDetailsSchema, { ...base, amount: 99 }, "amount");
  });

  it("accepts boundary minimum amount of 100", () => {
    ok(invoiceDetailsSchema, { ...base, amount: 100 });
  });

  it("rejects debtorName shorter than 2 chars", () => {
    fail(invoiceDetailsSchema, { ...base, debtorName: "A" }, "debtorName");
  });

  it("rejects description over 200 chars", () => {
    fail(invoiceDetailsSchema, { ...base, description: "x".repeat(201) }, "description");
  });

  it("accepts description at exactly 200 chars", () => {
    ok(invoiceDetailsSchema, { ...base, description: "x".repeat(200) });
  });

  it("accepts undefined description", () => {
    ok(invoiceDetailsSchema, { ...base, description: undefined });
  });

  it("rejects invalid jurisdiction", () => {
    fail(invoiceDetailsSchema, { ...base, jurisdiction: "INVALID" }, "jurisdiction");
  });

  it("rejects invalid category", () => {
    fail(invoiceDetailsSchema, { ...base, category: "mining" }, "category");
  });
});

// ─── financingTermsSchema ─────────────────────────────────────────────────────

describe("financingTermsSchema", () => {
  const base = {
    amount: 50000,
    dueDate: "2026-12-01",
    discountRate: 5,
    minInvestment: 1000,
    listingExpiryDate: "2026-11-15",
  };

  it("accepts valid financing terms", () => {
    ok(financingTermsSchema, base);
  });

  it("rejects discountRate below 0.5", () => {
    fail(financingTermsSchema, { ...base, discountRate: 0.4 }, "discountRate");
  });

  it("accepts boundary discountRate of 0.5", () => {
    ok(financingTermsSchema, { ...base, discountRate: 0.5 });
  });

  it("rejects discountRate above 20", () => {
    fail(financingTermsSchema, { ...base, discountRate: 20.1 }, "discountRate");
  });

  it("accepts boundary discountRate of 20", () => {
    ok(financingTermsSchema, { ...base, discountRate: 20 });
  });

  it("cross-field: rejects minInvestment > amount", () => {
    fail(financingTermsSchema, { ...base, minInvestment: 60000 }, "minInvestment");
  });

  it("cross-field: accepts minInvestment === amount (boundary)", () => {
    ok(financingTermsSchema, { ...base, minInvestment: 50000 });
  });

  it("cross-field: rejects listingExpiryDate >= dueDate", () => {
    fail(financingTermsSchema, { ...base, listingExpiryDate: "2026-12-01" }, "listingExpiryDate");
  });

  it("cross-field: rejects listingExpiryDate after dueDate", () => {
    fail(financingTermsSchema, { ...base, listingExpiryDate: "2027-01-01" }, "listingExpiryDate");
  });

  it("cross-field: accepts listingExpiryDate one day before dueDate", () => {
    ok(financingTermsSchema, { ...base, listingExpiryDate: "2026-11-30" });
  });
});

// ─── uploadSchema ─────────────────────────────────────────────────────────────

describe("uploadSchema", () => {
  const makePdfFile = (sizeBytes: number) => ({
    name: "invoice.pdf",
    type: "application/pdf",
    size: sizeBytes,
  });

  it("accepts a valid PDF under 10MB", () => {
    ok(uploadSchema, { file: makePdfFile(5 * 1024 * 1024) });
  });

  it("accepts boundary size of exactly 10MB", () => {
    ok(uploadSchema, { file: makePdfFile(MAX_INVOICE_PDF_BYTES) });
  });

  it("rejects file over 10MB", () => {
    fail(uploadSchema, { file: makePdfFile(MAX_INVOICE_PDF_BYTES + 1) }, "file");
  });

  it("rejects non-PDF MIME type", () => {
    fail(uploadSchema, { file: { name: "doc.docx", type: "application/msword", size: 1000 } }, "file");
  });

  it("accepts file identified by .pdf extension when MIME is missing", () => {
    ok(uploadSchema, { file: { name: "invoice.pdf", size: 1000 } });
  });

  it("rejects null file", () => {
    fail(uploadSchema, { file: null }, "file");
  });

  it("rejects undefined file", () => {
    fail(uploadSchema, { file: undefined }, "file");
  });
});

// ─── fundingAmountSchema ──────────────────────────────────────────────────────

describe("fundingAmountSchema", () => {
  const base = {
    amount: 5000,
    minInvestment: 1000,
    remainingCapacity: 10000,
  };

  it("accepts a valid funding amount", () => {
    ok(fundingAmountSchema, base);
  });

  it("rejects amount below minInvestment", () => {
    fail(fundingAmountSchema, { ...base, amount: 999 }, "amount");
  });

  it("accepts amount exactly equal to minInvestment (boundary)", () => {
    ok(fundingAmountSchema, { ...base, amount: 1000 });
  });

  it("rejects amount exceeding remainingCapacity", () => {
    fail(fundingAmountSchema, { ...base, amount: 10001 }, "amount");
  });

  it("accepts amount exactly equal to remainingCapacity (boundary)", () => {
    ok(fundingAmountSchema, { ...base, amount: 10000 });
  });

  it("rejects zero amount", () => {
    fail(fundingAmountSchema, { ...base, amount: 0 }, "amount");
  });

  it("rejects negative amount", () => {
    fail(fundingAmountSchema, { ...base, amount: -100 }, "amount");
  });
});

// ─── repaymentSchema ──────────────────────────────────────────────────────────

describe("repaymentSchema", () => {
  it("accepts repayment matching outstanding balance", () => {
    ok(repaymentSchema, { amount: 5000, outstandingBalance: 5000 });
  });

  it("accepts repayment within float tolerance (< 0.01 delta)", () => {
    ok(repaymentSchema, { amount: 5000.005, outstandingBalance: 5000 });
  });

  it("rejects repayment amount differing by more than 0.01", () => {
    fail(repaymentSchema, { amount: 5000.02, outstandingBalance: 5000 }, "amount");
  });

  it("rejects underpayment", () => {
    fail(repaymentSchema, { amount: 4999, outstandingBalance: 5000 }, "amount");
  });

  it("rejects overpayment", () => {
    fail(repaymentSchema, { amount: 5001, outstandingBalance: 5000 }, "amount");
  });

  it("rejects zero amount", () => {
    fail(repaymentSchema, { amount: 0, outstandingBalance: 0 }, "amount");
  });
});

// ─── userProfileSchema ────────────────────────────────────────────────────────

describe("userProfileSchema", () => {
  const base = {
    name: "Alice Njeri",
    email: "alice@example.com",
    // Valid 56-char Stellar public key (G + 55 uppercase alphanumeric chars)
    walletAddress: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPGK6XGDNVVB7KDXKQZFKJ6N8MA",
  };

  it("accepts a valid user profile", () => {
    ok(userProfileSchema, base);
  });

  it("rejects name shorter than 2 chars", () => {
    fail(userProfileSchema, { ...base, name: "A" }, "name");
  });

  it("rejects invalid email", () => {
    fail(userProfileSchema, { ...base, email: "not-an-email" }, "email");
  });

  it("rejects invalid Stellar address (too short)", () => {
    fail(userProfileSchema, { ...base, walletAddress: "GBADKEY" }, "walletAddress");
  });

  it("rejects Stellar address not starting with G", () => {
    fail(userProfileSchema, { ...base, walletAddress: "ABZXN7PIRZGNMHGA7MUUUF4GWPY5AYPGK6XGDNVVB7KDXKQZFKJ6N8MA" }, "walletAddress");
  });

  it("accepts optional empty companyName", () => {
    ok(userProfileSchema, { ...base, companyName: "" });
  });

  it("accepts undefined companyName", () => {
    ok(userProfileSchema, { ...base, companyName: undefined });
  });

  it("rejects companyName of length 1", () => {
    fail(userProfileSchema, { ...base, companyName: "X" }, "companyName");
  });
});
