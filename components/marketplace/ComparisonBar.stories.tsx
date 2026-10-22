/**
 * Storybook stories for ComparisonBar.
 *
 * ComparisonBar renders only when:
 *  1. The "comparison" feature flag is enabled.
 *  2. comparisonList in useInvoiceStore is non-empty.
 *
 * Each story seeds the Zustand store via a decorator so the component sees
 * its data without needing a wrapping provider.
 *
 * Covered states:
 *  - 0 invoices selected   → bar is hidden (null return)
 *  - 1 invoice selected    → bar visible, Compare button disabled
 *  - 3 invoices selected   → bar fully interactive, chips + CTA active
 *  - Loading chip          → ID in list but not yet in invoice index
 */

import type { Meta, StoryObj } from "@storybook/react";
import React, { useEffect } from "react";
import { ComparisonBar } from "./ComparisonBar";
import { useInvoiceStore } from "@/store/invoiceStore";
import { setFeatureFlagOverride, resetFeatureFlagOverrides } from "@/lib/featureFlags";
import type { Invoice } from "@/types/invoice";

// ── Fixture invoices ───────────────────────────────────────────────────────

function makeInvoice(id: string, debtorName: string, apr: number): Invoice {
  return {
    id,
    tokenId: id,
    contractAddress: "CTEST000000000000000000000000000000000000000000000",
    ipfsCid: `Qm${id}`,
    status: "listed",
    riskTier: "A",
    riskScore: 72,
    debtorPrivacy: "full",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    ownerAddress: "GSME0000000000000000000000000000000000000000000000000",
    metadata: {
      invoiceNumber: `INV-${id}`,
      issuerName: "Kora SME Ltd",
      issuerAddress: "GSME0000000000000000000000000000000000000000000000000",
      debtorName,
      debtorAddress: "123 Trade St, Nairobi",
      amount: 50000,
      currency: "USDC",
      issueDate: "2025-01-01",
      dueDate: "2025-06-01",
      description: "Technology services invoice",
      jurisdiction: "KE",
      category: "technology",
      documentHash: `Qmdoc${id}`,
      documentUrl: `https://ipfs.io/ipfs/Qmdoc${id}`,
    },
    terms: {
      discountRate: 0.05,
      apr,
      financingAmount: 47500,
      minInvestment: 1000,
      maxInvestment: 47500,
      tenor: 90,
      repaymentDate: "2025-06-01",
    },
    funding: {
      totalRaised: 20000,
      targetAmount: 47500,
      fundingProgress: 0.42,
      investorCount: 3,
      remainingCapacity: 27500,
    },
  } as Invoice;
}

const INV_A = makeInvoice("inv-001", "Acme Corporation Ltd", 22.4);
const INV_B = makeInvoice("inv-002", "BuildCo Kenya", 18.1);
const INV_C = makeInvoice("inv-003", "LogiTrack Nigeria", 31.6);

// ── Provider decorator ─────────────────────────────────────────────────────

function withComparisonState(
  ids: string[],
  invoices: Invoice[] = []
) {
  return function Decorator(Story: React.ComponentType) {
    useEffect(() => {
      setFeatureFlagOverride("comparison", true);
      useInvoiceStore.setState({
        comparisonList: ids,
        invoices,
        invoicesByTokenId: Object.fromEntries(invoices.map((inv) => [inv.tokenId, inv])),
      } as any);
      return () => {
        resetFeatureFlagOverrides();
        useInvoiceStore.setState({ comparisonList: [], invoices: [], invoicesByTokenId: {} } as any);
      };
    }, []);
    // Wrap in a div that provides bottom spacing so the fixed bar is visible
    return (
      <div style={{ minHeight: 200, paddingBottom: 80 }}>
        <Story />
      </div>
    );
  };
}

// ── Meta ───────────────────────────────────────────────────────────────────

const meta: Meta<typeof ComparisonBar> = {
  title: "Marketplace/ComparisonBar",
  component: ComparisonBar,
  parameters: {
    layout: "fullscreen",
    chromatic: { pauseAnimationAtEnd: true },
  },
};

export default meta;
type Story = StoryObj<typeof ComparisonBar>;

// ── Stories ────────────────────────────────────────────────────────────────

/**
 * No invoices selected — bar should not render (returns null).
 * Useful as a baseline screenshot confirming nothing bleeds into the layout.
 */
export const Empty: Story = {
  decorators: [withComparisonState([], [])],
};

/**
 * One invoice selected — bar visible but Compare CTA is disabled
 * (requires at least 2 invoices).
 */
export const OneSelected: Story = {
  decorators: [withComparisonState([INV_A.id], [INV_A])],
};

/**
 * Three invoices selected — fully interactive state.
 * Compare button is active, all three chips show debtor name + APR.
 */
export const ThreeSelected: Story = {
  decorators: [withComparisonState(
    [INV_A.id, INV_B.id, INV_C.id],
    [INV_A, INV_B, INV_C]
  )],
};

/**
 * ID in comparison list but invoice data not yet loaded —
 * shows a loading chip instead of the debtor chip.
 */
export const LoadingChip: Story = {
  decorators: [withComparisonState(
    [INV_A.id, "unresolved-id-xyz"],
    [INV_A]  // second ID not in store yet
  )],
};
