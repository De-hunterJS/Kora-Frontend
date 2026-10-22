import { useTranslations } from "next-intl";

export const JURISDICTIONS = [
  { code: "US", labelKey: "US", flag: "🇺🇸" },
  { code: "EU", labelKey: "EU", flag: "🇪🇺" },
  { code: "UK", labelKey: "UK", flag: "🇬🇧" },
  { code: "NG", labelKey: "NG", flag: "🇳🇬" },
  { code: "KE", labelKey: "KE", flag: "🇰🇪" },
  { code: "GH", labelKey: "GH", flag: "🇬🇭" },
  { code: "ZA", labelKey: "ZA", flag: "🇿🇦" },
  { code: "OTHER", labelKey: "OTHER", flag: "🌐" },
  { code: "IN", labelKey: "IN", flag: "🇮🇳" },
  { code: "BR", labelKey: "BR", flag: "🇧🇷" },
];

export const CATEGORIES = [
  { key: "manufacturing", labelKey: "manufacturing", icon: "🏭" },
  { key: "services", labelKey: "services", icon: "🛠️" },
  { key: "agriculture", labelKey: "agriculture", icon: "🌾" },
  { key: "technology", labelKey: "technology", icon: "💻" },
  { key: "healthcare", labelKey: "healthcare", icon: "🩺" },
  { key: "retail", labelKey: "retail", icon: "🛍️" },
  { key: "construction", labelKey: "construction", icon: "🏗️" },
  { key: "export", labelKey: "export", icon: "🚢" },
];

export interface PositionFilterState {
  minTenor?: number;
  maxTenor?: number;
  minYield?: number;
  sellerAddress?: string;
  category?: string;
  riskTier?: string;
}

export const TENOR_OPTIONS = [
  { value: "all", labelKey: "all" },
  { value: "0-30", labelKey: "0-30", min: 0, max: 30 },
  { value: "31-60", labelKey: "31-60", min: 31, max: 60 },
  { value: "61-90", labelKey: "61-90", min: 61, max: 90 },
  { value: "90+", labelKey: "90+", min: 91, max: 365 },
];

export const YIELD_OPTIONS = [
  { value: "0", labelKey: "0" },
  { value: "5", labelKey: "5" },
  { value: "10", labelKey: "10" },
  { value: "15", labelKey: "15" },
];

/**
 * Resolve a localized display label for a jurisdiction code while keeping the
 * stable code as the value used in URLs and filtering logic.
 */
export function useJurisdictionLabel() {
  const t = useTranslations("marketplace.jurisdictionLabels");
  return (code: string) => (t.has(code) ? t(code) : code);
}

/**
 * Resolve a localized display label for a category key while keeping the
 * stable key as the value used in URLs and filtering logic.
 */
export function useCategoryLabel() {
  const t = useTranslations("marketplace.categoryLabels");
  return (key: string) => (t.has(key) ? t(key) : key);
}

/**
 * Resolve a localized display label for a tenor option value while keeping the
 * stable value as the value used in URLs and filtering logic.
 */
export function useTenorLabel() {
  const t = useTranslations("secondary.filters.tenor");
  return (value: string) => (t.has(value) ? t(value) : value);
}

/**
 * Resolve a localized display label for a yield option value while keeping the
 * stable value as the value used in URLs and filtering logic.
 */
export function useYieldLabel() {
  const t = useTranslations("secondary.filters.yield");
  return (value: string) => (t.has(value) ? t(value) : value);
}
