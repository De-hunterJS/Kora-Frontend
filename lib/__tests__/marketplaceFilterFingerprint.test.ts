import { describe, it, expect } from "vitest";

import { buildMarketplaceFilterFingerprint } from "@/lib/marketplaceFilterFingerprint";
import type { FilterState } from "@/store/invoiceStore";

const base: FilterState = {
  categories: [],
  jurisdictions: [],
  riskTiers: [],
  aprRange: [0, 50],
  activeOnly: false,
  showExpired: false,
};

describe("buildMarketplaceFilterFingerprint", () => {
  it("is stable for equal filter state", () => {
    expect(buildMarketplaceFilterFingerprint(base)).toBe(
      buildMarketplaceFilterFingerprint({ ...base })
    );
  });

  it("is order-insensitive for multi-select arrays", () => {
    const a = buildMarketplaceFilterFingerprint({
      ...base,
      categories: ["technology", "healthcare"],
    });
    const b = buildMarketplaceFilterFingerprint({
      ...base,
      categories: ["healthcare", "technology"],
    });
    expect(a).toBe(b);
  });

  it("changes when a category is added", () => {
    expect(
      buildMarketplaceFilterFingerprint({ ...base, categories: ["technology"] })
    ).not.toBe(buildMarketplaceFilterFingerprint(base));
  });

  it("changes when the APR range changes", () => {
    expect(
      buildMarketplaceFilterFingerprint({ ...base, aprRange: [10, 40] })
    ).not.toBe(buildMarketplaceFilterFingerprint(base));
  });

  it("changes when boolean filters flip", () => {
    expect(
      buildMarketplaceFilterFingerprint({ ...base, activeOnly: true })
    ).not.toBe(buildMarketplaceFilterFingerprint(base));
    expect(
      buildMarketplaceFilterFingerprint({ ...base, showExpired: true })
    ).not.toBe(buildMarketplaceFilterFingerprint(base));
  });

  it("includes the search query", () => {
    expect(
      buildMarketplaceFilterFingerprint(base, "safaricom")
    ).not.toBe(buildMarketplaceFilterFingerprint(base, ""));
  });

  it("ignores surrounding whitespace in the search query", () => {
    expect(buildMarketplaceFilterFingerprint(base, "  safaricom ")).toBe(
      buildMarketplaceFilterFingerprint(base, "safaricom")
    );
  });
});
