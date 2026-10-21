"use client";

import { useState, useMemo, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Search,
  SlidersHorizontal,
  Clock,
  Tag,
  Percent,
  User,
  ArrowRight,
  RotateCcw,
  Copy,
  Check,
  ArrowUpDown,
} from "lucide-react";
import { Container } from "@/components/layout/Container";
import { SellerAnalyticsDashboard } from "@/components/analytics/SellerAnalyticsDashboard";
import { usePositions } from "@/hooks/usePositions";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { toast } from "sonner";
import { TxSimulationPreview } from "@/components/invoice/TxSimulationPreview";
import { AcquirePositionDialog } from "@/components/invoice/AcquirePositionDialog";
import { AcceptTransferDialog } from "@/components/invoice/AcceptTransferDialog";
import { FeeDisclosure } from "@/components/secondary/FeeDisclosure";
import { useAcquirePositionFlow, useTransferPositionFlow } from "@/hooks/useTransaction";
import { useWallet } from "@/hooks/useWallet";
import { env } from "@/lib/env";
import { computeAcquisitionFees, getFeeSchedule } from "@/lib/secondaryFees";
import { usePositionListingStore } from "@/store/positionListingStore";
import { useInvoiceStore } from "@/store/invoiceStore";
import { RISK_TIER_COLORS, cn } from "@/lib/utils";
import { computeImpliedDiscount } from "@/types/invoice";
import type { Invoice, PositionListing } from "@/types/invoice";
import { TENOR_OPTIONS, YIELD_OPTIONS } from "@/components/marketplace/filters";
import { useTranslations } from "next-intl";
import { useFormatters } from "@/hooks/useFormatters";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { sanitizeQueryParam } from "@/lib/security";
import { useDebounce } from "@/hooks/useDebounce";
import { useFeatureFlag } from "@/lib/featureFlags";
import {
  parseSecondaryFiltersFromSearchParams,
  secondaryFiltersToQueryString,
  DEFAULT_SECONDARY_FILTERS,
} from "@/lib/secondaryUrlFilters";
import {
  SECONDARY_SORT_OPTIONS,
  DEFAULT_SECONDARY_SORT,
  parseSecondarySort,
  sortSecondaryItems,
  type SecondarySortBy,
} from "@/lib/secondarySort";

export interface SecondaryMarketItem {
  listing: PositionListing;
  positionId: string;
  invoice: Invoice;
  investedAmount: number;
  expectedReturn: number;
  sellerAddress: string;
  remainingTenor: number;
  yieldPercent: number;
}

function SecondaryMarketplaceContent() {
  const t = useTranslations("secondaryMarket");
    const t = useTranslations("secondaryMarket");
    const tFilters = useTranslations("secondary.filters");
  const { formatCurrency, formatPercentage } = useFormatters();
  const secondaryEnabled = useFeatureFlag("secondary-market");

  // Issue #594: acquire runs through the same simulation gate as fund/transfer.
  const { acquirePosition, simulationDialogProps } = useAcquirePositionFlow();
  // Issue #732: buyer accept-position transfer — same simulation-gate pattern,
  // its own TxSimulationPreview instance since useTxSimulation state is local
  // to whichever flow hook renders it.
  const {
    acceptTransfer,
    status: acceptStatus,
    error: acceptError,
    simulationDialogProps: acceptSimulationDialogProps,
  } = useTransferPositionFlow();
  const { publicKey } = useWallet();

  // Issue #597: one schedule, read from validated env, shared by every figure
  // on this page.
  const feeSchedule = useMemo(() => getFeeSchedule(env), []);
  const tenorOptions = TENOR_OPTIONS.map(({ labelKey, ...option }) => ({
    ...option,
    label: tFilters(`tenor.${labelKey}`),
  }));
  const yieldOptions = YIELD_OPTIONS.map(({ labelKey, ...option }) => ({
    ...option,
    label: tFilters(`yield.${labelKey}`),
  }));

  const { listings: storeListings } = usePositionListingStore();
  const { invoices } = useInvoiceStore();

  // Issue #593/#655: sellers listing positions here need the same
  // views/discounts/time-on-market stats shown on the investor dashboard.
  const myPositionsQuery = usePositions(publicKey ?? undefined);
  const myPositions = useMemo(() => myPositionsQuery.data ?? [], [myPositionsQuery.data]);
  const myListings = useMemo(
    () => Object.values(storeListings).filter((l) => myPositions.some((p) => p.id === l.positionId)),
    [storeListings, myPositions]
  );
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Hydrate filter state from URL (#643) ─────────────────────────────────
  const initialFilters = useMemo(
    () => parseSecondaryFiltersFromSearchParams(searchParams),
    // Only hydrate from the first URL snapshot so we own subsequent writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [searchQuery, setSearchQuery] = useState(initialFilters.q);
  const [tenorFilter, setTenorFilter] = useState(initialFilters.tenor);
  const [yieldFilter, setYieldFilter] = useState(initialFilters.yield);
  const [sellerFilter, setSellerFilter] = useState(initialFilters.seller);
  const [highlightId] = useState(initialFilters.highlight);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [acquireItem, setAcquireItem] = useState<SecondaryMarketItem | null>(null);
  const [acceptItem, setAcceptItem] = useState<SecondaryMarketItem | null>(null);
  const [sortBy, setSortBy] = useState<SecondarySortBy>(DEFAULT_SECONDARY_SORT);

  // Debounce free-text inputs (seller + search) before committing to the URL.
  const debouncedSearch = useDebounce(searchQuery, 350);
  const debouncedSeller = useDebounce(sellerFilter, 350);

  const isFirstRender = useRef(true);
  useEffect(() => {
    const qs = secondaryFiltersToQueryString({
      q: debouncedSearch,
      tenor: tenorFilter,
      yield: yieldFilter,
      seller: debouncedSeller,
      highlight: highlightId,
    });
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // A well-formed link is left alone; a malformed one (e.g. ?tenor=bogus or
      // control characters in ?q) is rewritten to the sanitized state (#942).
      if (qs === new URLSearchParams(window.location.search).toString()) return;
    }
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [
    debouncedSearch,
    tenorFilter,
    yieldFilter,
    debouncedSeller,
    highlightId,
    pathname,
    router,
  ]);

  const handleCopyUrl = useCallback(() => {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // Build the item list purely from the persisted store + the invoice store.
  // No inline mock array: in mock mode the service layer populates invoices
  // via usePositions/useInvoiceStore; in live mode it hits the RPC.
  const allItems: SecondaryMarketItem[] = useMemo(() => {
    const items: SecondaryMarketItem[] = [];

    Object.values(storeListings).forEach((listing) => {
      const relatedInv = invoices.find(
        (inv) => inv.id === listing.positionId || inv.tokenId === listing.positionId
      );
      if (!relatedInv) return;

      const expectedReturn =
        relatedInv.terms.financingAmount * (1 + relatedInv.terms.discountRate);
      const investedAmount = relatedInv.terms.financingAmount;
      const due = new Date(relatedInv.terms.repaymentDate).getTime();
      const daysLeft = Math.max(0, Math.ceil((due - Date.now()) / (1000 * 60 * 60 * 24)));
      const askPrice = listing.askPrice;
      const yieldPercent =
        askPrice > 0 ? ((expectedReturn - askPrice) / askPrice) * 100 : 0;

      items.push({
        listing: {
          ...listing,
          impliedDiscount: listing.impliedDiscount ?? computeImpliedDiscount(askPrice, expectedReturn),
        },
        positionId: listing.positionId,
        invoice: relatedInv,
        investedAmount,
        expectedReturn,
        sellerAddress: relatedInv.ownerAddress,
        remainingTenor: daysLeft,
        yieldPercent,
      });
    });

    return items;
  }, [storeListings, invoices]);

  // Filter items
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesInvoice =
          item.invoice.metadata.debtorName.toLowerCase().includes(q) ||
          item.invoice.metadata.invoiceNumber.toLowerCase().includes(q) ||
          item.invoice.metadata.category.toLowerCase().includes(q);
        if (!matchesInvoice) return false;
      }

      // Tenor filter
      if (tenorFilter !== "all") {
        const selectedTenor = TENOR_OPTIONS.find((t) => t.value === tenorFilter);
        if (selectedTenor && selectedTenor.min !== undefined && selectedTenor.max !== undefined) {
          if (item.remainingTenor < selectedTenor.min || item.remainingTenor > selectedTenor.max) {
            return false;
          }
        }
      }

      // Yield filter
      const minYieldReq = parseFloat(yieldFilter);
      if (!isNaN(minYieldReq) && minYieldReq > 0) {
        if (item.yieldPercent < minYieldReq) return false;
      }

      // Seller filter
      if (sellerFilter.trim()) {
        const s = sellerFilter.toLowerCase();
        if (!item.sellerAddress.toLowerCase().includes(s)) return false;
      }

      return true;
    });
  }, [allItems, searchQuery, tenorFilter, yieldFilter, sellerFilter]);

  const sortedItems = useMemo(
    () => sortSecondaryItems(filteredItems, sortBy),
    [filteredItems, sortBy]
  );

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    tenorFilter !== "all" ||
    yieldFilter !== "0" ||
    sellerFilter.trim() !== "";

  const resetFilters = () => {
    setSearchQuery(DEFAULT_SECONDARY_FILTERS.q);
    setTenorFilter(DEFAULT_SECONDARY_FILTERS.tenor);
    setYieldFilter(DEFAULT_SECONDARY_FILTERS.yield);
    setSellerFilter(DEFAULT_SECONDARY_FILTERS.seller);
  };

  // Feature flag off: show maintenance empty state
  if (!secondaryEnabled) {
    return (
      <div className="min-h-screen bg-zinc-950 py-8 text-zinc-100">
        <Container>
          <EmptyState
            title={t("disabledTitle")}
            description={t("disabledDesc")}
            cta={{ label: t("exploreMarketplace"), onClick: () => router.push("/marketplace") }}
            variant="no-results"
          />
        </Container>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-8 text-zinc-100">
      <Container>
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Tag className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
                {t("title")}
              </h1>
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                {t("badge")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              {t("subtitle")}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyUrl}
            className="shrink-0 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:text-white"
            aria-label={t("copyAria")}
          >
            {copied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                {t("copied")}
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {t("shareView")}
              </>
            )}
          </Button>
        </div>

        {/* Seller analytics (#593/#655) — shown whenever the connected wallet has active listings */}
        {publicKey && myListings.length > 0 && (
          <ErrorBoundary compact>
            <SellerAnalyticsDashboard
              listings={myListings}
              positions={myPositions}
              className="mb-8"
            />
          </ErrorBoundary>
        )}

        {/* Filter Controls Bar */}
        <ErrorBoundary compact>
          <div className="mb-6 flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-md">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(sanitizeQueryParam(e.target.value))}
                className="pl-9 bg-zinc-950/80 border-zinc-800 text-sm focus:border-primary"
                aria-label={t("searchAria")}
              />
            </div>

            {/* Desktop Filters */}
            <div className="hidden lg:flex lg:items-center lg:gap-3">
              {/* Tenor Filter */}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-zinc-400" />
                <Select
                  value={tenorFilter}
                  onChange={(val) => setTenorFilter(sanitizeQueryParam(val))}
                  options={tenorOptions}
                  loading={myPositionsQuery.isLoading}
                  className="w-40 bg-zinc-950/80 border-zinc-800 text-xs"
                  aria-label={t("tenorAria")}
                />
              </div>

              {/* Yield Filter */}
              <div className="flex items-center gap-2">
                <Percent className="h-4 w-4 text-zinc-400" />
                <Select
                  value={yieldFilter}
                  onChange={(val) => setYieldFilter(sanitizeQueryParam(val))}
                  options={yieldOptions}
                  loading={myPositionsQuery.isLoading}
                  className="w-36 bg-zinc-950/80 border-zinc-800 text-xs"
                  aria-label={t("yieldAria")}
                />
              </div>

              {/* Seller Filter */}
              <div className="relative w-44">
                <User className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <Input
                  placeholder={t("sellerPlaceholder")}
                  value={sellerFilter}
                  onChange={(e) => setSellerFilter(sanitizeQueryParam(e.target.value))}
                  className="pl-8 bg-zinc-950/80 border-zinc-800 text-xs h-9"
                  aria-label={t("sellerAria")}
                />
              </div>

              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-zinc-400" aria-hidden />
                <Select
                  value={sortBy}
                  onChange={(value) => setSortBy(parseSecondarySort(value))}
                  options={[...SECONDARY_SORT_OPTIONS]}
                  loading={myPositionsQuery.isLoading}
                  className="w-52 border-zinc-800 bg-zinc-950/80 text-xs"
                  aria-label="Sort secondary market listings"
                />
              </div>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="text-xs text-zinc-400 hover:text-white"
                  aria-label={t("resetAria")}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  {t("reset")}
                </Button>
              )}
            </div>

            {/* Mobile Filter Toggle */}
            <div className="flex items-center justify-between lg:hidden">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMobileFilterOpen(true)}
                className="w-full border-zinc-800 bg-zinc-950/80 text-xs"
              >
                <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-primary" />
                {t("filterPositions")}
                {hasActiveFilters && (
                  <Badge variant="outline" className="ml-2 bg-primary/20 text-primary text-[10px]">
                    {t("active")}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </div>
        </ErrorBoundary>

        {/* Position Listings Grid */}
        <ErrorBoundary>
        {sortedItems.length === 0 ? (
          allItems.length === 0 ? (
            /* True empty market — no listings at all */
            <EmptyState
              title={t("emptyTitle")}
              description={t("emptyDesc")}
              variant="no-positions"
            />
          ) : (
            /* Filters produced zero results — offer to clear */
            <EmptyState
              title={t("emptyTitle")}
              description={t("emptyDesc")}
              cta={{ label: t("clearFilters"), onClick: resetFilters }}
              variant="no-results"
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sortedItems.map((item) => {
              const riskColor = RISK_TIER_COLORS[item.invoice.riskTier] ?? "text-zinc-400 border-zinc-700";
              const isHighlighted = Boolean(highlightId && item.positionId === highlightId);

              return (
                <Card
                  key={item.positionId}
                  id={`listing-${item.positionId}`}
                  aria-label={
                    item.listing.impliedDiscount != null && item.listing.impliedDiscount < 0
                      ? t("listingAriaStale", { invoiceNumber: item.invoice.metadata.invoiceNumber })
                      : t("listingAria", { invoiceNumber: item.invoice.metadata.invoiceNumber })
                  }
                  className={cn(
                    "group relative overflow-hidden border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm transition-all duration-200 hover:border-primary/50 hover:bg-zinc-900/80 hover:shadow-lg hover:shadow-primary/5",
                    isHighlighted && "ring-2 ring-primary/60 border-primary/60"
                  )}
                >
                  <CardHeader className="p-5 pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-zinc-400">
                            {item.invoice.metadata.invoiceNumber}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] uppercase", riskColor)}
                          >
                            {item.invoice.riskTier}
                          </Badge>
                        </div>
                        <CardTitle className="mt-1 text-base font-semibold text-white">
                          {item.invoice.metadata.debtorName || "Debtor Account"}
                        </CardTitle>
                      </div>
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs font-semibold">
                        {t("yieldBadge", { yield: item.yieldPercent.toFixed(1) })}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-5 pt-2">
                    <div className="space-y-3">
                      {/* Financial Metrics */}
                      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/60 p-3 text-xs">
                        <div>
                          <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">
                            {t("askPrice")}
                          </span>
                          <span className="text-sm font-semibold text-white">
                            {formatCurrency(item.listing.askPrice, item.invoice.metadata.currency)}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">
                            {t("expectedReturn")}
                          </span>
                          <span className="font-medium text-zinc-300">
                            {formatCurrency(item.expectedReturn, item.invoice.metadata.currency)}
                          </span>
                        </div>
                      </div>

                      {/* Position Details */}
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-zinc-400">
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-primary/80" />
                            {t("remainingTenor")}:
                          </span>
                          <span className="font-medium text-white">
                            {t("daysRemaining", { days: item.remainingTenor })}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-zinc-400">
                          <span className="flex items-center gap-1.5">
                            <Tag className="h-3.5 w-3.5 text-emerald-400" />
                            {t("impliedDiscount")}:
                          </span>
                          <span className="font-medium text-emerald-400">
                            {formatPercentage((item.listing.impliedDiscount ?? 0) * 100, 1)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-zinc-400">
                          <span className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-zinc-400" />
                            {t("sellerAddress")}:
                          </span>
                          <span className="font-mono text-[11px] text-zinc-300">
                            {item.sellerAddress.slice(0, 4)}...{item.sellerAddress.slice(-4)}
                          </span>
                        </div>
                      </div>

                      {/* Issue #597: disclose fees before the buyer confirms. */}
                      <FeeDisclosure
                        className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5"
                        fees={computeAcquisitionFees(item.listing.askPrice, feeSchedule)}
                      />

                      {/* Action Buttons */}
                      <Button
                        className="w-full mt-3 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-xs h-9"
                        onClick={() => {
                          if (!publicKey) {
                            toast.info(t("connectWalletToAcquire"), {
                              description: "Please connect your wallet first.",
                            });
                            return;
                          }
                          setAcquireItem(item);
                        }}
                      >
                        {publicKey ? t("acquirePosition") : t("connectWalletToAcquire")}
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>

                      {/* Issue #732: buyer accept-position transfer dialog shell */}
                      <Button
                        variant="outline"
                        className="w-full mt-2 border-zinc-700 bg-zinc-950/60 text-xs text-zinc-300 hover:text-white h-9"
                        onClick={() => {
                          if (!publicKey) {
                            toast.info(t("connectWalletToAcquire"), {
                              description: "Please connect your wallet first.",
                            });
                            return;
                          }
                          setAcceptItem(item);
                        }}
                      >
                        {t("acceptTransfer")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        </ErrorBoundary>

        {/* Issue #594: preview before signing; the dialog blocks proceed when
            the simulation fails. */}
        <TxSimulationPreview {...simulationDialogProps} />
        <TxSimulationPreview {...acceptSimulationDialogProps} />

        {/* Issue #642: accessible acquire position dialog shell */}
        <AcquirePositionDialog
          item={acquireItem}
          open={acquireItem !== null}
          onOpenChange={(open) => {
            if (!open) setAcquireItem(null);
          }}
          onConfirm={() => {
            if (acquireItem && publicKey) {
              void acquirePosition(
                acquireItem.positionId,
                publicKey,
                acquireItem.sellerAddress
              );
            }
          }}
        />

        {/* Issue #732: buyer accept-position transfer dialog shell */}
        <AcceptTransferDialog
          item={acceptItem}
          open={acceptItem !== null}
          onOpenChange={(open) => {
            if (!open) setAcceptItem(null);
          }}
          onConfirm={() => {
            if (acceptItem && publicKey) {
              void acceptTransfer(acceptItem.positionId, publicKey);
            }
          }}
          status={acceptStatus}
          error={acceptError}
        />

        {/* Mobile Filter Bottom Sheet */}
        <BottomSheet
          open={mobileFilterOpen}
          onOpenChange={setMobileFilterOpen}
          title={t("bottomSheetTitle")}
        >
          <div className="space-y-4 p-4 text-zinc-100">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">{t("mobileTenorLabel")}</label>
                <Select
                  value={tenorFilter}
                  onChange={(val) => setTenorFilter(sanitizeQueryParam(val))}
                  options={tenorOptions}
                  loading={myPositionsQuery.isLoading}
                  className="w-full border-zinc-800 bg-zinc-900 text-xs"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 mb-1 block">{t("mobileYieldLabel")}</label>
                <Select
                  value={yieldFilter}
                  onChange={(val) => setYieldFilter(sanitizeQueryParam(val))}
                  options={yieldOptions}
                  loading={myPositionsQuery.isLoading}
                  className="w-full border-zinc-800 bg-zinc-900 text-xs"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 mb-1 block">{t("mobileSellerLabel")}</label>
                <Input
                  placeholder={t("sellerPlaceholder")}
                  value={sellerFilter}
                  onChange={(e) => setSellerFilter(sanitizeQueryParam(e.target.value))}
                  className="border-zinc-800 bg-zinc-900 text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 text-xs" onClick={resetFilters}>
                {t("reset")}
              </Button>
              <Button className="flex-1 text-xs" onClick={() => setMobileFilterOpen(false)}>
                {t("applyFilters")}
              </Button>
            </div>
          </div>
        </BottomSheet>
      </Container>
    </div>
  );
}

export default function SecondaryMarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 py-8 text-zinc-100">
          <Container>
            <div className="mb-8 space-y-2">
              <div className="h-8 w-64 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-96 animate-pulse rounded bg-zinc-800/70" />
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
              ))}
            </div>
          </Container>
        </div>
      }
    >
      <SecondaryMarketplaceContent />
    </Suspense>
  );
}
