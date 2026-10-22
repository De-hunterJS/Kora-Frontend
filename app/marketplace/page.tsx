"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Invoice } from "@/types";
import {
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  Check,
  RotateCcw,
  Clock,
  Download,
  Star,
  Layers,
} from "lucide-react";
import EmptyState, { type RecoverySuggestion } from "@/components/ui/EmptyState";
import {
  trackMarketplaceLand,
  trackMarketplaceFundCta,
} from "@/lib/marketplaceAnalytics";
import {
  deriveRecoveryActions,
  hasRestrictiveFilters,
} from "@/lib/emptyStateRecovery";
import { WatchlistDrawer } from "@/components/marketplace/WatchlistDrawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvoiceCard, InvoiceCardSkeleton } from "@/components/invoice/InvoiceCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteInvoices, MARKETPLACE_PAGE_SIZE } from "@/hooks/useInvoices";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useInvoiceStore, DEFAULT_FILTERS } from "@/store";
import { Container } from "@/components/layout/Container";
import { cn } from "@/lib/utils";
import { sanitizeQueryParam } from "@/lib/security";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { RangeSlider } from "@/components/ui/range-slider";
import { ComparisonBar } from "@/components/marketplace/ComparisonBar";
import ActiveFilterChips from "@/components/marketplace/ActiveFilterChips";
import PresetImportExport from "@/components/marketplace/PresetImportExport";
import { CategoryTaxonomyPreview } from "@/components/marketplace/CategoryTaxonomyPreview";
import { useFeatureFlag } from "@/lib/featureFlags";
import { useDebounce } from "@/hooks/useDebounce";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { useMarketplaceScrollReset } from "@/hooks/useMarketplaceScrollReset";
import { buildMarketplaceFilterFingerprint } from "@/lib/marketplaceFilterFingerprint";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useRovingTabIndex } from "@/hooks/useRovingTabIndex";
import { buildRangeSelection } from "@/lib/comparison";
import { StaleDataBadge } from "@/components/layout/StaleDataBadge";
import {
  MarketplaceAprHistogram,
  MarketplaceRiskDistribution,
} from "@/components/analytics/Charts";
import { toast } from "sonner";
import { exportCsv } from "@/lib/export";
import {
  marketplaceInvoicesToExportRows,
  marketplaceExportFilename,
} from "@/lib/portfolioExport";


// ─── Filter Options ──────────────────────────────────────────────────────────

// Labels are resolved via the "marketplace" translation namespace at render
// time (t is scoped to that namespace in MarketplaceContent).
type TFunc = (key: string) => string;

const getCategoryOptions = (t: TFunc) => [
  { value: "technology", label: t("categoryOptions.technology") },
  { value: "agriculture", label: t("categoryOptions.agriculture") },
  { value: "healthcare", label: t("categoryOptions.healthcare") },
  { value: "construction", label: t("categoryOptions.construction") },
  { value: "energy", label: t("categoryOptions.energy") },
  { value: "logistics", label: t("categoryOptions.logistics") },
  { value: "retail", label: t("categoryOptions.retail") },
  { value: "manufacturing", label: t("categoryOptions.manufacturing") },
  { value: "finance", label: t("categoryOptions.finance") },
  { value: "other", label: t("categoryOptions.other") },
];

const getJurisdictionOptions = (t: TFunc) => [
  { value: "KE", label: t("jurisdictionOptions.KE") },
  { value: "NG", label: t("jurisdictionOptions.NG") },
  { value: "GH", label: t("jurisdictionOptions.GH") },
  { value: "ZA", label: t("jurisdictionOptions.ZA") },
  { value: "US", label: t("jurisdictionOptions.US") },
  { value: "EU", label: t("jurisdictionOptions.EU") },
  { value: "UK", label: t("jurisdictionOptions.UK") },
  { value: "OTHER", label: t("jurisdictionOptions.OTHER") },
  { value: "IN", label: t("jurisdictionOptions.IN") },
  { value: "BR", label: t("jurisdictionOptions.BR") },
];

// Risk-tier codes (AAA, AA, A, BBB, BB, B, CCC) are rating-agency codes, not
// translatable text — intentionally left as-is.
const RISK_OPTIONS = [
  { value: "AAA", label: "AAA" },
  { value: "AA", label: "AA" },
  { value: "A", label: "A" },
  { value: "BBB", label: "BBB" },
  { value: "BB", label: "BB" },
  { value: "B", label: "B" },
  { value: "CCC", label: "CCC" },
];

const getSortOptions = (t: TFunc) => [
  { value: "apr_desc", label: t("sort.aprDesc") },
  { value: "apr_asc", label: t("sort.aprAsc") },
  { value: "amount_desc", label: t("sort.amountDesc") },
  { value: "amount_asc", label: t("sort.amountAsc") },
  { value: "due_soonest", label: t("sort.dueSoonest") },
  { value: "due_latest", label: t("sort.dueLatest") },
  { value: "newest", label: t("sort.newest") },
];

// ─── Custom UI Controls ──────────────────────────────────────────────────────

// 2. Custom Checkbox Group for Risk Tiers
function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (val: string[]) => void;
}) {
  const toggleOption = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((item) => item !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const isChecked = selected.includes(opt.value);
          return (
            <label
              key={opt.value}
              className={`flex items-center gap-2 rounded-lg border p-2 text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                isChecked
                  ? "border-primary/50 bg-primary/5 text-foreground"
                  : "border-zinc-800 bg-zinc-900/20 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggleOption(opt.value)}
                className="sr-only"
              />
              <div
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                  isChecked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-zinc-700 bg-zinc-800"
                }`}
              >
                {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
              </div>
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// 4. Custom Switch Component (Active Only toggle)
function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = `switch-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/20 p-3 transition-colors hover:border-zinc-700">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-semibold text-zinc-200 cursor-pointer">{label}</label>
        {description && <span className="text-xs text-zinc-500" id={`${id}-desc`}>{description}</span>}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="sr-only focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
      />
      <div
        aria-hidden="true"
        className={`relative h-6 w-11 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
          checked ? "bg-primary" : "bg-zinc-800"
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`h-5 w-5 rounded-full bg-zinc-100 shadow transition-transform duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </div>
    </div>
  );
}

// 6. Premium Styled Empty State
// Marketplace-specific empty state replaced by shared EmptyState component

// ─── Marketplace Content (State & Layout) ───────────────────────────────────

function MarketplaceContent() {
  const t = useTranslations("marketplace");
  const comparisonEnabled = useFeatureFlag("comparison");
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryOptions = useMemo(() => getCategoryOptions(t), [t]);
  const jurisdictionOptions = useMemo(() => getJurisdictionOptions(t), [t]);
  const sortOptions = useMemo(() => getSortOptions(t), [t]);

  // Zustand Store
  const {
    filters,
    sortBy,
    searchQuery,
    searchHistory,
    setFilters,
    updateSingleFilter,
    resetFilters,
    setSortBy,
    setSearchQuery,
    clearSearchHistory,
    setInvoices,
    toggleComparison,
    setComparisonList,
  } = useInvoiceStore();
  const comparisonList = useInvoiceStore((s) => s.comparisonList);

  // Active filters count — computed early so analytics hooks can reference it.
  const activeFiltersCount =
    (filters.categories?.length || 0) +
    (filters.jurisdictions?.length || 0) +
    (filters.riskTiers?.length || 0) +
    (filters.aprRange && (filters.aprRange[0] > 0 || filters.aprRange[1] < 50) ? 1 : 0) +
    (filters.activeOnly ? 1 : 0) +
    (filters.showExpired ? 1 : 0);

  const [showFilters, setShowFilters] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const watchedCount = useInvoiceStore((state) => state.watchedInvoiceIds.length);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isUrlHydrated, setIsUrlHydrated] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pageSize, setPageSize] = useState(MARKETPLACE_PAGE_SIZE);
  const [comparisonAnchorIndex, setComparisonAnchorIndex] = useState(0);

  // Infinite loader — first page only until sentinel intersects
  const infinite = useInfiniteInvoices({
    pageSize,
    enabled: isUrlHydrated,
  });

  const isLoading = infinite.isLoading;
  const dataUpdatedAt = infinite.dataUpdatedAt;
  const isFetchingNextPage = infinite.isFetchingNextPage;
  const hasNextPage = Boolean(infinite.hasNextPage);
  const searchRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Close history dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 1. URL to Zustand Sync Loop (On Mount / Initial Hydration)
  /* Hydrates the client-side Zustand store with initial filters parsed from the URL search queries */
  useEffect(() => {
    if (isUrlHydrated) return;

    const categories = searchParams.get("categories")?.split(",").filter(Boolean) || [];
    const jurisdictions = searchParams.get("jurisdictions")?.split(",").filter(Boolean) || [];
    const riskTiers = searchParams.get("riskTiers")?.split(",").filter(Boolean) || [];
    
    const minApr = searchParams.get("minApr") ? Number(searchParams.get("minApr")) : 0;
    const maxApr = searchParams.get("maxApr") ? Number(searchParams.get("maxApr")) : 50;
    
    const activeOnly = searchParams.get("activeOnly") === "true";
    const showExpired = searchParams.get("showExpired") === "true" || searchParams.get("showExpired") === "1";
    const sortByParam = searchParams.get("sortBy") || "apr_desc";
    const qParam = sanitizeQueryParam(searchParams.get("q"));

    const urlPageSize = Number(searchParams.get("pageSize") || MARKETPLACE_PAGE_SIZE);

    setPageSize(
      Number.isFinite(urlPageSize) && urlPageSize > 0
        ? urlPageSize
        : MARKETPLACE_PAGE_SIZE
    );

    setFilters({
      categories,
      jurisdictions,
      riskTiers,
      aprRange: [minApr, maxApr],
      activeOnly,
      showExpired,
    });
    setSortBy(sortByParam);
    setSearchQuery(qParam);

    setIsUrlHydrated(true);
  }, [searchParams, isUrlHydrated, setFilters, setSortBy, setSearchQuery]);

  // ── Analytics: fire marketplace_land on deep-link visits (#563) ───────────
  // Runs once after URL hydration so filter_count reflects the resolved state.
  useEffect(() => {
    if (!isUrlHydrated) return;
    const currentParams = new URLSearchParams(window.location.search);
    trackMarketplaceLand(currentParams, activeFiltersCount, sortBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUrlHydrated]);

  // 2. Debouncing Changes to Prevent URL History Thrashing
  const debouncedFilters = useDebounce(filters, 400);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // 3. Zustand to URL Sync Loop (On Change) — filters/sort only; pages load via infinite scroll
  /* Serializes active filters and pushes the resulting query string to the browser address bar */
  useEffect(() => {
    if (!isUrlHydrated) return;

    const params = new URLSearchParams();

    if (debouncedFilters.categories && debouncedFilters.categories.length > 0) {
      params.set("categories", debouncedFilters.categories.join(","));
    }
    if (debouncedFilters.jurisdictions && debouncedFilters.jurisdictions.length > 0) {
      params.set("jurisdictions", debouncedFilters.jurisdictions.join(","));
    }
    if (debouncedFilters.riskTiers && debouncedFilters.riskTiers.length > 0) {
      params.set("riskTiers", debouncedFilters.riskTiers.join(","));
    }
    if (debouncedFilters.aprRange) {
      const [min, max] = debouncedFilters.aprRange;
      if (min > 0) params.set("minApr", min.toString());
      if (max < 50) params.set("maxApr", max.toString());
    }
    if (debouncedFilters.activeOnly) {
      params.set("activeOnly", "true");
    }
    if (debouncedFilters.showExpired) {
      params.set("showExpired", "true");
    }
    if (debouncedSearchQuery) {
      params.set("q", debouncedSearchQuery);
    }
    if (sortBy && sortBy !== "apr_desc") {
      params.set("sortBy", sortBy);
    }
    if (pageSize !== MARKETPLACE_PAGE_SIZE) {
      params.set("pageSize", String(pageSize));
    }

    const queryString = params.toString();
    const targetUrl = queryString ? `/marketplace?${queryString}` : "/marketplace";

    router.replace(targetUrl, { scroll: false });
  }, [debouncedFilters, debouncedSearchQuery, sortBy, isUrlHydrated, router, pageSize]);

  // Use all pages loaded by the infinite query, deduplicated by invoice ID (#560)
  const allInvoices = useMemo(() => {
    const rawPages = infinite.data?.pages.flatMap((p) => p.data) ?? [];
    const map = new Map<string, Invoice>();
    rawPages.forEach((inv) => {
      if (inv && inv.id) {
        map.set(inv.id, inv);
      }
    });
    return Array.from(map.values());
  }, [infinite.data]);

  // Keep store invoices in sync so comparison UI works with live indexer data
  useEffect(() => {
    if (allInvoices.length > 0) {
      setInvoices(allInvoices);
    }
  }, [allInvoices, setInvoices]);

  // Client-side Search filter
  const filteredInvoices = useMemo(() => {
    if (!debouncedSearchQuery) return allInvoices;
    const query = debouncedSearchQuery.toLowerCase();
    return allInvoices.filter(
      (inv) =>
        inv.metadata.debtorName.toLowerCase().includes(query) ||
        inv.metadata.invoiceNumber.toLowerCase().includes(query) ||
        inv.metadata.category.toLowerCase().includes(query) ||
        inv.metadata.issuerName.toLowerCase().includes(query)
    );
  }, [allInvoices, debouncedSearchQuery]);

  // Result-set fingerprint (Issue #1015). Sort order is intentionally excluded
  // so flipping "APR high→low / low→high" reorders in place instead of
  // bouncing the user back to the top of the grid.
  const filterFingerprint = useMemo(
    () => buildMarketplaceFilterFingerprint(filters, debouncedSearchQuery),
    [filters, debouncedSearchQuery]
  );

  const { activeIndex, setActiveIndex } = useRovingTabIndex(filteredInvoices.length);

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLAnchorElement>, index: number, invoiceId: string) => {
      if (!comparisonEnabled) return;
      const orderedIds = filteredInvoices.map((invoice) => invoice.id);
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = Math.min(index + 1, filteredInvoices.length - 1);
        if (event.shiftKey) {
          setComparisonList(
            buildRangeSelection(orderedIds, comparisonAnchorIndex, nextIndex, comparisonList)
          );
        }
        setActiveIndex(nextIndex);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = Math.max(index - 1, 0);
        if (event.shiftKey) {
          setComparisonList(
            buildRangeSelection(orderedIds, comparisonAnchorIndex, nextIndex, comparisonList)
          );
        }
        setActiveIndex(nextIndex);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(Math.max(filteredInvoices.length - 1, 0));
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        toggleComparison(invoiceId);
        setComparisonAnchorIndex(index);
      }
    },
    [
      comparisonAnchorIndex,
      comparisonEnabled,
      comparisonList,
      filteredInvoices,
      setActiveIndex,
      setComparisonList,
      toggleComparison,
    ]
  );

  // CSV Export handler (#559)
  const handleExportCsv = useCallback(() => {
    const rows = marketplaceInvoicesToExportRows(filteredInvoices);
    const filename = marketplaceExportFilename();
    exportCsv(rows, filename);
  }, [filteredInvoices]);


  // Responsive grid column count detection for virtual scroller
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const updateColumns = () => {
      if (typeof window === "undefined") return;
      const w = window.innerWidth;
      if (w < 640) setColumns(1);
      else if (w < 1024) setColumns(2);
      else setColumns(3);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  // Chunk filtered invoices into grid rows for virtual scrolling
  const virtualRows = useMemo(() => {
    const rows: Invoice[][] = [];
    for (let i = 0; i < filteredInvoices.length; i += columns) {
      rows.push(filteredInvoices.slice(i, i + columns));
    }
    return rows;
  }, [filteredInvoices, columns]);

  const virtualListRef = useRef<HTMLDivElement>(null);

  // TanStack's window virtualizer needs the list's document offset as
  // `scrollMargin`; otherwise row transforms are calculated against the
  // viewport top. Reading `virtualListRef.current?.offsetTop` during the first
  // render went stale whenever a filter bar expanded, the comparison bar
  // mounted, or the viewport/orientation changed (Issue #1014).
  //
  // Keep it in state, re-measured from the element's bounding box (robust for
  // nested scroll parents), and only commit when it actually moves so the
  // ResizeObserver cannot start a render loop.
  const [scrollMargin, setScrollMargin] = useState(0);

  const measureScrollMargin = useCallback(() => {
    const list = virtualListRef.current;
    if (!list || typeof window === "undefined") return;
    const next = Math.round(list.getBoundingClientRect().top + window.scrollY);
    setScrollMargin((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);

  const debouncedMeasureScrollMargin = useDebouncedCallback(
    measureScrollMargin,
    100
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }

    // Measure immediately so the first paint after mount uses the real offset.
    measureScrollMargin();

    const observer = new ResizeObserver(() => debouncedMeasureScrollMargin());
    // Body catches content above the list growing (filter sidebar, comparison
    // bar); the list itself catches row-height changes.
    observer.observe(document.body);
    if (virtualListRef.current) observer.observe(virtualListRef.current);

    const handleViewportResize = () => debouncedMeasureScrollMargin();
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", handleViewportResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);
      debouncedMeasureScrollMargin.cancel();
    };
  }, [
    debouncedMeasureScrollMargin,
    measureScrollMargin,
    comparisonEnabled,
    columns,
    isLoading,
    filteredInvoices.length,
  ]);

  // Estimate row height based on columns:
  // - 1 col (mobile)  → cards are wider, less vertical wrapping → ~500px
  // - 2 cols (tablet) → moderate height → ~460px
  // - 3 cols (desktop) → narrower cards, more wrapping → ~510px
  // measureElement corrects the estimate after render, so accuracy here only
  // affects the initial scroll-height calculation (no layout thrashing on filter).
  const estimatedRowHeight = columns === 1 ? 500 : columns === 2 ? 460 : 510;

  const rowVirtualizer = useWindowVirtualizer({
    count: virtualRows.length,
    estimateSize: () => estimatedRowHeight,
    overscan: columns === 1 ? 3 : 2,
    scrollMargin,
  });

  // The virtualizer snapshots options at construction; re-measure rows once the
  // margin settles so the first post-resize paint is not offset by the old one.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, scrollMargin]);

  // Issue #1015 — return to the top when the result set materially changes.
  // Sort-only changes are excluded from the fingerprint, so they reorder in
  // place; reduced-motion users get an instant jump instead of a smooth ride.
  const resetScrollToTop = useCallback(
    (behavior: "auto" | "smooth") => {
      rowVirtualizer.scrollToOffset(0, { behavior });
    },
    [rowVirtualizer]
  );

  useMarketplaceScrollReset({
    fingerprint: filterFingerprint,
    enabled: isUrlHydrated,
    reset: resetScrollToTop,
  });

  const renderFiltersList = () => (
    <div className="flex flex-col gap-6">
      {/* Category Multi-select */}
      <Select
        label={t("categories")}
        options={categoryOptions}
        value={filters.categories || []}
        onChange={(val) => updateSingleFilter("categories", val)}
        placeholder={t("allCategories")}
        isMulti={true}
        isSearchable={true}
        loading={isLoading}
      />

      {/* Jurisdiction Multi-select */}
      <Select
        label={t("jurisdictions")}
        options={jurisdictionOptions}
        value={filters.jurisdictions || []}
        onChange={(val) => updateSingleFilter("jurisdictions", val)}
        placeholder={t("allJurisdictions")}
        isMulti={true}
        isSearchable={true}
        loading={isLoading}
      />

      {/* Risk Tiers Checkbox Group */}
      <CheckboxGroup
        label={t("riskTier")}
        options={RISK_OPTIONS}
        selected={filters.riskTiers || []}
        onChange={(val) => updateSingleFilter("riskTiers", val)}
      />

      {/* APR range — shared RangeSlider (#678). The heading and live readout
          stay here rather than moving into the shared control: they are
          marketplace copy, and the e2e suite asserts on them. */}
      <div className="relative flex w-full flex-col gap-2">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <span id="apr-range-label">{t("aprRange")}</span>
          <span
            className="text-primary font-mono lowercase"
            aria-live="polite"
            aria-atomic="true"
          >
            {(filters.aprRange || [0, 50])[0]}% - {(filters.aprRange || [0, 50])[1]}%
          </span>
        </div>
        <div role="group" aria-labelledby="apr-range-label">
          <RangeSlider
            min={0}
            max={50}
            step={1}
            value={filters.aprRange || [0, 50]}
            onChange={(val) => updateSingleFilter("aprRange", val)}
            formatLabel={(v) => `${v}%`}
          />
        </div>
      </div>

      {/* Status Toggle Switch */}
      <Switch
        checked={!!filters.activeOnly}
        onChange={(val) => updateSingleFilter("activeOnly", val)}
        label={t("activeOnly")}
        description={t("activeOnlyDesc")}
      />

      <Switch
        checked={!!filters.showExpired}
        onChange={(val) => updateSingleFilter("showExpired", val)}
        label={t("showExpired")}
        description={t("showExpiredDesc")}
      />

      {/* Reset Button */}
      {activeFiltersCount > 0 && (
        <button
          onClick={resetFilters}
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 py-2.5 text-xs font-semibold text-zinc-350 hover:bg-zinc-900/60 hover:text-zinc-200 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("resetFilters")}
        </button>
      )}
    </div>
  );

  // Intersection Observer to load next page
  useEffect(() => {
    const el = sentinelRef.current ?? document.getElementById("infinite-sentinel");
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            void infinite.fetchNextPage();
          }
        });
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, infinite]);

  // Return full skeleton block while initializing from URL to avoid flashing default states
  if (!isUrlHydrated) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="mb-8 space-y-2">
          <Skeleton className="h-8 w-1/4" />
          <Skeleton className="h-4 w-1/6" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <InvoiceCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Container className="relative py-10 lg:px-8">
      {/* Background radial gradient mesh */}
      <div className="absolute inset-0 bg-mesh pointer-events-none z-0" />

      <div className="relative z-10">
        {/* Header Section */}
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-150 sm:text-4xl bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              {t("title")}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              {isLoading ? t("subtitle") : t("showing", { count: filteredInvoices.length })}
            </p>
            {/* Contextual stale badge — visible when offline and cache has data */}
            <StaleDataBadge updatedAt={dataUpdatedAt || null} className="mt-2" />
            {comparisonEnabled && (
              <p className="mt-2 text-xs text-zinc-500" aria-live="polite">
                Comparison selection: {comparisonList.length} selected. Use arrow keys to move, space to toggle, and Shift plus arrows to select a range.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              aria-label="Export active marketplace results to CSV"
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 transition-colors"
            >
              <Download className="h-4 w-4 text-emerald-400" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href).then(() => {
                  toast.success(t("shareFiltersCopied"));
                });
              }}
              aria-label="Copy marketplace filter link to clipboard"
              className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              {t("shareFilters")}
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={() => setWatchlistOpen(true)} leftIcon={<Star className="h-4 w-4" />}>
            Watchlist{watchedCount > 0 ? ` (${watchedCount})` : ""}
          </Button>
        </div>

        {/* Search + Sort + Toggle Bar */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1" ref={searchRef} data-tour="marketplace-search">
            <div className="relative">
              <label htmlFor="marketplace-search" className="sr-only">
                {t("searchAria")}
              </label>
              <Input
                id="marketplace-search"
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowHistory(true)}
                leftIcon={<Search className="h-4 w-4 text-zinc-500" />}
                className="bg-zinc-950/40 border-zinc-800/80 focus:border-primary/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setShowHistory(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  aria-label={t("clearSearch")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {showHistory && searchHistory.length > 0 && !searchQuery && (
                <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t("recent")}</span>
                    <button
                      type="button"
                      onClick={clearSearchHistory}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      {t("clear")}
                    </button>
                  </div>
                  {searchHistory.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => { setSearchQuery(h); setShowHistory(false); }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                    >
                      <Clock className="h-3.5 w-3.5 text-zinc-500" />
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2.5 shrink-0">
            {/* Filter Toggle for Mobile / Drawer triggers */}
            <Button
              variant="outline"
              onClick={() => setIsMobileDrawerOpen(true)}
              className="gap-2 border-zinc-850 hover:bg-zinc-900/60 lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4 text-zinc-400" />
              {t("filters")}
              {activeFiltersCount > 0 && (
                <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {activeFiltersCount}
                </span>
              )}
            </Button>

            {/* Desktop filter toggler (optional) */}
            <Button
              variant="outline"
              onClick={() => setShowFilters((v) => !v)}
              className="hidden lg:flex gap-2 border-zinc-850 hover:bg-zinc-900/60"
            >
              <SlidersHorizontal className="h-4 w-4 text-zinc-400" />
              {t("quickFilters")}
              {activeFiltersCount > 0 && (
                <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground animate-pulse">
                  {activeFiltersCount}
                </span>
              )}
            </Button>

            {/* Sort options select */}
            <div className="relative flex items-center">
              <ArrowUpDown className="absolute left-3 h-4 w-4 text-zinc-400 pointer-events-none" aria-hidden="true" />
              <label htmlFor="marketplace-sort" className="sr-only">Sort invoices</label>
              <select
                id="marketplace-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-10 w-48 rounded-lg border border-zinc-850 bg-zinc-950/40 pl-9 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer transition-all hover:bg-zinc-900/30"
              >
                {sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-950">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

          </div>
        </div>

        <div className="mb-8">
          <ActiveFilterChips
            filters={filters}
            sort={sort}
            presets={savedPresets}
            onSave={savePreset}
            onLoad={handleLoadPreset}
            onRename={renamePreset}
            onDelete={deletePreset}
          />
          <div className="mt-3">
            <PresetImportExport />
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        {/* Active filter chips — shown below the search/sort bar when filters are applied */}
        {activeFiltersCount > 0 && (
          <ActiveFilterChips className="mb-4" />
        )}

        {/* Aggregate APR Histogram & Risk Distribution Summary Bar (#561) */}
        {!isLoading && filteredInvoices.length > 0 && (
          <div className="mb-6 rounded-2xl border border-zinc-900 bg-zinc-950/40 p-5 backdrop-blur-md grid gap-6 md:grid-cols-2">
            <MarketplaceAprHistogram invoices={filteredInvoices} />
            <MarketplaceRiskDistribution
              invoices={filteredInvoices}
              selectedRiskTiers={filters.riskTiers || []}
              onRiskSegmentClick={(riskTier) => {
                const current = filters.riskTiers || [];
                const next = current.includes(riskTier)
                  ? current.filter((r) => r !== riskTier)
                  : [...current, riskTier];
                updateSingleFilter("riskTiers", next);
              }}
            />
          </div>
        )}

        <div className="flex flex-col gap-8 lg:flex-row">
          {/* A. Sticky Filter Sidebar (Desktop screens) */}
          <div className="hidden lg:block w-72 shrink-0">
            <div className="sticky top-24 rounded-2xl border border-zinc-900 bg-zinc-950/50 p-6 backdrop-blur-md shadow-lg space-y-6">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  {t("marketplaceFilters")}
                </h2>
                {activeFiltersCount > 0 && (
                  <Badge variant="kora" className="text-[10px] py-0">
                    {t("active", { count: activeFiltersCount })}
                  </Badge>
                )}
              </div>
              {renderFiltersList()}
            </div>
          </div>

          {/* B. Grid listing and states */}
          <div
            className="flex-1 min-w-0 space-y-6"
            onClick={(e) => {
              // Analytics: capture Fund Invoice CTA clicks via event delegation (#563)
              const target = e.target as HTMLElement;
              const isFundBtn =
                target.closest("[data-fund-cta]") !== null ||
                target.closest("button")?.textContent?.toLowerCase().includes("fund") === true;
              if (isFundBtn) {
                const currentParams = new URLSearchParams(window.location.search);
                trackMarketplaceFundCta(currentParams, activeFiltersCount, sortBy);
              }
            }}
          >
            {isLoading ? (
              <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(8)].map((_, i) => (
                  <InvoiceCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <EmptyState
                title={t("noResults")}
                description={t("noResultsDesc")}
                cta={{ label: t("clearAllFilters"), onClick: resetFilters }}
                variant="marketplace"
                suggestions={
                  hasRestrictiveFilters(filters)
                    ? deriveRecoveryActions(filters).map((action): RecoverySuggestion => ({
                        label: t(`recovery.${action.labelKey}` as Parameters<typeof t>[0]),
                        onClick: () => setFilters(action.apply(filters)),
                      }))
                    : undefined
                }
              />
            ) : (
              <>
                <div
                  ref={virtualListRef}
                  className="relative w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                  data-testid="virtual-invoice-list"
                  data-virtualized="true"
                  data-scroll-margin={scrollMargin}
                  aria-label={`Invoice grid, ${filteredInvoices.length} invoices`}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const rowInvoices = virtualRows[virtualRow.index];
                    return (
                      <div
                        key={virtualRow.key}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute top-0 left-0 w-full"
                        style={{
                          transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                        }}
                      >
                        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 mb-5">
                          {rowInvoices.map((invoice: Invoice, i: number) => (
                            <InvoiceCard
                              key={invoice.id}
                              invoice={invoice}
                              index={virtualRow.index * columns + i}
                              updatedAt={dataUpdatedAt}
                              tabIndex={comparisonEnabled ? (activeIndex === virtualRow.index * columns + i ? 0 : -1) : undefined}
                              onCardFocus={() => {
                                const cardIndex = virtualRow.index * columns + i;
                                setActiveIndex(cardIndex);
                                setComparisonAnchorIndex(cardIndex);
                              }}
                              onCardKeyDown={(event) =>
                                handleCardKeyDown(event, virtualRow.index * columns + i, invoice.id)
                              }
                              isSelectedForComparison={comparisonList.includes(invoice.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div
                    id="infinite-sentinel"
                    ref={sentinelRef}
                    aria-hidden="true"
                    className="h-4 w-full"
                  />
                  {isFetchingNextPage && (
                    <div className="mt-4 text-center text-sm text-muted-foreground">{t("loadingMore")}</div>
                  )}
                  {infinite.isError && (
                    <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
                      <p className="text-xs font-medium text-destructive">
                        {t("loadMoreFailed")}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => infinite.refetch()}
                        className="gap-2 border-destructive/40 text-xs text-destructive hover:bg-destructive/20"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("retryLoading")}
                      </Button>
                    </div>
                  )}

                  {!hasNextPage && filteredInvoices.length > 0 && (
                    <div className="mt-4 text-center text-sm text-muted-foreground">{t("allLoaded")}</div>
                  )}
                  <button
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    aria-label="Scroll back to top"
                    className="fixed right-4 bottom-12 rounded-full bg-primary px-3 py-2 text-sm text-primary-foreground"
                  >
                    {t("backToTop")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Filter Bottom Sheet */}
      <BottomSheet
        open={isMobileDrawerOpen}
        onOpenChange={setIsMobileDrawerOpen}
        title={t("filterInvoices")}
      >
        {renderFiltersList()}
      </BottomSheet>

      {/* Fixed comparison bar — renders above the page when invoices are selected */}
      {comparisonEnabled && <ComparisonBar />}
      <WatchlistDrawer open={watchlistOpen} onClose={() => setWatchlistOpen(false)} />
      <CategoryTaxonomyPreview invoices={allInvoices} />
    </Container>
  );
}

// default export utilizing Suspense boundary for useSearchParams compliance
export default function MarketplacePage() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
            <div className="mb-8 space-y-2">
              <Skeleton className="h-8 w-1/4" />
              <Skeleton className="h-4 w-1/6" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <InvoiceCardSkeleton key={i} />
              ))}
            </div>
          </div>
        }
      >
        <MarketplaceContent />
      </Suspense>
    </ErrorBoundary>
  );
}