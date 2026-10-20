/**
 * Unit tests for SellerAnalyticsDashboard row mapping and export helpers.
 */
import { describe, it, expect } from "vitest";
import {
  metricsToExportRow,
  sellerListingsExportFilename,
  type SellerListingMetrics,
} from "../SellerAnalyticsDashboard";

describe("metricsToExportRow", () => {
  it("converts seller listing metrics to export row with correct column order", () => {
    const metrics: SellerListingMetrics = {
      positionId: "pos_123",
      invoiceNumber: "INV-2024-001",
      debtorName: "Acme Corp",
      currency: "USDC",
      askPrice: 9500.0,
      expectedReturn: 10000.0,
      impliedDiscount: 0.05,
      listedAt: "2024-01-15T10:30:00Z",
      daysOnMarket: 7,
      positionActive: true,
    };

    const row = metricsToExportRow(metrics);

    expect(row).toEqual({
      "Position ID": "pos_123",
      "Invoice #": "INV-2024-001",
      "Debtor": "Acme Corp",
      "Ask Price": "9500.00",
      "Expected Return": "10000.00",
      "Implied Discount (%)": "5.00",
      "Days on Market": 7,
      "Listed At": "2024-01-15T10:30:00Z",
    });
  });

  it("handles zero discount correctly", () => {
    const metrics: SellerListingMetrics = {
      positionId: "pos_456",
      invoiceNumber: "INV-2024-002",
      debtorName: "Beta Ltd",
      currency: "USDC",
      askPrice: 5000.0,
      expectedReturn: 5000.0,
      impliedDiscount: 0.0,
      listedAt: "2024-02-01T14:00:00Z",
      daysOnMarket: 14,
      positionActive: false,
    };

    const row = metricsToExportRow(metrics);

    expect(row["Implied Discount (%)"]).toBe("0.00");
  });

  it("handles negative discount (premium pricing)", () => {
    const metrics: SellerListingMetrics = {
      positionId: "pos_789",
      invoiceNumber: "INV-2024-003",
      debtorName: "Gamma Inc",
      currency: "USDC",
      askPrice: 10500.0,
      expectedReturn: 10000.0,
      impliedDiscount: -0.05,
      listedAt: "2024-03-01T09:15:00Z",
      daysOnMarket: 3,
      positionActive: true,
    };

    const row = metricsToExportRow(metrics);

    expect(row["Implied Discount (%)"]).toBe("-5.00");
  });

  it("formats decimal values to two decimal places", () => {
    const metrics: SellerListingMetrics = {
      positionId: "pos_decimal",
      invoiceNumber: "INV-DECIMAL",
      debtorName: "Decimal Co",
      currency: "USDC",
      askPrice: 1234.567,
      expectedReturn: 1299.999,
      impliedDiscount: 0.053,
      listedAt: "2024-04-01T12:00:00Z",
      daysOnMarket: 21,
      positionActive: true,
    };

    const row = metricsToExportRow(metrics);

    expect(row["Ask Price"]).toBe("1234.57");
    expect(row["Expected Return"]).toBe("1300.00");
    expect(row["Implied Discount (%)"]).toBe("5.30");
  });

  it("preserves special characters in debtor name without manual escaping", () => {
    const metrics: SellerListingMetrics = {
      positionId: "pos_special",
      invoiceNumber: "INV-SPECIAL",
      debtorName: 'Corp "A", Ltd.',
      currency: "USDC",
      askPrice: 5000.0,
      expectedReturn: 5250.0,
      impliedDiscount: 0.05,
      listedAt: "2024-05-01T08:00:00Z",
      daysOnMarket: 5,
      positionActive: true,
    };

    const row = metricsToExportRow(metrics);

    // exportCsv handles quoting/escaping internally
    expect(row["Debtor"]).toBe('Corp "A", Ltd.');
  });
});

describe("sellerListingsExportFilename", () => {
  it("generates filename with current date by default", () => {
    const filename = sellerListingsExportFilename();
    expect(filename).toMatch(/^kora-seller-listings-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("generates filename with specific date", () => {
    const date = new Date(Date.UTC(2024, 5, 15)); // June 15, 2024
    const filename = sellerListingsExportFilename(date);
    expect(filename).toBe("kora-seller-listings-2024-06-15.csv");
  });

  it("pads month and day with leading zeros", () => {
    const date = new Date(Date.UTC(2024, 0, 5)); // January 5, 2024
    const filename = sellerListingsExportFilename(date);
    expect(filename).toBe("kora-seller-listings-2024-01-05.csv");
  });

  it("maintains prefix for user automation scripts", () => {
    const filename = sellerListingsExportFilename();
    expect(filename).toContain("kora-seller-listings-");
  });
});
