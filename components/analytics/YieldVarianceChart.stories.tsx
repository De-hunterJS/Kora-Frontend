/**
 * Storybook stories for YieldVarianceChart.
 *
 * Covers all meaningful visual states:
 *  - Full data set (2+ months)
 *  - Single data point — aggregate stat only, no variance line
 *  - Empty — EmptyState component
 *  - Loading skeleton
 *  - Error with retry button
 *  - Compact layout for dashboard widgets
 *
 * Chart stories use a fixed height wrapper so Chromatic captures a
 * deterministic screenshot regardless of the surrounding layout.
 */

import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import YieldVarianceChart from "./YieldVarianceChart";
import type { InvestorPosition } from "@/types/invoice";

// ── Fixture data ───────────────────────────────────────────────────────────

function makePosition(
  id: string,
  investedAmount: number,
  expectedReturn: number,
  status: "active" | "repaid" = "repaid",
  createdAt = "2025-01-15"
): InvestorPosition {
  return {
    invoiceId: id,
    investedAmount,
    expectedReturn,
    yieldEarned: expectedReturn - investedAmount,
    status,
    invoice: {
      id,
      invoiceNumber: `INV-${id}`,
      amount: investedAmount * 1.1,
      currency: "USDC",
      dueDate: "2025-12-01",
      createdAt,
      status: "repaid",
    },
  } as unknown as InvestorPosition;
}

const MULTI_POSITIONS: InvestorPosition[] = [
  makePosition("001", 10000, 10500, "repaid", "2025-01-10"),
  makePosition("002", 15000, 15900, "repaid", "2025-02-14"),
  makePosition("003", 8000,  8320, "repaid", "2025-03-05"),
  makePosition("004", 20000, 21200, "repaid", "2025-04-20"),
  makePosition("005", 12000, 12840, "active", "2025-05-01"),
  makePosition("006", 18000, 19260, "active", "2025-06-15"),
];

// ── Meta ───────────────────────────────────────────────────────────────────

const meta: Meta<typeof YieldVarianceChart> = {
  title: "Analytics/YieldVarianceChart",
  component: YieldVarianceChart,
  parameters: {
    layout: "padded",
    chromatic: { pauseAnimationAtEnd: true },
  },
  args: {
    positions: MULTI_POSITIONS,
    isLoading: false,
    compact: false,
  },
};

export default meta;
type Story = StoryObj<typeof YieldVarianceChart>;

// ── Stories ────────────────────────────────────────────────────────────────

/** Full 6-month series — bars + realized variance line. */
export const WithData: Story = {};

/** Compact layout used in dashboard widgets — reduced chart height. */
export const Compact: Story = {
  args: { compact: true },
};

/** Loading skeleton — chart not yet available. */
export const Loading: Story = {
  args: { isLoading: true },
};

/** No positions — shows EmptyState, never a blank SVG. */
export const Empty: Story = {
  args: { positions: [] },
};

/**
 * Single data point — a variance line across one month is misleading.
 * The component falls back to aggregate stats only.
 */
export const SinglePoint: Story = {
  args: {
    positions: [makePosition("solo", 5000, 5250, "repaid", "2025-03-01")],
  },
};

/**
 * Error state — API failed or network error.
 * Shows error message with a "Retry" button.
 */
export const ErrorWithRetry: Story = {
  args: {
    positions: [],
    error: "Failed to load yield data. Check your connection and try again.",
    onRetry: () => console.log("retry clicked"),
  },
};

/** Error without a retry handler — message only, no button. */
export const ErrorNoRetry: Story = {
  args: {
    positions: [],
    error: "Yield data is temporarily unavailable.",
  },
};

/** Export button visible — onExport wired. */
export const WithExport: Story = {
  args: {
    onExport: (rows, filename, headers) =>
      console.log("export", { rows: rows.length, filename, headers }),
  },
};
