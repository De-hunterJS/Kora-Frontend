import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { Footer } from "../Footer";

// ─── next-intl mock ─────────────────────────────────────────────────────────
const mockTranslations: Record<string, string> = {
  "footer.keyboardShortcuts": "Keyboard Shortcuts",
  "footer.changelog": "Changelog",
  "footer.openShortcutsLabel": "Open keyboard shortcuts reference",
  "footer.openChangelogLabel": "Open changelog",
  "footer.openChangelogUnreadLabel": "Open changelog (new release available)",
  "footer.copyright": "© 2026 Kora Protocol",
};

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) =>
    mockTranslations[`${ns}.${key}`] ?? key,
}));

// ─── Store mock ──────────────────────────────────────────────────────────────
const mockSetChangelogOpen = vi.fn();
const mockChangelogOpen = { value: false };
vi.mock("@/store/uiStore", () => ({
  useUIStore: (selector: (s: { setChangelogOpen: typeof mockSetChangelogOpen; changelogOpen: boolean }) => unknown) =>
    selector({ setChangelogOpen: mockSetChangelogOpen, changelogOpen: mockChangelogOpen.value }),
}));

// ─── Changelog badge mock ────────────────────────────────────────────────────
const mockHasUnread = { value: false };
vi.mock("@/hooks/useChangelogBadge", () => ({
  useChangelogBadge: () => ({ hasUnread: mockHasUnread.value }),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("Footer", () => {
  beforeEach(() => {
    mockHasUnread.value = false;
    mockChangelogOpen.value = false;
    mockSetChangelogOpen.mockClear();
  });

  it("renders footer element with contentinfo role", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toBeInTheDocument();
  });

  it("footer has aria-labelledby pointing to copyright text", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveAttribute("aria-labelledby", "footer-copyright");
    expect(screen.getByText("© 2026 Kora Protocol")).toHaveAttribute("id", "footer-copyright");
  });

  it("renders the keyboard shortcuts button with translated label", () => {
    render(<Footer />);
    // The button's accessible name is its aria-label; its text content is "Keyboard Shortcuts"
    expect(screen.getByRole("button", { name: "Open keyboard shortcuts reference" })).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("keyboard shortcuts button has correct aria-label", () => {
    render(<Footer />);
    const btn = screen.getByRole("button", { name: "Open keyboard shortcuts reference" });
    expect(btn).toHaveAttribute("aria-label", "Open keyboard shortcuts reference");
  });

  it("dispatches kora:open-shortcut-modal event when shortcuts button is clicked", () => {
    render(<Footer />);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    fireEvent.click(screen.getByRole("button", { name: "Open keyboard shortcuts reference" }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "kora:open-shortcut-modal" })
    );
    dispatchSpy.mockRestore();
  });

  it("renders the changelog button with translated label", () => {
    render(<Footer />);
    expect(screen.getByRole("button", { name: "Open changelog" })).toBeInTheDocument();
  });

  it("changelog button calls setChangelogOpen(true) when clicked", () => {
    render(<Footer />);
    fireEvent.click(screen.getByRole("button", { name: "Open changelog" }));
    expect(mockSetChangelogOpen).toHaveBeenCalledWith(true);
  });

  it("renders unread dot when hasUnread is true", () => {
    mockHasUnread.value = true;
    render(<Footer />);
    expect(screen.getByTestId("changelog-unread-dot-footer")).toBeInTheDocument();
  });

  it("does not render unread dot when hasUnread is false", () => {
    render(<Footer />);
    expect(screen.queryByTestId("changelog-unread-dot-footer")).not.toBeInTheDocument();
  });

  it("shows unread aria-label when hasUnread is true", () => {
    mockHasUnread.value = true;
    render(<Footer />);
    const btn = screen.getByRole("button", { name: "Open changelog (new release available)" });
    expect(btn).toBeInTheDocument();
  });

  it("renders the version badge", () => {
    render(<Footer />);
    expect(screen.getByText(/^v0\.1\.0$/)).toBeInTheDocument();
  });

  it("renders the copyright span", () => {
    render(<Footer />);
    expect(screen.getByText("© 2026 Kora Protocol")).toBeInTheDocument();
  });

  it("restores focus to changelog button when modal closes", () => {
    const { rerender } = render(<Footer />);
    const changelogBtn = screen.getByRole("button", { name: "Open changelog" });

    // Simulate opening the changelog
    mockChangelogOpen.value = true;
    rerender(<Footer />);

    // Simulate closing the changelog
    mockChangelogOpen.value = false;
    rerender(<Footer />);

    // Focus should be restored to the trigger button
    expect(changelogBtn).toHaveFocus();
  });
});
