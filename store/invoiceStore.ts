import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Invoice, InvoiceFunding, InvoiceStatus } from "@/types";
import type { InvoiceDetailsStepSchema } from "@/lib/validations/invoice";
import {
  createPersistentJSONStorage,
  safeStorageGetItem,
  safeStorageSetItem,
} from "./storageAdapter";
import {
  normalizeComparisonList,
  toggleComparisonId,
} from "@/lib/comparison";
import { useSettingsStore } from "./settingsStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FilterState {
  categories: string[];
  jurisdictions: string[];
  riskTiers: string[];
  aprRange: [number, number];
  activeOnly: boolean;
  showExpired: boolean;
}

export interface SortState {
  sortBy: "apr" | "amount" | "dueDate" | "listed";
  sortDir: "asc" | "desc";
}

export interface SavedMarketplacePreset {
  id: string;
  name: string;
  filters: FilterState;
  sort: SortState;
  createdAt: string;
}

export type InvoiceCreateDraft = Partial<InvoiceDetailsStepSchema> & {
  currency?: "USDC" | "EURC" | "XLM";
  issueDate?: string;
  discountRate?: number;
  minInvestment?: number;
  listingExpiryDate?: string;
  description?: string;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS: FilterState = {
  categories: [],
  jurisdictions: [],
  riskTiers: [],
  aprRange: [0, 50],
  activeOnly: false,
  showExpired: false,
};

const DEFAULT_SORT: SortState = { sortBy: "apr", sortDir: "desc" };
export const MAX_WATCHLIST_ITEMS = 50;
export const MAX_SAVED_PRESETS = 20;

/**
 * @deprecated Watchlist alert preferences are owned by `settingsStore`. This
 * shape is retained for the legacy setter shim below; read
 * `useSettingsStore((s) => s.notifications)` instead.
 */
export interface NotificationPreferences {
  fundingProgress: boolean;
  status: boolean;
  apr: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  fundingProgress: true,
  status: true,
  apr: false,
};

// ─── Pure selector ────────────────────────────────────────────────────────────

export function getFilteredInvoices(
  invoices: Invoice[],
  filters: FilterState,
  sort: SortState,
  searchQuery = ""
): Invoice[] {
  let result = invoices;

  if (filters.categories.length > 0) {
    result = result.filter((i) => filters.categories.includes(i.metadata.category));
  }
  if (filters.jurisdictions.length > 0) {
    result = result.filter((i) => filters.jurisdictions.includes(i.metadata.jurisdiction));
  }
  if (filters.riskTiers.length > 0) {
    result = result.filter((i) => filters.riskTiers.includes(i.riskTier));
  }
  const [minApr, maxApr] = filters.aprRange;
  result = result.filter((i) => i.terms.apr >= minApr && i.terms.apr <= maxApr);
  if (filters.activeOnly) {
    result = result.filter((i) => i.status === "listed" || i.status === "partially_funded");
  }
  
  // Filter by expiry status
  if (!filters.showExpired) {
    const now = new Date();
    result = result.filter((i) => {
      if (i.status === "cancelled") return false;
      if (!i.listingExpiry) return true;
      return new Date(i.listingExpiry) > now;
    });
  }
  
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    result = result.filter(
      (i) =>
        i.metadata.debtorName.toLowerCase().includes(q) ||
        i.metadata.invoiceNumber.toLowerCase().includes(q) ||
        i.metadata.jurisdiction.toLowerCase().includes(q)
    );
  }

  return [...result].sort((a, b) => {
    let aVal: number, bVal: number;
    switch (sort.sortBy) {
      case "apr":
        aVal = a.terms.apr; bVal = b.terms.apr; break;
      case "amount":
        aVal = a.metadata.amount; bVal = b.metadata.amount; break;
      case "dueDate":
        aVal = new Date(a.metadata.dueDate).getTime();
        bVal = new Date(b.metadata.dueDate).getTime();
        break;
      case "listed":
      default:
        aVal = new Date(a.createdAt).getTime();
        bVal = new Date(b.createdAt).getTime();
    }
    return sort.sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });
}

type FilterCacheEntry = {
  invoicesRef: Invoice[];
  filters: FilterState;
  sort: SortState;
  searchQuery: string;
  result: Invoice[];
};

let filterCache: FilterCacheEntry | null = null;

function readFilteredInvoices(
  invoices: Invoice[],
  filters: FilterState,
  sort: SortState,
  searchQuery: string
): Invoice[] {
  if (
    filterCache &&
    filterCache.invoicesRef === invoices &&
    filterCache.filters === filters &&
    filterCache.sort === sort &&
    filterCache.searchQuery === searchQuery
  ) {
    return filterCache.result;
  }

  const result = getFilteredInvoices(invoices, filters, sort, searchQuery);
  filterCache = { invoicesRef: invoices, filters, sort, searchQuery, result };
  return result;
}

/** React hook — memoized filtered invoice list keyed on store filter state. */
export function useFilteredInvoices(): Invoice[] {
  const { invoices, filters, sort, searchQuery } = useInvoiceStore(
    useShallow((state) => ({
      invoices: state.invoices,
      filters: state.filters,
      sort: state.sort,
      searchQuery: state.searchQuery,
    }))
  );

  return useMemo(
    () => getFilteredInvoices(invoices, filters, sort, searchQuery),
    [invoices, filters, sort, searchQuery]
  );
}

// ─── URL serialization ────────────────────────────────────────────────────────

export function toQueryParams(
  filters: FilterState,
  sort: SortState,
  searchQuery = ""
): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.categories.length) p.set("categories", filters.categories.join(","));
  if (filters.jurisdictions.length) p.set("jurisdictions", filters.jurisdictions.join(","));
  if (filters.riskTiers.length) p.set("riskTiers", filters.riskTiers.join(","));
  if (filters.aprRange[0] !== 0) p.set("aprMin", String(filters.aprRange[0]));
  if (filters.aprRange[1] !== 50) p.set("aprMax", String(filters.aprRange[1]));
  if (filters.activeOnly) p.set("activeOnly", "1");
  if (filters.showExpired) p.set("showExpired", "1");
  if (sort.sortBy !== "apr") p.set("sortBy", sort.sortBy);
  if (sort.sortDir !== "desc") p.set("sortDir", sort.sortDir);
  if (searchQuery.trim()) p.set("q", searchQuery.trim());
  return p;
}

/** Serialized filter state as a shareable `?a=b` string — empty when nothing is active. */
export function toQueryString(
  filters: FilterState,
  sort: SortState,
  searchQuery = ""
): string {
  return toQueryParams(filters, sort, searchQuery).toString();
}

export function fromQueryParams(params: URLSearchParams): {
  filters: FilterState;
  sort: SortState;
  searchQuery: string;
} {
  const aprMin = Number(params.get("aprMin") ?? 0);
  const aprMax = Number(params.get("aprMax") ?? 50);
  return {
    filters: {
      categories: params.get("categories")?.split(",").filter(Boolean) ?? [],
      jurisdictions: params.get("jurisdictions")?.split(",").filter(Boolean) ?? [],
      riskTiers: params.get("riskTiers")?.split(",").filter(Boolean) ?? [],
      aprRange: [
        Number.isFinite(aprMin) ? aprMin : 0,
        Number.isFinite(aprMax) ? aprMax : 50,
      ],
      activeOnly: params.get("activeOnly") === "1",
      showExpired: params.get("showExpired") === "1",
    },
    sort: {
      sortBy: (params.get("sortBy") as SortState["sortBy"]) ?? "apr",
      sortDir: (params.get("sortDir") as SortState["sortDir"]) ?? "desc",
    },
    searchQuery: params.get("q") ?? "",
  };
}

export function serializePresets(presets: SavedMarketplacePreset[]): string {
  return JSON.stringify(presets);
}

export function hydratePresets(value: unknown): SavedMarketplacePreset[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter((preset): preset is SavedMarketplacePreset => {
    if (!preset || typeof preset !== "object") return false;
    const candidate = preset as SavedMarketplacePreset;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.createdAt === "string" &&
      !!candidate.filters &&
      Array.isArray(candidate.filters.categories) &&
      Array.isArray(candidate.filters.jurisdictions) &&
      Array.isArray(candidate.filters.riskTiers) &&
      Array.isArray(candidate.filters.aprRange) &&
      typeof candidate.filters.activeOnly === "boolean" &&
      typeof candidate.filters.showExpired === "boolean" &&
      !!candidate.sort &&
      ["apr", "amount", "dueDate", "listed"].includes(candidate.sort.sortBy) &&
      ["asc", "desc"].includes(candidate.sort.sortDir)
    );
  }).slice(0, MAX_SAVED_PRESETS);
}

// ─── Preset import/export (portable artifact) ────────────────────────────────
// Serialized artifact shape: `{ "version": 1, "presets": SavedMarketplacePreset[] }`.
// A bare array is also accepted for forward/backward compatibility. Unknown
// fields on a preset are tolerated and stripped on import.

/** Reject pasted/file payloads larger than 64 KiB (fail closed). */
export const MAX_PRESET_IMPORT_BYTES = 64 * 1024;
/** Current version of the portable preset artifact envelope. */
export const PRESET_ARTIFACT_VERSION = 1;
const MAX_PRESET_NAME_LENGTH = 80;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function sanitizePreset(candidate: unknown): SavedMarketplacePreset | null {
  if (!candidate || typeof candidate !== "object") return null;
  const p = candidate as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id) return null;
  if (typeof p.name !== "string" || !p.name.trim()) return null;
  if (typeof p.createdAt !== "string" || !p.createdAt) return null;
  const f = p.filters as Record<string, unknown> | null;
  const s = p.sort as Record<string, unknown> | null;
  if (!f || !s) return null;
  if (!isStringArray(f.categories) || !isStringArray(f.jurisdictions) || !isStringArray(f.riskTiers)) return null;
  if (!Array.isArray(f.aprRange) || f.aprRange.length !== 2) return null;
  const [minApr, maxApr] = f.aprRange as unknown[];
  if (typeof minApr !== "number" || typeof maxApr !== "number") return null;
  if (!Number.isFinite(minApr) || !Number.isFinite(maxApr)) return null;
  if (typeof f.activeOnly !== "boolean" || typeof f.showExpired !== "boolean") return null;
  if (!["apr", "amount", "dueDate", "listed"].includes(s.sortBy as string)) return null;
  if (!["asc", "desc"].includes(s.sortDir as string)) return null;
  return {
    id: p.id,
    name: p.name.trim().slice(0, MAX_PRESET_NAME_LENGTH),
    filters: {
      categories: [...(f.categories as string[])],
      jurisdictions: [...(f.jurisdictions as string[])],
      riskTiers: [...(f.riskTiers as string[])],
      aprRange: [minApr, maxApr],
      activeOnly: f.activeOnly as boolean,
      showExpired: f.showExpired as boolean,
    },
    sort: { sortBy: s.sortBy as SortState["sortBy"], sortDir: s.sortDir as SortState["sortDir"] },
    createdAt: p.createdAt,
  };
}

export interface PresetImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

/**
 * Strictly validate an untrusted preset artifact before hydration.
 * Returns sanitized presets plus counts, or an actionable `error` (fail closed).
 */
export function parsePresetImport(raw: string): { presets: SavedMarketplacePreset[] } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "Paste exported preset JSON or choose a file to import." };
  }
  if (new TextEncoder().encode(raw).length > MAX_PRESET_IMPORT_BYTES) {
    return { error: `Import is larger than ${MAX_PRESET_IMPORT_BYTES / 1024} KiB — refusing to parse.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Invalid JSON — export presets again and retry." };
  }
  // Accept both the versioned envelope and a bare array (older exports).
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { presets?: unknown }).presets;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const version = (parsed as { version?: unknown }).version;
    if (version !== undefined && version !== PRESET_ARTIFACT_VERSION) {
      return { error: `Unsupported preset version ${String(version)} — expected version ${PRESET_ARTIFACT_VERSION}.` };
    }
  }
  if (!Array.isArray(list)) {
    return { error: "Preset file must contain a list of presets." };
  }
  if (list.length === 0) {
    return { error: "No presets found in this file." };
  }
  if (list.length > MAX_SAVED_PRESETS) {
    return { error: `Too many presets (${list.length}) — maximum is ${MAX_SAVED_PRESETS}.` };
  }
  const presets: SavedMarketplacePreset[] = [];
  for (let i = 0; i < list.length; i++) {
    const clean = sanitizePreset(list[i]);
    if (!clean) {
      return { error: `Preset #${i + 1} is invalid (needs id, name, filters, sort) — import aborted, nothing changed.` };
    }
    presets.push(clean);
  }
  return { presets };
}

/** Build a shareable artifact string for the given presets. */
export function buildPresetArtifact(presets: SavedMarketplacePreset[]): string {
  return JSON.stringify({ version: PRESET_ARTIFACT_VERSION, presets });
}

/**
 * Merge imported presets into existing ones without wiping unrelated state.
 * Same-id presets are skipped; duplicate names get a numeric suffix.
 */
export function mergePresets(
  existing: SavedMarketplacePreset[],
  incoming: SavedMarketplacePreset[]
): { merged: SavedMarketplacePreset[]; imported: number; skipped: number } {
  const merged = [...existing];
  const ids = new Set(existing.map((p) => p.id));
  const names = new Set(existing.map((p) => p.name.toLowerCase()));
  let imported = 0;
  let skipped = 0;
  for (const preset of incoming) {
    if (ids.has(preset.id)) {
      skipped++;
      continue;
    }
    let name = preset.name;
    let n = 2;
    while (names.has(name.toLowerCase())) {
      name = `${preset.name} (${n++})`;
    }
    if (merged.length >= MAX_SAVED_PRESETS) {
      skipped++;
      continue;
    }
    ids.add(preset.id);
    names.add(name.toLowerCase());
    merged.push({ ...preset, name });
    imported++;
  }
  return { merged, imported, skipped };
}

// ─── Store ────────────────────────────────────────────────────────────────────

const SEARCH_HISTORY_KEY = "kora-search-history";
const MAX_HISTORY = 5;

function loadSearchHistory(): string[] {
  try {
    return JSON.parse(safeStorageGetItem(SEARCH_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSearchHistory(history: string[]) {
  safeStorageSetItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

type FundingBackup = InvoiceFunding & { status: InvoiceStatus };

interface InvoiceStore {
  invoices: Invoice[];
  /** tokenId → Invoice map, maintained by batch polling */
  invoicesByTokenId: Record<string, Invoice>;
  filters: FilterState;
  sort: SortState;
  sortBy: string;
  searchQuery: string;
  searchHistory: string[];
  selectedInvoice: Invoice | null;
  createDraft: InvoiceCreateDraft;
  watchedInvoiceIds: string[];
  /** @deprecated Owned by `settingsStore`; kept only for the legacy setter shim. */
  notificationPreferences: NotificationPreferences;
  savedPresets: SavedMarketplacePreset[];

  /** IDs of invoices selected for side-by-side comparison (max 4) */
  comparisonList: string[];

  // Actions
  setInvoices: (invoices: Invoice[]) => void;
  /** Merge a batch of invoices into invoicesByTokenId (and sync invoices array). */
  mergeInvoicesBatch: (batch: Invoice[]) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  updateSingleFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;
  setSort: (sort: Partial<SortState>) => void;
  setSortBy: (sortBy: string) => void;
  savePreset: (name: string) => SavedMarketplacePreset | null;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  loadPreset: (id: string) => boolean;
  /** Portable export of saved presets (versioned JSON artifact). */
  exportPresetsText: () => string;
  /** Validate + merge a portable artifact; never wipes unrelated state. */
  importPresets: (raw: string) => PresetImportResult;
  setSearchQuery: (q: string) => void;
  clearSearchHistory: () => void;
  setSelectedInvoice: (invoice: Invoice | null) => void;
  upsertInvoice: (invoice: Invoice) => void;
  toggleWatchedInvoice: (id: string) => boolean;
  isInvoiceWatched: (id: string) => boolean;
  /** @deprecated Writes through to the canonical `settingsStore`. */
  setNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  updateInvoiceFunding: (id: string, newAmount: number) => void;
  rollbackInvoiceFunding: (id: string) => void;
  updateInvoiceStatus: (id: string, status: Invoice["status"]) => void;
  rollbackInvoiceStatus: (id: string) => void;
  // internal backup map (not persisted)
  _fundingBackup?: Record<string, FundingBackup>;
  _statusBackup?: Record<string, { status: Invoice["status"] }>;
  setCreateDraft: (draft: Partial<InvoiceCreateDraft>) => void;
  clearCreateDraft: () => void;

  /** Toggle an invoice in/out of the comparison list (max 4) */
  toggleComparison: (id: string) => void;
  /** Replace comparison list after keyboard range selection or URL hydration. */
  setComparisonList: (ids: string[]) => void;
  /** Remove a single invoice from the comparison list */
  removeFromComparison: (id: string) => void;
  /** Clear the entire comparison list */
  clearComparison: () => void;

  // Derived
  getFiltered: () => Invoice[];
}

export const useInvoiceStore = create<InvoiceStore>()(
  persist(
    (set, get) => ({
      invoices: [],
      invoicesByTokenId: {},
      filters: DEFAULT_FILTERS,
      sort: DEFAULT_SORT,
      sortBy: "apr_desc",
      searchQuery: "",
      searchHistory: loadSearchHistory(),
      selectedInvoice: null,
      createDraft: { currency: "USDC" },
      comparisonList: [],
      savedPresets: [],

      setInvoices: (invoices) => set({ invoices }),

      mergeInvoicesBatch: (batch) =>
        set((s) => {
          const byTokenId = { ...s.invoicesByTokenId };
          for (const inv of batch) {
            byTokenId[inv.tokenId] = inv;
          }
          // Merge into main invoices array: update existing entries, append new ones
          const existingIds = new Set(s.invoices.map((i) => i.tokenId));
          const merged = s.invoices.map((inv) =>
            byTokenId[inv.tokenId] ? byTokenId[inv.tokenId] : inv
          );
          for (const inv of batch) {
            if (!existingIds.has(inv.tokenId)) merged.push(inv);
          }
          return { invoicesByTokenId: byTokenId, invoices: merged };
        }),

      setFilters: (filters) =>
        set((s) => ({ filters: { ...s.filters, ...filters } })),

      updateSingleFilter: (key, value) =>
        set((s) => ({ filters: { ...s.filters, [key]: value } })),

      resetFilters: () =>
        set({ filters: DEFAULT_FILTERS, searchQuery: "", sortBy: "apr_desc", sort: DEFAULT_SORT }),

      setSort: (sort) =>
        set((s) => ({ sort: { ...s.sort, ...sort }, sortBy: sort.sortBy ?? s.sort.sortBy })),

      setSortBy: (sortBy) =>
        set((s) => ({
          sort: { ...s.sort, sortBy: sortBy.split("_")[0] as SortState["sortBy"] },
          sortBy,
        })),

      setSearchQuery: (searchQuery) =>
        set((s) => {
          const trimmed = searchQuery.trim();
          let history = s.searchHistory;
          if (trimmed && !history.includes(trimmed)) {
            history = [trimmed, ...history].slice(0, MAX_HISTORY);
            saveSearchHistory(history);
          }
          return { searchQuery, searchHistory: history };
        }),

      clearSearchHistory: () => {
        saveSearchHistory([]);
        set({ searchHistory: [] });
      },

      setSelectedInvoice: (selectedInvoice) => set({ selectedInvoice }),

      upsertInvoice: (invoice) =>
        set((s) => ({
          invoices: s.invoices.some((item) => item.id === invoice.id)
            ? s.invoices.map((item) => (item.id === invoice.id ? invoice : item))
            : [...s.invoices, invoice],
        })),

      toggleWatchedInvoice: (id) => {
        let watched = false;
        set((s) => {
          watched = s.watchedInvoiceIds.includes(id);
          return {
            watchedInvoiceIds: watched
              ? s.watchedInvoiceIds.filter((item) => item !== id)
              : [...s.watchedInvoiceIds, id].slice(-MAX_WATCHLIST_ITEMS),
          };
        });
        return !watched;
      },

      isInvoiceWatched: (id) => get().watchedInvoiceIds.includes(id),

      // Deprecated shim: forward watchlist alert toggles to the canonical
      // `settingsStore` so they agree with the rest of the notification UI.
      setNotificationPreferences: (preferences) => {
        useSettingsStore.getState().setNotifications(preferences);
        set((s) => ({
          notificationPreferences: { ...s.notificationPreferences, ...preferences },
        }));
      },

      /** Optimistic update — instantly reflects new funding amount in UI */
      updateInvoiceFunding: (id, newAmount) =>
        set((s) => {
          const prev = s.invoices.find((i) => i.id === id);
          const backup = prev ? { ...prev.funding, status: prev.status } : undefined;
          const nextInvoices = s.invoices.map((inv) => {
            if (inv.id !== id) return inv;
            const totalRaised = Math.min(newAmount, inv.funding.targetAmount);
            const isFull = totalRaised >= inv.funding.targetAmount;
            return {
              ...inv,
              status: isFull ? "fully_funded" : inv.status,
              funding: {
                ...inv.funding,
                totalRaised,
                fundingProgress: totalRaised / inv.funding.targetAmount,
                remainingCapacity: inv.funding.targetAmount - totalRaised,
                investorCount: inv.funding.investorCount + 1,
              },
            } as Invoice;
          });
          return {
            invoices: nextInvoices,
            _fundingBackup: backup ? { ...(s._fundingBackup || {}), [id]: backup } : s._fundingBackup,
          };
        }),

      rollbackInvoiceFunding: (id) =>
        set((s) => {
          const backup = s._fundingBackup?.[id];
          if (!backup) return {};
          const invoices = s.invoices.map((inv) => {
            if (inv.id !== id) return inv;
            return {
              ...inv,
              status: backup.status ?? inv.status,
              funding: {
                ...inv.funding,
                totalRaised: backup.totalRaised ?? inv.funding.totalRaised,
                fundingProgress: backup.fundingProgress ?? inv.funding.fundingProgress,
                remainingCapacity: backup.remainingCapacity ?? inv.funding.remainingCapacity,
                investorCount: backup.investorCount ?? inv.funding.investorCount,
              },
            } as Invoice;
          });
          const nextBackup = { ...(s._fundingBackup || {}) };
          delete nextBackup[id];
          return { invoices, _fundingBackup: nextBackup };
        }),

      updateInvoiceStatus: (id, status) =>
        set((s) => {
          const prev = s.invoices.find((i) => i.id === id);
          const backup = prev ? { status: prev.status } : undefined;
          const invoices = s.invoices.map((inv) =>
            inv.id === id ? ({ ...inv, status } as Invoice) : inv
          );
          return {
            invoices,
            _statusBackup: backup ? { ...(s._statusBackup || {}), [id]: backup } : s._statusBackup,
          };
        }),

      rollbackInvoiceStatus: (id) =>
        set((s) => {
          const backup = s._statusBackup?.[id];
          if (!backup) return {};
          const invoices = s.invoices.map((inv) =>
            inv.id === id ? ({ ...inv, status: backup.status } as Invoice) : inv
          );
          const nextBackup = { ...(s._statusBackup || {}) };
          delete nextBackup[id];
          return { invoices, _statusBackup: nextBackup };
        }),

      setCreateDraft: (draft) =>
        set((s) => ({ createDraft: { ...s.createDraft, ...draft } })),

      clearCreateDraft: () => set({ createDraft: { currency: "USDC" } }),

      toggleComparison: (id) =>
        set((s) => ({ comparisonList: toggleComparisonId(s.comparisonList, id) })),

      setComparisonList: (ids) =>
        set({ comparisonList: normalizeComparisonList(ids) }),

      savePreset: (name) => {
        const trimmed = name.trim().slice(0, 80);
        if (!trimmed) return null;
        const { filters, sort } = get();
        const preset: SavedMarketplacePreset = {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: trimmed,
          filters: { ...filters, aprRange: [...filters.aprRange] as [number, number] },
          sort: { ...sort },
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ savedPresets: [...s.savedPresets, preset].slice(-MAX_SAVED_PRESETS) }));
        return preset;
      },

      renamePreset: (id, name) => {
        const trimmed = name.trim().slice(0, 80);
        if (!trimmed) return;
        set((s) => ({
          savedPresets: s.savedPresets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
        }));
      },

      deletePreset: (id) =>
        set((s) => ({ savedPresets: s.savedPresets.filter((p) => p.id !== id) })),

      loadPreset: (id) => {
        const preset = get().savedPresets.find((p) => p.id === id);
        if (!preset) return false;
        set({ filters: { ...preset.filters }, sort: { ...preset.sort } });
        return true;
      },

      exportPresetsText: () => buildPresetArtifact(get().savedPresets),

      importPresets: (raw) => {
        const parsed = parsePresetImport(raw);
        if ("error" in parsed) return { imported: 0, skipped: 0, error: parsed.error };
        let result: PresetImportResult = { imported: 0, skipped: 0 };
        set((s) => {
          const { merged, imported, skipped } = mergePresets(s.savedPresets, parsed.presets);
          result = { imported, skipped };
          return { savedPresets: merged };
        });
        return result;
      },
      removeFromComparison: (id) =>
        set((s) => ({
          comparisonList: normalizeComparisonList(
            s.comparisonList.filter((i) => i !== id)
          ),
        })),

      clearComparison: () => set({ comparisonList: [] }),

      getFiltered: () => {
        const { invoices, filters, sort, searchQuery } = get();
        return readFilteredInvoices(invoices, filters, sort, searchQuery);
      },
    }),
    {
      name: "kora-invoice-store",
      storage: createPersistentJSONStorage(),
      partialize: (state) => ({ createDraft: state.createDraft }),
    }
  )
);
