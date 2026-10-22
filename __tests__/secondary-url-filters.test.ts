/**
 * Unit tests for secondary market URL filter persistence (#643).
 */

import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import arMessages from "@/messages/ar.json";
import ptBrMessages from "@/messages/pt-BR.json";
import {
  CATEGORIES,
  JURISDICTIONS,
  TENOR_OPTIONS,
  YIELD_OPTIONS,
} from "@/components/marketplace/filters";
import {
  parseTenorParam,
  parseYieldParam,
  parseTextParam,
  parseSecondaryFiltersFromSearchParams,
  secondaryFiltersToQueryString,
  DEFAULT_SECONDARY_FILTERS,
} from "@/lib/secondaryUrlFilters";

describe("secondaryUrlFilters (#643)", () => {
    it("defines every secondary filter label in all supported locales", () => {
      const locales = [enMessages, esMessages, arMessages, ptBrMessages] as const;

      for (const messages of locales) {
        const filters = messages.secondary.filters;
        for (const option of TENOR_OPTIONS) {
          expect(filters.tenor).toHaveProperty(option.labelKey);
        }
        for (const option of YIELD_OPTIONS) {
          expect(filters.yield).toHaveProperty(option.labelKey);
        }
        for (const jurisdiction of JURISDICTIONS) {
          expect(messages.marketplace.jurisdictionLabels).toHaveProperty(
            jurisdiction.labelKey,
          );
        }
        for (const category of CATEGORIES) {
          expect(messages.marketplace.categoryLabels).toHaveProperty(
            category.labelKey,
          );
        }
      }
    });

  it("falls back safely for invalid tenor and yield params", () => {
    expect(parseTenorParam("bogus")).toBe("all");
    expect(parseTenorParam("nope-90")).toBe("all");
    expect(parseYieldParam("999")).toBe("0");
    expect(parseYieldParam("abc")).toBe("0");
  });

  it("preserves valid tenor and yield params", () => {
    expect(parseTenorParam("0-30")).toBe("0-30");
    expect(parseTenorParam("90+")).toBe("90+");
    expect(parseYieldParam("10")).toBe("10");
    expect(parseYieldParam("15")).toBe("15");
  });

  it("sanitizes free-text params and strips control characters", () => {
    expect(parseTextParam("hello\u0000world")).toBe("helloworld");
    expect(parseTextParam(null)).toBe("");
  });

  it("hydrates filters from a shared URL search string", () => {
    const params = new URLSearchParams(
      "q=tech&tenor=31-60&yield=10&seller=GSELLER111&highlight=pos_101"
    );
    expect(parseSecondaryFiltersFromSearchParams(params)).toEqual({
      q: "tech",
      tenor: "31-60",
      yield: "10",
      seller: "GSELLER111",
      highlight: "pos_101",
    });
  });

  it("normalizes invalid params when hydrating from URL", () => {
    const params = new URLSearchParams("tenor=nope&yield=999&q=ok");
    expect(parseSecondaryFiltersFromSearchParams(params)).toEqual({
      ...DEFAULT_SECONDARY_FILTERS,
      q: "ok",
    });
  });

  it("omits defaults from the query string so reset clears URL params", () => {
    expect(secondaryFiltersToQueryString(DEFAULT_SECONDARY_FILTERS)).toBe("");
    expect(
      secondaryFiltersToQueryString({
        q: "agri",
        tenor: "0-30",
        yield: "5",
        seller: "GABC",
        highlight: "",
      })
    ).toBe("q=agri&tenor=0-30&yield=5&seller=GABC");
  });

  it("drops invalid select values when serializing to the URL", () => {
    expect(
      secondaryFiltersToQueryString({
        q: "",
        tenor: "invalid",
        yield: "bad",
        seller: "",
        highlight: "",
      })
    ).toBe("");
  });
});
