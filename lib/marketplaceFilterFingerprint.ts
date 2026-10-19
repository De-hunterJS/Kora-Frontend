import type { FilterState } from "@/store/invoiceStore";

/**
 * Stable fingerprint of everything that changes the marketplace result set.
 *
 * Deliberately excludes the sort key/direction (Issue #1015): reordering the
 * same rows should not yank the user back to the top, but adding/removing a
 * filter should. Arrays are sorted so toggle order (or a URL round-trip) does
 * not produce a spurious "changed" signal.
 */
export function buildMarketplaceFilterFingerprint(
  filters: FilterState,
  searchQuery = ""
): string {
  const normalise = (values: string[] | undefined) =>
    [...(values ?? [])]
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();

  return JSON.stringify({
    categories: normalise(filters.categories),
    jurisdictions: normalise(filters.jurisdictions),
    riskTiers: normalise(filters.riskTiers),
    minApr: filters.aprRange?.[0] ?? 0,
    maxApr: filters.aprRange?.[1] ?? 50,
    activeOnly: Boolean(filters.activeOnly),
    showExpired: Boolean(filters.showExpired),
    q: searchQuery.trim(),
  });
}

export default buildMarketplaceFilterFingerprint;
