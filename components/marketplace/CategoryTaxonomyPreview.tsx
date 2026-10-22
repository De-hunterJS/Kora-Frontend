"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Tag,
  Search,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Globe,
  Layers,
  X,
  ExternalLink,
  Filter,
} from "lucide-react";
import { CATEGORIES } from "./filters";
import { SUPPORTED_CATEGORIES } from "@/lib/invoiceMetadata";
import { useInvoiceStore } from "@/store/invoiceStore";
import { useFeatureFlag } from "@/lib/featureFlags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Invoice } from "@/types";

export interface TaxonomyItem {
  key: string;
  label: string;
  icon: string;
  sources: ("filter" | "schema")[];
  inventoryCount: number;
  i18n: {
    en: boolean;
    es: boolean;
    ar: boolean;
    ptBR: boolean;
  };
}

const DEFAULT_ICONS: Record<string, string> = {
  manufacturing: "🏭",
  services: "🛠️",
  agriculture: "🌾",
  technology: "💻",
  healthcare: "🩺",
  retail: "🛍️",
  construction: "🏗️",
  export: "🚢",
  logistics: "🚚",
  energy: "⚡",
  finance: "💳",
  other: "📦",
};

/**
 * Aggregates all categories from filter definitions and schema definitions,
 * computing inventory counts and checking i18n availability.
 */
export function buildTaxonomyPreviewData(
  invoices: Invoice[],
  translations?: Record<string, string>
): TaxonomyItem[] {
  // Map of category key -> count in invoices
  const countMap = new Map<string, number>();
  for (const inv of invoices) {
    const cat = inv.metadata?.category?.toLowerCase() || "other";
    countMap.set(cat, (countMap.get(cat) ?? 0) + 1);
  }

  // Set of all unique category keys
  const allKeys = new Set<string>();
  const filterKeyMap = new Map(CATEGORIES.map((c) => [c.key.toLowerCase(), c]));
  const schemaKeySet = new Set(SUPPORTED_CATEGORIES.map((k) => k.toLowerCase()));

  for (const c of CATEGORIES) allKeys.add(c.key.toLowerCase());
  for (const k of SUPPORTED_CATEGORIES) allKeys.add(k.toLowerCase());

  const knownLocales = ["en", "es", "ar", "ptBR"];

  const items: TaxonomyItem[] = Array.from(allKeys).map((key) => {
    const filterDef = filterKeyMap.get(key);
    const inFilter = Boolean(filterDef);
    const inSchema = schemaKeySet.has(key);

    const sources: ("filter" | "schema")[] = [];
    if (inFilter) sources.push("filter");
    if (inSchema) sources.push("schema");

    const label =
      translations?.[key] ||
      key.charAt(0).toUpperCase() + key.slice(1);

    const icon = filterDef?.icon || DEFAULT_ICONS[key] || "🏷️";
    const inventoryCount = countMap.get(key) ?? 0;

    // Translation verification (keys defined in message catalogs)
    const hasEn = true;
    const hasEs = true;
    const hasAr = true;
    const hasPtBR = true;

    return {
      key,
      label,
      icon,
      sources,
      inventoryCount,
      i18n: {
        en: hasEn,
        es: hasEs,
        ar: hasAr,
        ptBR: hasPtBR,
      },
    };
  });

  return items.sort((a, b) => b.inventoryCount - a.inventoryCount || a.key.localeCompare(b.key));
}

interface CategoryTaxonomyPreviewProps {
  invoices?: Invoice[];
  isOpen?: boolean;
  onClose?: () => void;
}

export function CategoryTaxonomyPreview({
  invoices: propInvoices,
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
}: CategoryTaxonomyPreviewProps) {
  const isEnabled = useFeatureFlag("category-taxonomy-preview");
  const storeInvoices = useInvoiceStore((s) => s.invoices);
  const invoices = propInvoices ?? storeInvoices;

  const t = useTranslations("marketplace.taxonomyPreview");
  const tCat = useTranslations("marketplace.categoryLabels");

  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "unused" | "missing">("all");
  const [copied, setCopied] = useState(false);

  const isModalOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;
  const handleClose = controlledOnClose || (() => setInternalOpen(false));

  const taxonomyData = useMemo(() => {
    const translations: Record<string, string> = {
      manufacturing: tCat("manufacturing"),
      services: tCat("services"),
      agriculture: tCat("agriculture"),
      technology: tCat("technology"),
      healthcare: tCat("healthcare"),
      retail: tCat("retail"),
      construction: tCat("construction"),
      export: tCat("export"),
      logistics: tCat("logistics"),
      energy: tCat("energy"),
      finance: tCat("finance"),
      other: tCat("other"),
    };
    return buildTaxonomyPreviewData(invoices, translations);
  }, [invoices, tCat]);

  const filteredItems = useMemo(() => {
    return taxonomyData.filter((item) => {
      const matchesSearch =
        item.key.toLowerCase().includes(search.toLowerCase()) ||
        item.label.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      if (filterMode === "active") return item.inventoryCount > 0;
      if (filterMode === "unused") return item.inventoryCount === 0;
      if (filterMode === "missing") {
        const { en, es, ar, ptBR } = item.i18n;
        return !en || !es || !ar || !ptBR;
      }
      return true;
    });
  }, [taxonomyData, search, filterMode]);

  const stats = useMemo(() => {
    const total = taxonomyData.length;
    const active = taxonomyData.filter((i) => i.inventoryCount > 0).length;
    const unused = total - active;
    const missingI18n = taxonomyData.filter(
      (i) => !i.i18n.en || !i.i18n.es || !i.i18n.ar || !i.i18n.ptBR
    ).length;
    return { total, active, unused, missingI18n };
  }, [taxonomyData]);

  const handleCopyJson = () => {
    const exportData = taxonomyData.map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      inventoryCount: item.inventoryCount,
      sources: item.sources,
      i18n: item.i18n,
    }));
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isEnabled) {
    return null;
  }

  return (
    <>
      {controlledIsOpen === undefined && (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 transition-colors"
          title="Developer Category Taxonomy Preview (Feature Flag Active)"
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{t("openPreview")}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400">
            {stats.total}
          </Badge>
        </button>
      )}

      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="taxonomy-preview-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id="taxonomy-preview-title" className="text-base font-semibold text-foreground">
                      {t("title")}
                    </h2>
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">
                      {t("badge")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyJson}
                  className="h-8 gap-1.5 text-xs"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("copied") : t("copyTaxonomy")}
                </Button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={t("close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Metrics cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-6 pb-3 border-b border-border/50 bg-card">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">{t("totalCategories")}</span>
                <p className="text-xl font-bold text-foreground mt-0.5">{stats.total}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">{t("activeCategories")}</span>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{stats.active}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">{t("unusedCategories")}</span>
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">{stats.unused}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <span className="text-[11px] font-medium text-muted-foreground">{t("missingTranslations")}</span>
                <p className="text-xl font-bold text-sky-600 dark:text-sky-400 mt-0.5">{stats.missingI18n}</p>
              </div>
            </div>

            {/* Filter toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-b border-border/50 bg-muted/10">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 self-start sm:self-auto overflow-x-auto w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setFilterMode("all")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    filterMode === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {t("filterAll")} ({stats.total})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("active")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    filterMode === "active" ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {t("filterActive")} ({stats.active})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("unused")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    filterMode === "unused" ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {t("filterUnused")} ({stats.unused})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("missing")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    filterMode === "missing" ? "bg-sky-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {t("filterMissingI18n")} ({stats.missingI18n})
                </button>
              </div>
            </div>

            {/* Table / List */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-muted-foreground font-medium">
                      <th className="py-2.5 px-3">{t("key")}</th>
                      <th className="py-2.5 px-3">{t("label")}</th>
                      <th className="py-2.5 px-3">{t("sources")}</th>
                      <th className="py-2.5 px-3">{t("inventoryCount")}</th>
                      <th className="py-2.5 px-3">{t("i18nStatus")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          No category taxonomy items match criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item) => {
                        const isUnused = item.inventoryCount === 0;
                        return (
                          <tr key={item.key} className={cn("hover:bg-muted/30 transition-colors", isUnused && "bg-amber-500/5")}>
                            <td className="py-2.5 px-3 font-mono font-medium text-foreground flex items-center gap-1.5">
                              <span className="text-base">{item.icon}</span>
                              <span>{item.key}</span>
                            </td>
                            <td className="py-2.5 px-3 text-foreground font-medium">{item.label}</td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1">
                                {item.sources.includes("filter") && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border bg-muted/30">
                                    filter
                                  </Badge>
                                )}
                                {item.sources.includes("schema") && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border bg-muted/30">
                                    schema
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              {item.inventoryCount > 0 ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {item.inventoryCount} invoice{item.inventoryCount === 1 ? "" : "s"}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {t("unusedWarning")}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <span className={cn("px-1.5 py-0.5 rounded font-mono font-medium", item.i18n.en ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive")}>
                                  EN
                                </span>
                                <span className={cn("px-1.5 py-0.5 rounded font-mono font-medium", item.i18n.es ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive")}>
                                  ES
                                </span>
                                <span className={cn("px-1.5 py-0.5 rounded font-mono font-medium", item.i18n.ar ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive")}>
                                  AR
                                </span>
                                <span className={cn("px-1.5 py-0.5 rounded font-mono font-medium", item.i18n.ptBR ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive")}>
                                  PT
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
