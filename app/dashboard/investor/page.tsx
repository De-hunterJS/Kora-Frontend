"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Store, TrendingUp, DollarSign, BarChart3, Clock, AlertTriangle, Tag, Download, FileText } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { useWallet } from "@/hooks/useWallet";
import { useFormatters } from "@/hooks/useFormatters";
import { useUIStore, useInvoiceStore, usePositionListingStore, DEFAULT_FILTERS } from "@/store";
import { usePositions } from "@/hooks/usePositions";
import { ConcentrationRiskAlerts } from "@/components/analytics/ConcentrationRiskAlerts";
import { useTransaction } from "@/hooks/useTransaction";
import { useTxSimulation } from "@/hooks/useTxSimulation";
import { useVerifiedAction } from "@/hooks/useVerifiedAction";
import { useToast } from "@/hooks/useToast";
import { useTranslations } from "next-intl";
import { TxSimulationPreview } from "@/components/invoice/TxSimulationPreview";
import { prepareClaimPosition } from "@/services/invoiceService";
import { ListPositionDialog } from "@/components/invoice/ListPositionDialog";
import type { PortfolioDonutProps, DonutFilter } from "@/components/dashboard/PortfolioDonut";
import {
  marketplacePathForAllocation,
  allocationToMarketplaceFilters,
} from "@/lib/portfolioAllocation";
import {
  RISK_TIER_COLORS,
  cn,
} from "@/lib/utils";
import type { InvestorPosition, InvoicePosition } from "@/types/invoice";
import { computeImpliedDiscount } from "@/types/invoice";
import type { ColumnDef, DataTableProps } from "@/types/table";
import { InvestorDashboardSkeleton } from "@/components/ui/skeleton";
import { KycStatusCard } from "@/components/dashboard/KycStatusCard";
import { StaleDataBadge } from "@/components/layout/StaleDataBadge";
import { SellerAnalyticsDashboard } from "@/components/analytics/SellerAnalyticsDashboard";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import EmptyState from "@/components/ui/EmptyState";
import { exportCsv, exportPdf } from "@/lib/export";
import {
  PORTFOLIO_EXPORT_HEADERS,
  positionsToExportRows,
  portfolioExportFilename,
  portfolioPdfFilename,
} from "@/lib/portfolioExport";

const DataTable = dynamic<DataTableProps<InvestorPosition>>(
  () => import("@/components/ui/data-table").then((m) => m.DataTable),
  {
    ssr: false,
    loading: () => <div className="h-48 rounded bg-zinc-900/40" aria-busy="true" />,
  },
);

const PortfolioDonut = dynamic<PortfolioDonutProps>(
  () => import("@/components/dashboard/PortfolioDonut").then((m) => m.PortfolioDonut),
  {
    ssr: false,
    loading: () => <div className="h-64 w-full animate-pulse rounded-xl bg-zinc-900/40 border border-zinc-800" />,
  },
);

/** Loading must resolve within 30s or we surface an error state. */
const INVESTOR_DASHBOARD_LOAD_TIMEOUT_MS = 30_000;

function toInvoicePositions(positions: InvestorPosition[]): InvoicePosition[] {
  return positions
    .filter((p): p is InvestorPosition & { invoice: NonNullable<InvestorPosition["invoice"]> } =>
      Boolean(p.invoice),
    )
    .map((p) => ({
      invoiceId: p.invoiceId,
      invoice: p.invoice,
      investedAmount: p.investedAmount,
      expectedReturn: p.expectedReturn,
      yieldEarned: Math.max(0, p.expectedReturn - p.investedAmount),
      investedAt: p.invoice.createdAt,
      status: p.status,
    }));
}

export default function InvestorDashboardPage() {
  const { isConnected, address } = useWallet();
  const { setWalletModalOpen } = useUIStore();
  const t = useTranslations("investorDashboard");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { setFilters, resetFilters } = useInvoiceStore();
  const { formatCurrency, formatDate, formatApr, formatPercentage } = useFormatters();
  const positionsQuery = usePositions(address ?? undefined, {
    refetchInterval: 30_000,
  });
  const { execute } = useTransaction();
  const { simulationDialogProps, onSimulationPreview } = useTxSimulation();
  const { executeProtectedAction } = useVerifiedAction();
  const toast = useToast();
  const [donutFilter, setDonutFilter] = useState<DonutFilter | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [listingTarget, setListingTarget] = useState<InvestorPosition | null>(null);
  const { listings, listPosition, unlistPosition } = usePositionListingStore();

  const positionsData: InvestorPosition[] = useMemo(
    () => positionsQuery.data ?? [],
    [positionsQuery.data],
  );
  const isInitialLoading =
    positionsQuery.isLoading || (positionsQuery.isFetching && !positionsQuery.data);

  const donutPositions = useMemo(
    () => toInvoicePositions(positionsData),
    [positionsData],
  );

  const filteredPositions = useMemo(() => {
    if (!donutFilter) return positionsData;
    return positionsData.filter((pos) => {
      const inv = pos.invoice;
      if (!inv) return false;
      switch (donutFilter.dimension) {
        case "riskTier":
          return inv.riskTier === donutFilter.value;
        case "jurisdiction":
          return inv.metadata.jurisdiction === donutFilter.value;
        case "category":
          return inv.metadata.category === donutFilter.value;
        default:
          return true;
      }
    });
  }, [positionsData, donutFilter]);

  const handleSegmentClick = useCallback(
    (filter: DonutFilter | null) => {
      setDonutFilter(filter);
      if (!filter) {
        resetFilters();
        return;
      }
      resetFilters();
      setFilters({
        ...DEFAULT_FILTERS,
        ...allocationToMarketplaceFilters(filter),
      });
      router.push(marketplacePathForAllocation(filter));
    },
    [resetFilters, setFilters, router],
  );

  useEffect(() => {
    if (!isConnected || !isInitialLoading || loadTimedOut) return;

    const id = window.setTimeout(() => {
      setLoadTimedOut(true);
    }, INVESTOR_DASHBOARD_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(id);
  }, [isConnected, isInitialLoading, loadTimedOut]);

  useEffect(() => {
    if (positionsQuery.isSuccess || positionsQuery.isError) {
      setLoadTimedOut(false);
    }
  }, [positionsQuery.isSuccess, positionsQuery.isError]);

  /**
   * Claiming yield moves funds, so it sits behind the same verification session
   * SME repayment does (#681). Previously this called `execute` directly, which
   * meant an expired session reached the signing prompt with no re-verification
   * step in between.
   */
  const handleClaim = async (pos: InvestorPosition) => {
    if (!address) return;

    const runClaim = async () => {
      await execute(() => prepareClaimPosition(pos.id, address), {
        successMessage: t("claim.successMessage"),
        // Yield claims are the "yield available" notification channel, not the
        // generic tx one — muting that preference must mute this too.
        successNotificationType: "yieldAvailable",
        onSimulationPreview,
        onSuccess: () => positionsQuery.refetch(),
        // Without this the failure toast's retry only clears the error; the
        // investor still has an unclaimed position and no way back to it.
        onRetry: () => {
          void handleClaim(pos);
        },
      });
    };

    const result = await executeProtectedAction(runClaim, "claim");

    // `requiresVerification` comes back only when no VerificationProvider is in
    // the tree to raise the modal — surface the reason rather than failing mute.
    if (result.requiresVerification) {
      toast.error(
        t("claim.verificationRequiredTitle"),
        t("claim.verificationRequiredDesc"),
        () => {
          void handleClaim(pos);
        }
      );
      return;
    }

    if (result.error && result.error !== "Wallet not connected") {
      toast.error(t("claim.failedTitle"), result.error, () => {
        void handleClaim(pos);
      });
    }
  };

  const handleListSubmit = (askPrice: number, expiresAt?: string) => {
    if (!listingTarget || !address) return;
    listPosition({
      positionId: listingTarget.id,
      askPrice,
      impliedDiscount: computeImpliedDiscount(askPrice, listingTarget.expectedReturn),
      listedAt: new Date().toISOString(),
      expiresAt,
      invoiceTokenId: listingTarget.invoice?.tokenId,
      repaymentDate: listingTarget.invoice?.terms.repaymentDate,
    });
    toast.success(t("listing.success"));
    setListingTarget(null);
  };

  /** Export visible positions as a CSV file. Scoped to the connected address. */
  const handleExportCsv = useCallback(() => {
    if (!positionsData.length) return;
    const rows = positionsToExportRows(positionsData);
    exportCsv(rows as Record<string, unknown>[], portfolioExportFilename(), [
      ...PORTFOLIO_EXPORT_HEADERS,
    ]);
  }, [positionsData]);

  /** Capture the positions card DOM node as a PDF. Falls back to window.print(). */
  const handleExportPdf = useCallback(() => {
    if (!positionsData.length) return;
    void exportPdf("investor-positions-card", portfolioPdfFilename());
  }, [positionsData]);

  const columns: ColumnDef<InvestorPosition>[] = [
    {
      id: "invoice",
      header: t("table.invoice"),
      accessor: (row) => row.invoice?.metadata.invoiceNumber ?? row.invoiceId,
    },
    {
      id: "invested",
      header: t("table.invested"),
      accessor: (row) => row.investedAmount,
      cell: (row) => formatCurrency(row.investedAmount),
    },
    {
      id: "expected",
      header: t("table.expectedReturn"),
      accessor: (row) => row.expectedReturn,
      cell: (row) => formatCurrency(row.expectedReturn),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.status === "repaid" && (
            <Button size="sm" onClick={() => handleClaim(row)}>
              {t("table.claim")}
            </Button>
          )}
          {row.status === "active" &&
            (listings[row.id] ? (
              <Button size="sm" variant="outline" onClick={() => unlistPosition(row.id)}>
                {t("table.unlist")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setListingTarget(row)}>
                <Tag className="h-3.5 w-3.5" aria-hidden /> {t("table.listForSale")}
              </Button>
            ))}
          <Link
            href={`/marketplace/${row.invoice?.id ?? row.invoiceId}`}
            className="text-xs text-primary hover:opacity-80"
          >
            {t("table.view")}
          </Link>
        </div>
      ),
    },
  ];

  const stats = useMemo(
    () => [
      {
        label: t("stats.portfolioValue"),
        value: formatCurrency(
          positionsData.reduce((sum, p) => sum + p.investedAmount, 0),
        ),
        icon: <DollarSign className="h-4 w-4" />,
      },
      {
        label: t("stats.expectedReturn"),
        value: formatCurrency(
          positionsData.reduce((sum, p) => sum + p.expectedReturn, 0),
        ),
        icon: <TrendingUp className="h-4 w-4" />,
      },
      {
        label: t("stats.yieldEarned"),
        value: formatCurrency(
          positionsData.reduce(
            (sum, p) => sum + Math.max(0, p.expectedReturn - p.investedAmount),
            0,
          ),
        ),
        icon: <BarChart3 className="h-4 w-4" />,
      },
      {
        label: t("stats.activePositions"),
        value: String(positionsData.length),
        icon: <Store className="h-4 w-4" />,
      },
    ],
    [positionsData, formatCurrency, t],
  );

  if (!isConnected) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Store className="h-12 w-12 text-zinc-600" />
        <h1 className="text-2xl font-semibold text-white">
          {t("connectWallet.title")}
        </h1>
        <p className="max-w-md text-zinc-400">{t("connectWallet.description")}</p>
        <Button onClick={() => setWalletModalOpen(true)}>
          {tCommon("connectWallet")}
        </Button>
      </div>
    );
  }

  if (isInitialLoading && !loadTimedOut) {
    return <InvestorDashboardSkeleton />;
  }

  if (positionsQuery.isError || loadTimedOut) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h1 className="text-2xl font-semibold text-white">
          {t("error.title")}
        </h1>
        <p className="max-w-md text-zinc-400">
          {loadTimedOut ? t("error.timeout") : t("error.description")}
        </p>
        <Button onClick={() => positionsQuery.refetch()}>{t("error.retry")}</Button>
      </div>
    );
  }

  // Empty portfolio: connected + success + zero positions
  const isEmpty = positionsQuery.isSuccess && positionsData.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("title")}</h1>
          <p className="text-sm text-zinc-400">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <StaleDataBadge
            updatedAt={positionsQuery.dataUpdatedAt}
            isFetching={positionsQuery.isFetching}
          />
          {/* Export actions — disabled when loading or no positions */}
          <button
            type="button"
            disabled={!positionsData.length || positionsQuery.isLoading}
            aria-disabled={!positionsData.length || positionsQuery.isLoading}
            aria-label={t("export.csvAriaLabel")}
            title={!positionsData.length ? t("export.emptyTooltip") : undefined}
            data-testid="export-csv-btn"
            onClick={handleExportCsv}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800 print:hidden"
          >
            {t("export.csv")}
          </button>
          <button
            type="button"
            disabled={!positionsData.length || positionsQuery.isLoading}
            aria-disabled={!positionsData.length || positionsQuery.isLoading}
            aria-label={t("export.pdfAriaLabel")}
            title={!positionsData.length ? t("export.emptyTooltip") : undefined}
            data-testid="export-pdf-btn"
            onClick={handleExportPdf}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800 print:hidden"
          >
            {t("export.pdf")}
          </button>
        </div>
      </div>

      {/* Stats row — always visible so the user sees zeros, not nothing */}
      <ErrorBoundary compact>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              icon={stat.icon}
            />
          ))}
        </div>
      </ErrorBoundary>

      {/* KYC card stays visible regardless of positions */}
      <KycStatusCard />

      {isEmpty ? (
        /* ── Empty portfolio state ─────────────────────────────────────── */
        <EmptyState
          variant="no-positions"
          title={t("empty.title")}
          description={t("empty.description")}
          cta={{
            label: t("browseMarketplace"),
            onClick: () => router.push("/marketplace"),
          }}
          data-tour="investor-empty-state"
        />
      ) : (
        <>
          <ErrorBoundary compact>
            <ConcentrationRiskAlerts positions={positionsData} />
          </ErrorBoundary>

          {/* Portfolio donut charts */}
          <ErrorBoundary>
            <Card>
              <CardHeader>
                <CardTitle>{t("allocation.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <PortfolioDonut
                  positions={donutPositions}
                  activeFilter={donutFilter}
                  onSegmentClick={handleSegmentClick}
                />
              </CardContent>
            </Card>
          </ErrorBoundary>

          {/* Seller analytics — only shown when the investor has active listings */}
          <ErrorBoundary compact>
            <SellerAnalyticsDashboard
              listings={Object.values(listings).filter((l) =>
                positionsData.some((p) => p.id === l.positionId),
              )}
              positions={positionsData}
            />
          </ErrorBoundary>

          {/* Positions data table */}
          <ErrorBoundary>
            <Card id="investor-positions-card">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>{t("positions.title")}</CardTitle>
                <Badge variant="secondary">
                  {t("positions.count", { count: filteredPositions.length })}
                </Badge>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={filteredPositions}
                  columns={columns}
                  emptyMessage={t("positions.empty")}
                />
              </CardContent>
            </Card>
          </ErrorBoundary>
        </>
      )}

      <ListPositionDialog
        open={Boolean(listingTarget)}
        onOpenChange={(open) => {
          if (!open) setListingTarget(null);
        }}
        position={listingTarget}
        onSubmit={handleListSubmit}
      />

      <TxSimulationPreview {...simulationDialogProps} />
    </div>
  );
}
