"use client";

/**
 * ActiveFilterChips — renders a dismissible chip for each active filter.
 *
 * Constraints:
 *  - × button removes only that specific filter from invoiceStore immediately
 *  - "Clear all" removes all active filters at once
 *  - Must NOT cause full-page re-render — only the grid updates via store subscription
 *  - Chip removals are announced to screen readers via aria-live="polite"
 */

import React, { useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useInvoiceStore } from "@/store/invoiceStore";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

export interface FilterChip {
  /** Stable unique key, e.g. "category:technology" */
  key: string;
  /** Human-readable label, e.g. "Technology" */
  label: string;
  /** Which store filter key this chip belongs to */
  filterKey: keyof import("@/store/invoiceStore").FilterState;
  /** The value to remove from the filter array (undefined for boolean filters) */
  value?: string;
}

interface ActiveFilterChipsProps {
  /** Chips derived from the current filter state — passed in so the parent
   *  controls label formatting, but removal is handled by the store directly. */
  chips?: FilterChip[];
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * Derives chips from the Zustand filter state.
 * Exported so consumers can reuse without duplicating logic.
 */
export function deriveChips(
  filters: import("@/store/invoiceStore").FilterState,
  t?: (key: string) => string
): FilterChip[] {
  const chips: FilterChip[] = [];

  for (const cat of filters.categories) {
    chips.push({
      key: `category:${cat}`,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      filterKey: "categories",
      value: cat,
    });
  }

  for (const jur of filters.jurisdictions) {
    chips.push({
      key: `jurisdiction:${jur}`,
      label: jur,
      filterKey: "jurisdictions",
      value: jur,
    });
  }

  for (const tier of filters.riskTiers) {
    chips.push({
      key: `riskTier:${tier}`,
      label: `Risk: ${tier}`,
      filterKey: "riskTiers",
      value: tier,
    });
  }

  if (filters.aprRange[0] > 0 || filters.aprRange[1] < 50) {
    chips.push({
      key: "aprRange",
      label: `APR: ${filters.aprRange[0]}%–${filters.aprRange[1]}%`,
      filterKey: "aprRange",
    });
  }

  if (filters.activeOnly) {
    chips.push({
      key: "activeOnly",
      label: t ? t("activeOnly") : "Active Only",
      filterKey: "activeOnly",
    });
  }

  if (filters.showExpired) {
    chips.push({
      key: "showExpired",
      label: t ? t("showExpired") : "Show Expired",
      filterKey: "showExpired",
    });
  }

  return chips;
}

/**
 * Motion props for an individual chip. Extracted so the reduced-motion branch
 * is unit-testable without depending on Framer's animation timing in jsdom.
 *
 * When reduced motion is requested the chip still mounts/unmounts — it just
 * does so with zero-duration opacity changes instead of a scaled translate,
 * and the "Clear all" layout animation is dropped by the caller.
 */
export function getChipMotionProps(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return {
      initial: false as const,
      animate: { opacity: 1, scale: 1, y: 0 },
      exit: { opacity: 1, scale: 1, y: 0 },
      transition: { duration: 0 },
    };
  }

  return {
    initial: { opacity: 0, scale: 0.9, y: -4 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.9, y: -4 },
    transition: { duration: 0.15 },
  };
}

export default function ActiveFilterChips({
  chips: externalChips,
  className,
}: ActiveFilterChipsProps) {
  const t = useTranslations("marketplace");
  const { filters, updateSingleFilter, resetFilters } = useInvoiceStore();
  const announcerId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const chipMotion = getChipMotionProps(prefersReducedMotion);

  // Derive chips from store if not provided externally
  const chips = externalChips ?? deriveChips(filters, t);

  const handleRemove = (chip: FilterChip) => {
    const key = chip.filterKey;

    if (key === "categories" || key === "jurisdictions" || key === "riskTiers") {
      const current = filters[key] as string[];
      updateSingleFilter(key, current.filter((v) => v !== chip.value));
      return;
    }

    if (key === "aprRange") {
      updateSingleFilter("aprRange", [0, 50]);
      return;
    }

    if (key === "activeOnly") {
      updateSingleFilter("activeOnly", false);
      return;
    }

    if (key === "showExpired") {
      updateSingleFilter("showExpired", false);
    }
  };

  if (chips.length === 0) return null;

  return (
    <>
      {/* Screen-reader live region — announces filter removals without page reload */}
      <div
        id={announcerId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="filter-chips-announcer"
      />

      <div
        className={cn("mt-3 flex flex-wrap items-center gap-2", className)}
        role="group"
        aria-label="Active filters"
        data-testid="active-filter-chips"
        data-reduced-motion={prefersReducedMotion}
      >
        <AnimatePresence initial={false}>
          {chips.map((chip) => (
            <motion.div
              key={chip.key}
              {...chipMotion}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              <span>{chip.label}</span>
              <button
                type="button"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={() => {
                  handleRemove(chip);
                  // Announce to screen readers via the live region
                  const el = document.getElementById(announcerId);
                  if (el) el.textContent = `Filter "${chip.label}" removed`;
                }}
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full",
                  "text-primary/70 transition-colors",
                  "hover:bg-primary/20 hover:text-primary",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                )}
                data-testid={`remove-chip-${chip.key}`}
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Clear all */}
        <motion.button
          layout={!prefersReducedMotion}
          type="button"
          onClick={() => {
            resetFilters();
            const el = document.getElementById(announcerId);
            if (el) el.textContent = "All filters cleared";
          }}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium",
            "bg-destructive/10 text-destructive",
            "hover:bg-destructive/20 transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
          )}
          aria-label="Clear all active filters"
          data-testid="clear-all-filters"
        >
          Clear all
        </motion.button>
      </div>
    </>
  );
}
