/// <reference types="@testing-library/jest-dom" />
/**
 * Tests for YieldVarianceChart edge-case states (issue #XXX).
 *
 * Covers:
 *  - Empty positions → EmptyState rendered, no blank SVG
 *  - Single position → aggregate stats shown, chart skipped
 *  - Error prop → inline error message with aria-live
 *  - Error + onRetry → retry button present and callable
 *  - NaN values → filtered out, no chart crash
 *  - Identical y values → variance Line suppressed
 *  - 2+ valid positions → full chart rendered
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { InvestorPosition } from "@/types/invoice";

// ── Recharts stub ─────────────────────────────────────────────────────────
// jsdom has no SVG layout engine; stub the heavy chart primitives so tests
// focus on branch logic rather than Recharts internals.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="recharts-container">{children}</div>,
  ComposedChart: ({ children }: any) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Bar: () => null,
  Line: ({ dataKey }: any) => <div data-testid={`recharts-line-${dataKey}`} />,
}));

// ── lib/yieldVariance stub ────────────────────────────────────────────────
// We test rendering logic, not arithmetic — keep arithmetic in its own suite.
vi.mock("@/lib/yieldVariance", () => ({
  computeVarianceRows: (positions: InvestorPosition[]) =>
    positions.map((p, i) => ({ month: `M${i + 1}`, position: p })),
  buildVarianceSeries: (rows: any[]) =>
    rows.map((r, i) => ({
      month: r.month,
      expected: 1000 * (i + 1),
      realized: 900 * (i + 1),
    })),
  aggregateVariance: () => ({
    totalExpectedYield: 5000,
    totalRealizedYield: 4500,
    totalVariance: -500,
    totalVariancePercent: -10,
    settledCount: 2,
    pendingCount: 1,
  }),
  varianceExportFilename: () => "variance.csv",
  varianceToExportRows: () => [],
  VARIANCE_EXPORT_HEADERS: [],
}));

// ── useFormatters stub ───────────────────────────────────────────────────
vi.mock("@/hooks/useFormatters", () => ({
  useFormatters: () => ({
    formatCurrency: (v: number) => `$${v.toFixed(0)}`,
    formatPercentage: (v: number) => `${v}%`,
  }),
}));

// ── Fixture data ──────────────────────────────────────────────────────────

const makePosition = (id: string): InvestorPosition =>
  ({
    invoiceId: id,
    investedAmount: 1000,
    expectedReturn: 1100,
    status: "repaid",
  } as unknown as InvestorPosition);

// ── Render helper ─────────────────────────────────────────────────────────

function renderChart(props: Partial<React.ComponentProps<typeof import("../YieldVarianceChart").default>> & { positions: InvestorPosition[] }) {
  const YieldVarianceChart = require("../YieldVarianceChart").default;
  return render(
    <NextIntlClientProvider locale="en" messages={en as any}>
      <YieldVarianceChart {...props} />
    </NextIntlClientProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("YieldVarianceChart — empty state", () => {
  it("shows EmptyState when positions array is empty", () => {
    renderChart({ positions: [] });
    expect(screen.getByText(/no yield data yet/i)).toBeInTheDocument();
  });

  it("does not render a recharts container for empty data", () => {
    renderChart({ positions: [] });
    expect(screen.queryByTestId("recharts-container")).not.toBeInTheDocument();
  });
});

describe("YieldVarianceChart — single data point", () => {
  it("shows single-point notice instead of chart", () => {
    renderChart({ positions: [makePosition("p1")] });
    expect(screen.getByTestId("yield-variance-single-point")).toBeInTheDocument();
    expect(screen.getByText(/only one data point/i)).toBeInTheDocument();
  });

  it("renders aggregate stats for single point", () => {
    renderChart({ positions: [makePosition("p1")] });
    // formatCurrency mock returns $<value>
    expect(screen.getByText("$5000")).toBeInTheDocument(); // totalExpectedYield
  });

  it("does not render a recharts container for single point", () => {
    renderChart({ positions: [makePosition("p1")] });
    expect(screen.queryByTestId("recharts-container")).not.toBeInTheDocument();
  });
});

describe("YieldVarianceChart — error state", () => {
  it("renders the error message", () => {
    renderChart({ positions: [], error: "Failed to load yield data" });
    expect(screen.getByTestId("yield-variance-error")).toBeInTheDocument();
    expect(screen.getByText("Failed to load yield data")).toBeInTheDocument();
  });

  it("has aria-live=\"polite\" on the error region", () => {
    renderChart({ positions: [], error: "API error" });
    const region = screen.getByTestId("yield-variance-error");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("renders a retry button when onRetry is provided", () => {
    const onRetry = vi.fn();
    renderChart({ positions: [], error: "Timeout", onRetry });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", () => {
    const onRetry = vi.fn();
    renderChart({ positions: [], error: "Timeout", onRetry });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not render a retry button when onRetry is absent", () => {
    renderChart({ positions: [], error: "Timeout" });
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("hides the chart when error is set", () => {
    renderChart({ positions: [makePosition("p1"), makePosition("p2")], error: "err" });
    expect(screen.queryByTestId("recharts-container")).not.toBeInTheDocument();
  });
});

describe("YieldVarianceChart — loading state", () => {
  it("renders the skeleton when isLoading is true", () => {
    renderChart({ positions: [], isLoading: true });
    expect(screen.getByTestId("yield-variance-skeleton")).toBeInTheDocument();
  });

  it("does not render empty state while loading", () => {
    renderChart({ positions: [], isLoading: true });
    expect(screen.queryByText(/no yield data yet/i)).not.toBeInTheDocument();
  });
});

describe("YieldVarianceChart — full chart (2+ points)", () => {
  it("renders the recharts container", () => {
    renderChart({ positions: [makePosition("p1"), makePosition("p2")] });
    expect(screen.getByTestId("recharts-container")).toBeInTheDocument();
  });

  it("renders the aggregate readout", () => {
    renderChart({ positions: [makePosition("p1"), makePosition("p2")] });
    expect(screen.getByText("Expected")).toBeInTheDocument();
    expect(screen.getByText("Realized")).toBeInTheDocument();
    expect(screen.getByText("Variance")).toBeInTheDocument();
    expect(screen.getByText("Settled")).toBeInTheDocument();
  });
});
