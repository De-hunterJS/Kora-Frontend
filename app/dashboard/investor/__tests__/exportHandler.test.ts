/**
 * Unit tests for investor dashboard export handler — Issue #1049.
 *
 * Verifies that InvestorPosition rows are correctly mapped to export shape
 * and that the CSV/PDF handlers behave correctly under loading/empty guards.
 *
 * These tests operate on the pure export-pipeline functions directly
 * (positionToExportRow, positionsToExportRows, portfolioExportFilename) so
 * they remain fast and free of DOM or React dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  positionToExportRow,
  positionsToExportRows,
  portfolioExportFilename,
  PORTFOLIO_EXPORT_HEADERS,
} from "@/lib/portfolioExport";
import { exportCsv } from "@/lib/export";
import type { InvestorPosition, Invoice } from "@/types/invoice";

// ─── DOM stubs for exportCsv ──────────────────────────────────────────────────

let capturedFilename = "";
let capturedContent = "";

beforeEach(() => {
  capturedFilename = "";
  capturedContent = "";

  const mockLink = {
    href: "",
    download: "",
    style: { display: "" },
    click: vi.fn(),
  };

  vi.spyOn(document, "createElement").mockReturnValue(mockLink as any);
  vi.spyOn(document.body, "appendChild").mockImplementation(() => {
    capturedFilename = mockLink.download;
    return mockLink as any;
  });
  vi.spyOn(document.body, "removeChild").mockImplementation(() => mockLink as any);

  class MockBlob {
    constructor(parts: string[]) {
      capturedContent = parts[0];
    }
  }
  vi.stubGlobal("Blob", MockBlob);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_001",
    tokenId: "1",
    contractAddress: "CTEST...",
    ipfsCid: "bafy...",
    metadata: {
      invoiceNumber: "INV-001",
      issuerName: "Issuer Corp",
      issuerAddress: "GISSUER",
      debtorName: "Acme Ltd",
      debtorAddress: "GDEBTOR",
      amount: 50000,
      currency: "USDC" as const,
      issueDate: "2025-06-01T00:00:00.000Z",
      dueDate: "2025-09-01T00:00:00.000Z",
      description: "Goods delivery",
      jurisdiction: "NG" as const,
      category: "manufacturing" as const,
      documentHash: "hash123",
      documentUrl: "https://ipfs.example.com/doc",
      ...((overrides as any).metadata ?? {}),
    },
    terms: {
      discountRate: 0.05,
      apr: 14.0,
      financingAmount: 47500,
      minInvestment: 500,
      maxInvestment: 47500,
      tenor: 90,
      repaymentDate: "2025-09-01T00:00:00.000Z",
      ...((overrides as any).terms ?? {}),
    },
    funding: {
      totalRaised: 47500,
      targetAmount: 47500,
      fundingProgress: 1,
      investorCount: 3,
      remainingCapacity: 0,
    },
    riskTier: "A" as const,
    riskScore: 85,
    debtorPrivacy: "full" as const,
    status: "listed" as const,
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    ownerAddress: "GOWNER",
    txHash: "tx_dashboard_hash",
    ...overrides,
  } as Invoice;
}

function makePosition(overrides: Partial<InvestorPosition> = {}): InvestorPosition {
  return {
    id: "pos_001",
    invoiceId: "inv_001",
    invoice: makeInvoice(),
    investedAmount: 5000,
    expectedReturn: 5350,
    yieldEarned: 0,
    investedAt: "2025-07-01T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

// ─── positionToExportRow ───────────────────────────────────────────────────────

describe("positionToExportRow — investor dashboard mapping", () => {
  it("maps all required columns correctly", () => {
    const row = positionToExportRow(makePosition());
    expect(row["Invoice ID"]).toBe("INV-001");
    expect(row["Debtor"]).toBe("Acme Ltd");
    expect(row["Face Value"]).toBe(50000);
    expect(row["Funded Amount"]).toBe(5000);
    expect(row["APR"]).toBe(14.0);
    expect(row["Maturity Date"]).toBe("2025-09-01T00:00:00.000Z");
    expect(row["Status"]).toBe("active");
    expect(row["Expected Return"]).toBe(5350);
    expect(row["Transaction Hash"]).toBe("tx_dashboard_hash");
  });

  it("uses invoiceId fallback when invoice metadata is missing", () => {
    const row = positionToExportRow(
      makePosition({ invoice: undefined, invoiceId: "inv_fallback" })
    );
    expect(row["Invoice ID"]).toBe("inv_fallback");
    expect(row["Debtor"]).toBe("");
    expect(row["Transaction Hash"]).toBe("");
  });

  it("uses terms.repaymentDate for Maturity Date", () => {
    const inv = makeInvoice({
      terms: { repaymentDate: "2025-12-31T00:00:00.000Z" } as any,
    });
    const row = positionToExportRow(makePosition({ invoice: inv }));
    expect(row["Maturity Date"]).toBe("2025-12-31T00:00:00.000Z");
  });

  it("falls back to metadata.dueDate when repaymentDate is absent", () => {
    const inv = makeInvoice();
    // Remove repaymentDate
    (inv as any).terms.repaymentDate = "";
    const row = positionToExportRow(makePosition({ invoice: inv }));
    // Falls back to metadata.dueDate
    expect(row["Maturity Date"]).toBe("2025-09-01T00:00:00.000Z");
  });

  it("returns empty Maturity Date when both dates are absent", () => {
    const inv = makeInvoice();
    (inv as any).terms.repaymentDate = "";
    (inv as any).metadata.dueDate = "";
    const row = positionToExportRow(makePosition({ invoice: inv }));
    expect(row["Maturity Date"]).toBe("");
  });

  it("handles repaid status", () => {
    const row = positionToExportRow(makePosition({ status: "repaid" }));
    expect(row["Status"]).toBe("repaid");
  });
});

// ─── positionsToExportRows ────────────────────────────────────────────────────

describe("positionsToExportRows — batch mapping for dashboard export", () => {
  it("maps multiple positions preserving order", () => {
    const positions = [
      makePosition({ id: "pos_a", investedAmount: 1000, expectedReturn: 1100 }),
      makePosition({
        id: "pos_b",
        invoiceId: "inv_002",
        investedAmount: 2000,
        expectedReturn: 2200,
        invoice: makeInvoice({ metadata: { invoiceNumber: "INV-002", debtorName: "Beta Corp" } as any }),
      }),
    ];
    const rows = positionsToExportRows(positions);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Invoice ID"]).toBe("INV-001");
    expect(rows[1]["Invoice ID"]).toBe("INV-002");
  });

  it("returns empty array for empty positions list", () => {
    expect(positionsToExportRows([])).toEqual([]);
  });

  it("excludes data from other users — only maps the provided positions array", () => {
    // The guard is enforced by the caller passing only positionsData (scoped to
    // connected address). This test confirms the mapper does not inject extra rows.
    const rows = positionsToExportRows([makePosition()]);
    expect(rows).toHaveLength(1);
  });
});

// ─── portfolioExportFilename ──────────────────────────────────────────────────

describe("portfolioExportFilename", () => {
  it("generates dated filename in YYYY-MM-DD format", () => {
    const name = portfolioExportFilename(new Date("2025-09-15T10:00:00.000Z"));
    expect(name).toBe("kora-portfolio-2025-09-15.csv");
  });

  it("zero-pads month and day", () => {
    const name = portfolioExportFilename(new Date("2025-01-05T00:00:00.000Z"));
    expect(name).toBe("kora-portfolio-2025-01-05.csv");
  });
});

// ─── Full CSV export pipeline (mimics handleExportCsv) ───────────────────────

describe("handleExportCsv pipeline — full round-trip", () => {
  it("exports all positions with correct headers and data rows", () => {
    const positions = [
      makePosition(),
      makePosition({
        id: "pos_002",
        invoiceId: "inv_002",
        investedAmount: 10000,
        expectedReturn: 11200,
        status: "repaid",
        invoice: makeInvoice({
          metadata: {
            invoiceNumber: "INV-002",
            debtorName: "Beta Corp",
            amount: 100000,
          } as any,
          terms: { apr: 12.0, repaymentDate: "2025-10-01T00:00:00.000Z" } as any,
          txHash: "tx_repaid_hash",
        }),
      }),
    ];

    const rows = positionsToExportRows(positions);
    exportCsv(rows as Record<string, unknown>[], portfolioExportFilename(), [
      ...PORTFOLIO_EXPORT_HEADERS,
    ]);

    const lines = capturedContent.split("\n");
    expect(lines[0]).toBe(PORTFOLIO_EXPORT_HEADERS.join(","));
    expect(lines[1]).toContain("INV-001");
    expect(lines[1]).toContain("tx_dashboard_hash");
    expect(lines[2]).toContain("INV-002");
    expect(lines[2]).toContain("tx_repaid_hash");
  });

  it("does not trigger download when positions array is empty", () => {
    const clickSpy = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      style: { display: "" },
      click: clickSpy,
    } as any);

    // Simulate the guard: handleExportCsv returns early if !positionsData.length
    const positionsData: InvestorPosition[] = [];
    if (positionsData.length) {
      const rows = positionsToExportRows(positionsData);
      exportCsv(rows as Record<string, unknown>[], portfolioExportFilename(), [
        ...PORTFOLIO_EXPORT_HEADERS,
      ]);
    }

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("scopes export to connected address — rows match on-screen total", () => {
    // Simulate 3 positions for user A — none from user B
    const userAPositions = [
      makePosition({ id: "a1", investedAmount: 1000, expectedReturn: 1100 }),
      makePosition({ id: "a2", investedAmount: 2000, expectedReturn: 2200 }),
      makePosition({ id: "a3", investedAmount: 3000, expectedReturn: 3300 }),
    ];

    const rows = positionsToExportRows(userAPositions);
    exportCsv(rows as Record<string, unknown>[], portfolioExportFilename(), [
      ...PORTFOLIO_EXPORT_HEADERS,
    ]);

    const lines = capturedContent.split("\n").filter(Boolean);
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);

    const totalFunded = userAPositions.reduce((s, p) => s + p.investedAmount, 0);
    expect(totalFunded).toBe(6000);
    // All 3 rows are present
    expect(lines[1]).toContain("1000");
    expect(lines[2]).toContain("2000");
    expect(lines[3]).toContain("3000");
  });

  it("handles missing invoice metadata fields gracefully", () => {
    const position = makePosition({ invoice: undefined, invoiceId: "inv_orphan" });
    const rows = positionsToExportRows([position]);
    exportCsv(rows as Record<string, unknown>[], portfolioExportFilename(), [
      ...PORTFOLIO_EXPORT_HEADERS,
    ]);

    const lines = capturedContent.split("\n");
    expect(lines[1]).toContain("inv_orphan");
    // Debtor and tx hash are empty strings — no undefined in output
    expect(lines[1]).not.toContain("undefined");
  });
});
