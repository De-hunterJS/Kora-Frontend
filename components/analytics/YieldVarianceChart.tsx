"use client";

/**
 * Realized vs expected yield variance (issue #601).
 *
 * Lives in its own component rather than inside `Charts.tsx`: that file is a
 * single monolithic default export whose props would have to grow to carry
 * position-level data, and this chart is also wanted on the investor dashboard
 * independently.
 *
 * All arithmetic is in `lib/yieldVariance` so it is unit-tested without
 * mounting recharts. This file only renders.
 *
 * Edge-case handling (issue #XXX):
 *  - Empty positions (series.length === 0): shows EmptyState, no blank SVG.
 *  - Single data point (series.length === 1): renders aggregate stat only —
 *    a variance line across one point is meaningless and triggers Recharts
 *    layout warnings.
 *  - Error prop: shows an inline retry hint with aria-live="polite" so screen
 *    readers announce the failure without a focus jump.
 *  - NaN / identical y values: guarded by isFinite checks before rendering.
 */

import React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, Download, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormatters } from "@/hooks/useFormatters";
import {
  aggregateVariance,
  buildVarianceSeries,
  computeVarianceRows,
  varianceExportFilename,
  varianceToExportRows,
  VARIANCE_EXPORT_HEADERS,
} from "@/lib/yieldVariance";
import EmptyState from "@/components/ui/EmptyState";
import type { InvestorPosition } from "@/types/invoice";

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(var(--background))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    color: "hsl(var(--foreground))",
    fontSize: "12px",
  },
};

export interface YieldVarianceChartProps {
  positions: InvestorPosition[];
  isLoading?: boolean;
  compact?: boolean;
  /**
   * Pass an error message to show an inline error state with a retry hint.
   * The region is aria-live="polite" so screen readers announce it without
   * stealing focus.
   */
  error?: string | null;
  /** Called when the user clicks "Retry" on the error state. */
  onRetry?: () => void;
  /** Receives export-ready rows; wire to the app's CSV writer. */
  onExport?: (
    rows: Array<Record<string, string | number>>,
    filename: string,
    headers: readonly string[]
  ) => void;
}

export default function YieldVarianceChart({
  positions,
  isLoading = false,
  compact = false,
  error = null,
  onRetry,
  onExport,
}: YieldVarianceChartProps) {
  const t = useTranslations("analytics");
  const { formatCurrency, formatPercentage } = useFormatters();

  const rows = React.useMemo(() => computeVarianceRows(positions), [positions]);
  const series = React.useMemo(() => buildVarianceSeries(rows), [rows]);
  const totals = React.useMemo(() => aggregateVariance(rows), [rows]);

  const money = React.useCallback(
    (value: number) => formatCurrency(value, "USDC"),
    [formatCurrency]
  );

  /** Filter out NaN / Infinity values so Recharts never receives bad data. */
  const safeSeries = React.useMemo(
    () =>
      series.filter(
        (p) => isFinite(p.expected) && isFinite(p.realized)
      ),
    [series]
  );

  /** True when all realized values are identical — a variance line adds no info. */
  const allValuesIdentical = React.useMemo(() => {
    if (safeSeries.length < 2) return false;
    const first = safeSeries[0].realized;
    return safeSeries.every((p) => p.realized === first);
  }, [safeSeries]);

  /** Spell the series out for assistive tech, matching the other charts. */
  const description = React.useMemo(() => {
    if (safeSeries.length === 0) {
      return "Realized versus expected yield. No data available.";
    }
    if (safeSeries.length === 1) {
      const p = safeSeries[0];
      return `Realized versus expected yield. Single data point — ${p.month}: expected ${money(p.expected)}, realized ${money(p.realized)}.`;
    }
    const points = safeSeries
      .map(
        (p) =>
          `${p.month}: expected ${money(p.expected)}, realized ${money(p.realized)}`
      )
      .join("; ");
    return `Realized versus expected yield. ${safeSeries.length} months — ${points}.`;
  }, [safeSeries, money]);

  const handleExport = React.useCallback(() => {
    onExport?.(varianceToExportRows(rows), varianceExportFilename(), VARIANCE_EXPORT_HEADERS);
  }, [onExport, rows]);

  const varianceIsPositive = totals.totalVariance >= 0;

  // ── Aggregate readout — shared by single-point and multi-point views ──────
  const AggregateReadout = (
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <dt className="text-xs text-muted-foreground">Expected</dt>
        <dd className="text-sm font-medium">{money(totals.totalExpectedYield)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Realized</dt>
        <dd className="text-sm font-medium">{money(totals.totalRealizedYield)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Variance</dt>
        <dd
          className={`flex items-center gap-1 text-sm font-medium ${
            varianceIsPositive ? "text-emerald-500" : "text-red-500"
          }`}
        >
          {varianceIsPositive ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {money(totals.totalVariance)}
          {totals.totalVariancePercent !== null && (
            <span className="text-xs">
              ({formatPercentage(totals.totalVariancePercent, 1)})
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Settled</dt>
        <dd className="text-sm font-medium">
          {totals.settledCount} / {totals.settledCount + totals.pendingCount}
        </dd>
      </div>
    </dl>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Realized vs Expected Yield</CardTitle>
        {onExport && rows.length > 0 && !error && (
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md p-2 transition-colors hover:bg-muted"
            aria-label={t("a11y.exportVariance")}
          >
            <Download className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </CardHeader>

      <CardContent>
        {/* ── Error state ───────────────────────────────────────────────── */}
        {error && (
          <div
            role="status"
            aria-live="polite"
            data-testid="yield-variance-error"
            className="flex flex-col items-center justify-center gap-3 py-10 text-center"
          >
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        )}

        {/* ── Loading skeleton ──────────────────────────────────────────── */}
        {!error && isLoading && (
          <div style={{ height: compact ? 180 : 240 }} data-testid="yield-variance-skeleton">
            <Skeleton className="h-full w-full" />
          </div>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!error && !isLoading && safeSeries.length === 0 && (
          <EmptyState
            title="No yield data yet"
            description="Yield variance will populate once you have settled positions."
            variant="analytics"
          />
        )}

        {/* ── Single data point — show stats only, skip the chart ──────── */}
        {!error && !isLoading && safeSeries.length === 1 && (
          <div data-testid="yield-variance-single-point">
            <p className="mb-3 text-xs text-muted-foreground">
              Only one data point available — a variance line requires at least two months of data.
            </p>
            {AggregateReadout}
          </div>
        )}

        {/* ── Full chart (2+ points) ────────────────────────────────────── */}
        {!error && !isLoading && safeSeries.length >= 2 && (
          <>
            <div role="img" aria-label={description}>
              <ResponsiveContainer width="100%" height={compact ? 180 : 240}>
                <ComposedChart
                  data={safeSeries}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => money(v)}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [money(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="expected"
                    name="Expected"
                    fill="hsl(var(--muted-foreground))"
                    fillOpacity={0.35}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  {/* Only render the variance line when values differ */}
                  {!allValuesIdentical && (
                    <Line
                      type="monotone"
                      dataKey="realized"
                      name="Realized"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {AggregateReadout}

            {totals.pendingCount > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {totals.pendingCount} position
                {totals.pendingCount === 1 ? " is" : "s are"} still active and counted as expected
                only — variance is reported for settled positions.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
