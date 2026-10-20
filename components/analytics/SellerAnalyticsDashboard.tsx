"use client";

import React, { useMemo, useCallback } from "react";
import { Download, Tag, Clock, TrendingDown, BarChart2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import EmptyState from "@/components/ui/EmptyState";
import { formatCurrency, cn } from "@/lib/utils";
import { exportCsv } from "@/lib/export";
import type { PositionListingMeta } from "@/store/positionListingStore";
import type { InvestorPosition } from "@/types/invoice";

export interface SellerListingMetrics {
  positionId: string;
  invoiceNumber: string;
  debtorName: string;
  currency: string;
  askPrice: number;
  expectedReturn: number;
  impliedDiscount: number;
  listedAt: string;
  /** Days the listing has been on market. */
  daysOnMarket: number;
  /** Whether the position is still active (not repaid/defaulted). */
  positionActive: boolean;
}

interface SellerAnalyticsDashboardProps {
  /** All listings belonging to the current investor. */
  listings: PositionListingMeta[];
  /** The investor's full position data (to join with listing metadata). */
  positions: InvestorPosition[];
  className?: string;
}

const SELLER_EXPORT_HEADERS = [
  "Position ID",
  "Invoice #",
  "Debtor",
  "Ask Price",
  "Expected Return",
  "Implied Discount (%)",
  "Days on Market",
  "Listed At",
] as const;

type SellerExportRow = Record<(typeof SELLER_EXPORT_HEADERS)[number], string | number>;

/**
 * Convert seller listing metrics into plain export row objects consumed by exportCsv.
 * Maintains original column order for compatibility with user automation scripts.
 */
export function metricsToExportRow(m: SellerListingMetrics): SellerExportRow {
  return {
    "Position ID": m.positionId,
    "Invoice #": m.invoiceNumber,
    "Debtor": m.debtorName,
    "Ask Price": m.askPrice.toFixed(2),
    "Expected Return": m.expectedReturn.toFixed(2),
    "Implied Discount (%)": (m.impliedDiscount * 100).toFixed(2),
    "Days on Market": m.daysOnMarket,
    "Listed At": m.listedAt,
  };
}

/** Build a dated seller listings CSV filename: `kora-seller-listings-YYYY-MM-DD.csv`. */
export function sellerListingsExportFilename(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `kora-seller-listings-${yyyy}-${mm}-${dd}.csv`;
}

/**
 * Seller Analytics Dashboard (#593).
 *
 * Shows per-listing time-on-market, realised discount stats, and a summary
 * of aggregate metrics.  Includes an optional CSV export.
 */
export function SellerAnalyticsDashboard({
  listings,
  positions,
  className,
}: SellerAnalyticsDashboardProps) {
  const t = useTranslations("analytics");
  const metrics: SellerListingMetrics[] = useMemo(() => {
    const now = Date.now();
    return listings.map((listing) => {
      const position = positions.find(
        (p) => p.id === listing.positionId || p.invoiceId === listing.positionId
      );
      const invoiceNumber = position?.invoice?.metadata.invoiceNumber ?? listing.positionId;
      const debtorName = position?.invoice?.metadata.debtorName ?? "Unknown";
      const currency = position?.invoice?.metadata.currency ?? "USDC";
      const expectedReturn = position?.expectedReturn ?? listing.askPrice / (1 - listing.impliedDiscount);
      const daysOnMarket = Math.max(
        0,
        Math.floor((now - new Date(listing.listedAt).getTime()) / (1000 * 60 * 60 * 24))
      );
      const positionActive = position?.status === "active";

      return {
        positionId: listing.positionId,
        invoiceNumber,
        debtorName,
        currency,
        askPrice: listing.askPrice,
        expectedReturn,
        impliedDiscount: listing.impliedDiscount,
        listedAt: listing.listedAt,
        daysOnMarket,
        positionActive,
      };
    });
  }, [listings, positions]);

  const avgDaysOnMarket = useMemo(() => {
    if (metrics.length === 0) return 0;
    return metrics.reduce((sum, m) => sum + m.daysOnMarket, 0) / metrics.length;
  }, [metrics]);

  const avgImpliedDiscount = useMemo(() => {
    if (metrics.length === 0) return 0;
    return metrics.reduce((sum, m) => sum + m.impliedDiscount, 0) / metrics.length;
  }, [metrics]);

  const totalAskVolume = useMemo(
    () => metrics.reduce((sum, m) => sum + m.askPrice, 0),
    [metrics]
  );

  const handleExport = useCallback(() => {
    const rows = metrics.map(metricsToExportRow);
    const filename = sellerListingsExportFilename();
    exportCsv(rows, filename, Array.from(SELLER_EXPORT_HEADERS));
  }, [metrics]);

  if (listings.length === 0) {
    return (
      <Card className={cn("border-zinc-800 bg-zinc-900/60", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Tag className="h-4 w-4 text-primary" aria-hidden />
            Seller Listing Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No active listings"
            description="List a position for sale on the secondary market to see analytics here."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BarChart2 className="h-4 w-4 text-primary" aria-hidden />
          Seller Listing Analytics
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          className="gap-1.5 text-xs"
          aria-label={t("a11y.exportSellerMetrics")}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export CSV
        </Button>
      </div>

      {/* Summary stat cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Active Listings"
          value={String(metrics.length)}
          icon={<Tag className="h-4 w-4" />}
        />
        <StatCard
          label="Avg. Days on Market"
          value={`${avgDaysOnMarket.toFixed(1)}d`}
          icon={<Clock className="h-4 w-4" />}
          suffix={avgDaysOnMarket > 14 ? "— high" : "— good"}
        />
        <StatCard
          label="Avg. Implied Discount"
          value={`${(avgImpliedDiscount * 100).toFixed(2)}%`}
          icon={<TrendingDown className="h-4 w-4" />}
          suffix={`| Vol ${formatCurrency(totalAskVolume, "USDC", true)}`}
        />
      </div>

      {/* Per-listing table */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Listing Detail
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-4">
          <div
            role="table"
            aria-label={t("a11y.sellerMetricsTable")}
            className="w-full overflow-x-auto"
          >
            {/* Header */}
            <div
              role="row"
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-x-3 border-b border-zinc-800 px-5 pb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500"
            >
              <span role="columnheader">Invoice / Debtor</span>
              <span role="columnheader">Ask Price</span>
              <span role="columnheader">Discount</span>
              <span role="columnheader">Days on Market</span>
              <span role="columnheader">Status</span>
            </div>

            {/* Rows */}
            {metrics.map((m) => (
              <div
                key={m.positionId}
                role="row"
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-x-3 border-b border-zinc-800/50 px-5 py-2.5 text-xs last:border-0 hover:bg-zinc-800/30 transition-colors"
              >
                <div role="cell">
                  <p className="font-medium text-foreground">{m.invoiceNumber}</p>
                  <p className="text-[11px] text-muted-foreground">{m.debtorName}</p>
                </div>
                <span role="cell" className="font-medium text-foreground">
                  {formatCurrency(m.askPrice, m.currency, true)}
                </span>
                <span
                  role="cell"
                  className={cn(
                    "font-medium",
                    m.impliedDiscount >= 0 ? "text-emerald-400" : "text-amber-400"
                  )}
                >
                  {m.impliedDiscount >= 0 ? "−" : "+"}
                  {Math.abs(m.impliedDiscount * 100).toFixed(2)}%
                </span>
                <span role="cell" className={cn(m.daysOnMarket > 14 ? "text-amber-400" : "text-zinc-300")}>
                  {m.daysOnMarket}d
                  {m.daysOnMarket > 14 && (
                    <span className="ml-1 text-[9px] text-amber-400/70">long</span>
                  )}
                </span>
                <span role="cell">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px]",
                      m.positionActive
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-zinc-700 text-zinc-500"
                    )}
                  >
                    {m.positionActive ? "Active" : "Closed"}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SellerAnalyticsDashboard;
