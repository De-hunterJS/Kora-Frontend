/**
 * Tests for ActiveFilterChips store wiring + accessibility.
 *
 * Covers:
 *  a) × button removes only that specific filter from the store
 *  b) "Clear all" resets all filters
 *  c) Chips announce removal to screen readers (aria-live="polite" region)
 *  d) Filter state updates immediately (no full page re-render)
 *  e) deriveChips helper produces correct chips from FilterState
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      activeOnly: "Active Only",
      showExpired: "Show Expired",
    };
    return translations[key] ?? key;
  },
}));

import ActiveFilterChips, {
  deriveChips,
  getChipMotionProps,
} from "@/components/marketplace/ActiveFilterChips";
import { useInvoiceStore } from "@/store/invoiceStore";
import type { FilterState } from "@/store/invoiceStore";

/** Point window.matchMedia at a fixed `prefers-reduced-motion` result. */
function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// ─── Reset store before each test ────────────────────────────────────────────

beforeEach(() => {
  useInvoiceStore.setState({
    filters: {
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: false,
    },
  });
});

// ─── deriveChips ─────────────────────────────────────────────────────────────

describe("deriveChips", () => {
  it("returns empty array for default (no active) filters", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: false,
    });
    expect(chips).toHaveLength(0);
  });

  it("creates one chip per category", () => {
    const chips = deriveChips({
      categories: ["technology", "healthcare"],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: false,
    });
    expect(chips).toHaveLength(2);
    expect(chips[0].filterKey).toBe("categories");
    expect(chips[0].value).toBe("technology");
    expect(chips[1].value).toBe("healthcare");
  });

  it("creates one chip per jurisdiction", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: ["KE", "NG"],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: false,
    });
    expect(chips).toHaveLength(2);
    expect(chips.every((c) => c.filterKey === "jurisdictions")).toBe(true);
  });

  it("creates one chip per risk tier", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: [],
      riskTiers: ["AAA", "BB"],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: false,
    });
    expect(chips).toHaveLength(2);
    expect(chips[0].label).toBe("Risk: AAA");
    expect(chips[1].label).toBe("Risk: BB");
  });

  it("creates APR range chip when range differs from default", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [5, 30],
      activeOnly: false,
      showExpired: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].filterKey).toBe("aprRange");
    expect(chips[0].label).toContain("5%");
    expect(chips[0].label).toContain("30%");
  });

  it("creates activeOnly chip when activeOnly is true", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: true,
      showExpired: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].filterKey).toBe("activeOnly");
    expect(chips[0].label).toBe("Active Only");
  });

  it("creates showExpired chip when showExpired is true", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: true,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].filterKey).toBe("showExpired");
    expect(chips[0].label).toBe("Show Expired");
  });

  it("does not create APR range chip when at defaults [0, 50]", () => {
    const chips = deriveChips({
      categories: [],
      jurisdictions: [],
      riskTiers: [],
      aprRange: [0, 50],
      activeOnly: false,
      showExpired: false,
    });
    expect(chips.find((c) => c.filterKey === "aprRange")).toBeUndefined();
  });
});

// ─── Reduced motion (Issue #1013) ────────────────────────────────────────────

describe("getChipMotionProps", () => {
  it("returns instant (transition-less) props when reduced motion is requested", () => {
    const props = getChipMotionProps(true);
    expect(props.transition).toEqual({ duration: 0 });
    expect(props.initial).toBe(false);
    // Exit still targets the resting state so AnimatePresence removes it
    // immediately rather than animating a scale/translate.
    expect(props.exit).toEqual({ opacity: 1, scale: 1, y: 0 });
  });

  it("returns the full scale/translate animation when motion is allowed", () => {
    const props = getChipMotionProps(false);
    expect(props.transition).toEqual({ duration: 0.15 });
    expect(props.initial).toEqual({ opacity: 0, scale: 0.9, y: -4 });
    expect(props.exit).toEqual({ opacity: 0, scale: 0.9, y: -4 });
  });
});

describe("ActiveFilterChips — prefers-reduced-motion", () => {
  const activeFilters = {
    categories: ["technology"],
    jurisdictions: [],
    riskTiers: [],
    aprRange: [0, 50] as [number, number],
    activeOnly: false,
    showExpired: false,
  };

  afterEach(() => {
    // Restore the default non-matching mock from vitest.setup.ts.
    setReducedMotion(false);
  });

  it("flips to reduced animations when the media query matches", () => {
    setReducedMotion(true);
    useInvoiceStore.setState({ filters: activeFilters });
    render(<ActiveFilterChips />);

    expect(screen.getByTestId("active-filter-chips")).toHaveAttribute(
      "data-reduced-motion",
      "true"
    );
  });

  it("keeps full animations when the media query does not match", () => {
    setReducedMotion(false);
    useInvoiceStore.setState({ filters: activeFilters });
    render(<ActiveFilterChips />);

    expect(screen.getByTestId("active-filter-chips")).toHaveAttribute(
      "data-reduced-motion",
      "false"
    );
  });

  it("still announces removals while reduced motion is active", async () => {
    const user = userEvent.setup();
    setReducedMotion(true);
    useInvoiceStore.setState({ filters: activeFilters });
    render(<ActiveFilterChips />);

    const announcer = screen.getByTestId("filter-chips-announcer");
    await user.click(screen.getByTestId("remove-chip-category:technology"));

    await waitFor(() => {
      expect(announcer.textContent).toContain("Technology");
    });
  });
});

// ─── Component rendering ─────────────────────────────────────────────────────

describe("ActiveFilterChips — rendering", () => {
  it("renders nothing when no filters are active", () => {
    const { container } = render(<ActiveFilterChips />);
    expect(container.firstChild).toBeNull();
  });

  it("renders chips for active filters", () => {
    useInvoiceStore.setState({
      filters: {
        categories: ["technology"],
        jurisdictions: ["KE"],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);
    expect(screen.getByTestId("active-filter-chips")).toBeInTheDocument();
    expect(screen.getByText("Technology")).toBeInTheDocument();
    expect(screen.getByText("KE")).toBeInTheDocument();
  });

  it("renders Clear all button when chips exist", () => {
    useInvoiceStore.setState({
      filters: {
        categories: ["healthcare"],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);
    expect(screen.getByTestId("clear-all-filters")).toBeInTheDocument();
  });

  it("includes accessible aria-live='polite' region", () => {
    useInvoiceStore.setState({
      filters: {
        categories: ["technology"],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);
    const liveRegion = screen.getByTestId("filter-chips-announcer");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("role", "status");
  });

  it("each chip × button has descriptive aria-label", () => {
    useInvoiceStore.setState({
      filters: {
        categories: ["technology"],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);
    const removeBtn = screen.getByLabelText(/Remove filter: Technology/i);
    expect(removeBtn).toBeInTheDocument();
  });
});

// ─── × button — removes only that filter ─────────────────────────────────────

describe("ActiveFilterChips — × button removes single filter", () => {
  it("removes a category filter when its × is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: ["technology", "healthcare"],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    // Click the × on "Technology"
    const techRemove = screen.getByTestId("remove-chip-category:technology");
    await user.click(techRemove);

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.categories).not.toContain("technology");
      expect(filters.categories).toContain("healthcare");
    });
  });

  it("removes a jurisdiction filter when its × is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: [],
        jurisdictions: ["KE", "NG"],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    await user.click(screen.getByTestId("remove-chip-jurisdiction:KE"));

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.jurisdictions).not.toContain("KE");
      expect(filters.jurisdictions).toContain("NG");
    });
  });

  it("resets APR range to [0,50] when APR chip × is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: [],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [10, 40],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    await user.click(screen.getByTestId("remove-chip-aprRange"));

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.aprRange).toEqual([0, 50]);
    });
  });

  it("sets activeOnly to false when its chip × is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: [],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: true,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    await user.click(screen.getByTestId("remove-chip-activeOnly"));

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.activeOnly).toBe(false);
    });
  });

  it("sets showExpired to false when its chip × is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: [],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: true,
      },
    });

    render(<ActiveFilterChips />);

    await user.click(screen.getByTestId("remove-chip-showExpired"));

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.showExpired).toBe(false);
    });
  });
});

// ─── Clear all ────────────────────────────────────────────────────────────────

describe("ActiveFilterChips — Clear all", () => {
  it("resets all filters when Clear all is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: ["technology", "healthcare"],
        jurisdictions: ["KE"],
        riskTiers: ["A", "BBB"],
        aprRange: [5, 40],
        activeOnly: true,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    await user.click(screen.getByTestId("clear-all-filters"));

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.categories).toHaveLength(0);
      expect(filters.jurisdictions).toHaveLength(0);
      expect(filters.riskTiers).toHaveLength(0);
      expect(filters.aprRange).toEqual([0, 50]);
      expect(filters.activeOnly).toBe(false);
    });
  });
});

// ─── Screen-reader announcement ───────────────────────────────────────────────

describe("ActiveFilterChips — screen-reader announcements", () => {
  it("announces filter removal to the aria-live region", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: ["technology"],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    const announcer = screen.getByTestId("filter-chips-announcer");
    expect(announcer.textContent).toBe("");

    await user.click(screen.getByTestId("remove-chip-category:technology"));

    await waitFor(() => {
      expect(announcer.textContent).toContain("Technology");
    });
  });

  it("clears active filters when Clear all is clicked", async () => {
    const user = userEvent.setup();

    useInvoiceStore.setState({
      filters: {
        categories: ["technology"],
        jurisdictions: [],
        riskTiers: [],
        aprRange: [0, 50],
        activeOnly: false,
        showExpired: false,
      },
    });

    render(<ActiveFilterChips />);

    await user.click(screen.getByTestId("clear-all-filters"));

    await waitFor(() => {
      const { filters } = useInvoiceStore.getState();
      expect(filters.categories).toHaveLength(0);
      expect(filters.aprRange).toEqual([0, 50]);
      expect(filters.activeOnly).toBe(false);
      expect(filters.showExpired).toBe(false);
      expect(screen.queryByTestId("active-filter-chips")).not.toBeInTheDocument();
    });
  });
});
