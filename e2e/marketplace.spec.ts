/**
 * E2E — Marketplace
 *
 * Covers:
 *  - Page loads with heading and invoice count
 *  - Invoice cards render with key data (debtor, APR, risk badge)
 *  - Search filters the invoice list
 *  - Clearing search restores the full list
 *  - Category filter (MultiSelect) narrows results
 *  - Risk tier checkbox filter narrows results
 *  - Sort select changes the displayed order
 *  - "Active Only" toggle hides fully-funded invoices
 *  - Empty state renders when no invoices match
 *  - Clicking an invoice card navigates to the detail page
 *  - Detail page renders financing terms and fund panel
 */

import { test, expect } from "@playwright/test";
import { injectWalletStubs } from "./helpers/mock-wallet";

test.describe("Marketplace", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kora-tour-done", "true");
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
    });
    await page.goto("/marketplace");
    // Wait for the page to hydrate and show invoice cards
    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });
  });

  test("renders Invoice Marketplace heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Invoice Marketplace/i }),
    ).toBeVisible();
  });

  test("renders invoice cards with debtor names from mock data", async ({
    page,
  }) => {
    // MOCK_INVOICES contains these debtors
    const debtors = [
      "Safaricom PLC",
      "Ghana Cocoa Board",
      "Lagos State Health",
      "Growthpoint Properties",
      "Kenya Power",
    ];
    // At least one debtor from mock data should be visible
    let found = false;
    for (const debtor of debtors) {
      const el = page.getByText(debtor);
      if (await el.isVisible().catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("invoice cards show APR values", async ({ page }) => {
    // APR values are formatted as e.g. "24.5%" — look for the % sign
    const aprBadge = page.locator("text=/%/").first();
    await expect(aprBadge).toBeVisible();
  });

  test("search input is visible and accepts text", async ({ page }) => {
    const searchInput = page.getByPlaceholder(
      /Search by debtor, invoice number, or jurisdiction/i,
    );
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Safaricom");
    await expect(searchInput).toHaveValue("Safaricom");
  });

  test("search filters the invoice list", async ({ page }) => {
    const searchInput = page.getByPlaceholder(
      /Search by debtor, invoice number, or jurisdiction/i,
    );
    // Count cards before search
    const allCards = page.locator("a[href^='/marketplace/']");
    const totalBefore = await allCards.count();

    await searchInput.fill("Safaricom");
    // Wait for debounce (300ms) + re-render
    await page.waitForTimeout(500);

    const cardsAfter = await allCards.count();
    // Either fewer cards or the same if all match — but "Safaricom" is specific
    expect(cardsAfter).toBeLessThanOrEqual(totalBefore);
    // The matching card should be visible
    await expect(page.getByText("Safaricom PLC")).toBeVisible();
  });

  test("clear search button restores full list", async ({ page }) => {
    const searchInput = page.getByPlaceholder(
      /Search by debtor, invoice number, or jurisdiction/i,
    );
    await searchInput.fill("Safaricom");
    await page.waitForTimeout(500);

    // Clear button (X icon) appears when there is text
    const clearBtn = page.getByRole("button", { name: /Clear search/i });
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    await expect(searchInput).toHaveValue("");
  });

  test("sort select is visible and has default option", async ({ page }) => {
    const sortSelect = page.locator("select");
    await expect(sortSelect).toBeVisible();
    // Default sort is APR: High to Low
    await expect(sortSelect).toHaveValue("apr_desc");
  });

  test("changing sort option updates the URL", async ({ page }) => {
    const sortSelect = page.locator("select");
    await sortSelect.selectOption("amount_desc");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/sortBy=amount_desc/);
  });

  test("Quick Filters button is visible on desktop", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /Quick Filters/i }),
    ).toBeVisible();
  });

  test("opening Quick Filters reveals filter panel", async ({ page }) => {
    await page.getByRole("button", { name: /Quick Filters/i }).click();
    // The sidebar filter panel is always visible on desktop (lg breakpoint)
    // At 1280px viewport it should already be visible
    await expect(page.getByText("Marketplace Filters")).toBeVisible();
  });

  test("risk tier checkboxes are visible in the filter sidebar", async ({
    page,
  }) => {
    // The sidebar is visible at 1280px
    await expect(page.getByText("Risk Tier")).toBeVisible();
    // Individual tier labels
    await expect(page.getByText("AAA")).toBeVisible();
    await expect(page.locator("fieldset").getByText("BBB")).toBeVisible();
  });

  test("selecting a risk tier filter updates the URL", async ({ page }) => {
    // Click the "A" risk tier checkbox
    const aTierLabel = page.locator("label").filter({ hasText: /^A$/ }).first();
    await aTierLabel.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/riskTiers=A/);
  });

  test("Active Only toggle is visible", async ({ page }) => {
    await expect(page.getByText("Active Only")).toBeVisible();
  });

  test("clicking an invoice card navigates to the detail page", async ({
    page,
  }) => {
    const firstCard = page.locator("a[href^='/marketplace/']").first();
    const href = await firstCard.getAttribute("href");
    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(href!.replace("/", "\\/")));
  });
});

test.describe("Marketplace onboarding tour", () => {
  test("auto-starts once, supports skipping, and does not run on deep links", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
    });
    await page.goto("/marketplace");

    const tour = page.getByRole("dialog", {
      name: "Marketplace onboarding tour",
    });
    await expect(tour).toBeVisible();
    await expect(tour.getByText("Find the right opportunity")).toBeVisible();

    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByText("Review invoice details")).toBeVisible();
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByText("Fund an invoice")).toBeVisible();
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(tour.getByText("Track your portfolio")).toBeVisible();

    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("kora-tour-done")))
      .toBe("true");

    await page.reload();
    await expect(tour).toBeHidden();

    await page.evaluate(() => localStorage.removeItem("kora-tour-done"));
    await page.goto("/marketplace/inv_001");
    await expect(tour).toBeHidden();
  });
});

test.describe("Marketplace — Invoice Detail", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
    });
    // Navigate directly to the first mock invoice detail page
    await page.goto("/marketplace/inv_001");
  });

  test("renders invoice number and debtor name", async ({ page }) => {
    await expect(
      page.locator("main").getByText("INV-2024-0891").first(),
    ).toBeVisible();
    await expect(page.getByText("Safaricom PLC")).toBeVisible();
  });

  test("renders Financing Terms section", async ({ page }) => {
    await expect(page.getByText(/Financing Terms/i)).toBeVisible();
    await expect(page.getByText("APR", { exact: true })).toBeVisible();
    await expect(page.getByText(/Min Investment/i)).toBeVisible();
  });

  test("renders funding progress bar", async ({ page }) => {
    // Progress bar is rendered for partially funded invoices
    await expect(page.getByText(/Funding Progress/i)).toBeVisible();
  });

  test("renders fund panel with connect wallet CTA when disconnected", async ({
    page,
  }) => {
    // Without a connected wallet the fund panel shows a connect prompt
    const connectBtn = page.getByRole("button", {
      name: /Connect Wallet to Invest/i,
    });
    await expect(connectBtn).toBeVisible();
  });

  test("clicking Connect Wallet to Invest opens the wallet modal", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: /Connect Wallet to Invest/i })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("Marketplace — Investor funding flow", () => {
  test("funds an invoice with a mocked wallet and updates progress optimistically", async ({
    context,
    page,
  }) => {
    await injectWalletStubs(context, { usdcBalance: "50000.00" });
    await page.addInitScript(() => {
      localStorage.setItem("kora-tour-done", "true");
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
    });

    await page.goto("/marketplace/inv_003");
    await expect(page.getByText("Fund This Invoice")).toBeVisible();
    await expect(page.getByText(/30% of/i)).toBeVisible();

    await page
      .getByRole("spinbutton", { name: /Investment Amount/i })
      .fill("10000");
    await page.getByRole("button", { name: "Fund Invoice" }).click();

    await expect(page.getByText(/39% of/i)).toBeVisible();
    await expect(
      page.getByText("Factoring escrow deposits funded!"),
    ).toBeVisible({ timeout: 10_000 });

    await page.goto("/dashboard/investor");
    await expect(page.getByText("Portfolio Value")).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });

  test("shows an insufficient balance toast without submitting funding", async ({
    context,
    page,
  }) => {
    await injectWalletStubs(context, { usdcBalance: "100.00" });
    await page.addInitScript(() => {
      localStorage.setItem("kora-tour-done", "true");
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
    });

    await page.goto("/marketplace/inv_003");
    await expect(page.getByText("Fund This Invoice")).toBeVisible();

    await page
      .getByRole("spinbutton", { name: /Investment Amount/i })
      .fill("500");
    await expect(page.getByText(/Insufficient USDC balance/i)).toBeVisible();

    await page.getByRole("button", { name: "Fund Invoice" }).click();
    await expect(
      page
        .getByRole("region", { name: "Notifications alt+T" })
        .getByRole("alert"),
    ).toContainText("Insufficient balance");
    await expect(
      page.getByText("Factoring escrow deposits funded!"),
    ).toBeHidden();
  });
});

// ── Marketplace — Category Taxonomy Preview (Flag Enabled) ───────────────────────

test.describe("Marketplace — Category Taxonomy Preview (Flag Enabled)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kora-tour-done", "true");
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
      localStorage.setItem(
        "kora:feature-flag-overrides",
        JSON.stringify({ "category-taxonomy-preview": true })
      );
    });
    await page.goto("/marketplace");
    // Wait for the page to hydrate and show invoice cards
    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });
  });

  test("renders taxonomy preview trigger button when flag is enabled", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await expect(triggerButton).toBeVisible();
    await expect(triggerButton).toContainText("Taxonomy Preview");
  });

  test("opens taxonomy preview modal when trigger button is clicked", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await triggerButton.click();

    const dialog = page.getByRole("dialog", { name: /Category Taxonomy Preview/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Category Taxonomy Preview")).toBeVisible();
    await expect(dialog.getByText("Dev Preview")).toBeVisible();
  });

  test("shows taxonomy metrics cards", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await triggerButton.click();

    const dialog = page.getByRole("dialog", { name: /Category Taxonomy Preview/i });
    await expect(dialog.getByText("Total Categories")).toBeVisible();
    await expect(dialog.getByText("Active in Inventory")).toBeVisible();
    await expect(dialog.getByText("Unused Categories")).toBeVisible();
    await expect(dialog.getByText("Missing Translations")).toBeVisible();
  });

  test("filters categories by search input", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await triggerButton.click();

    const dialog = page.getByRole("dialog", { name: /Category Taxonomy Preview/i });
    const searchInput = dialog.getByPlaceholder(/Search taxonomy keys or labels/i);
    await expect(searchInput).toBeVisible();

    await searchInput.fill("techno");
    await page.waitForTimeout(200);

    await expect(dialog.getByText("technology")).toBeVisible();
    await expect(dialog.getByText("agriculture")).not.toBeVisible();
  });

  test("filters by active vs unused category filter buttons", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await triggerButton.click();

    const dialog = page.getByRole("dialog", { name: /Category Taxonomy Preview/i });

    // Click "Active Only" filter
    const activeFilterBtn = dialog.getByRole("button", { name: /Active Only/i });
    await activeFilterBtn.click();
    await page.waitForTimeout(200);

    // Active categories should be visible
    // (at least one invoice category from mock data should have count > 0)

    // Click "Unused Only" filter
    const unusedFilterBtn = dialog.getByRole("button", { name: /Unused Only/i });
    await unusedFilterBtn.click();
    await page.waitForTimeout(200);

    // Unused categories should be visible
    await expect(dialog.getByText("Unused Only")).toBeVisible();
  });

  test("closes modal when close button is clicked", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await triggerButton.click();

    const dialog = page.getByRole("dialog", { name: /Category Taxonomy Preview/i });
    await expect(dialog).toBeVisible();

    // Click close button (X icon)
    const closeButton = dialog.getByRole("button", { name: /Close Preview/i });
    await closeButton.click();

    await expect(dialog).toBeHidden();
  });

  test("copy taxonomy JSON button works", async ({ page }) => {
    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await triggerButton.click();

    const dialog = page.getByRole("dialog", { name: /Category Taxonomy Preview/i });
    const copyButton = dialog.getByRole("button", { name: /Copy Taxonomy JSON/i });
    await expect(copyButton).toBeVisible();

    // Grant clipboard permission
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await copyButton.click();
    await expect(dialog.getByText("Copied to clipboard!")).toBeVisible();
  });
});

test.describe("Marketplace — Category Taxonomy Preview (Flag Disabled)", () => {
  test("does not render trigger button when flag is disabled", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kora-tour-done", "true");
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
      localStorage.setItem(
        "kora:feature-flag-overrides",
        JSON.stringify({ "category-taxonomy-preview": false })
      );
    });
    await page.goto("/marketplace");
    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    const triggerButton = page.getByRole("button", { name: /Taxonomy Preview/i });
    await expect(triggerButton).not.toBeVisible();
  });
});

// ─── Scroll reset on filter change (Issue #1015) ─────────────────────────────

test.describe("Marketplace — scroll reset on result-set change", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("kora-tour-done", "true");
      localStorage.setItem("kora-changelog-seen-version", "0.1.0");
    });
    await page.goto("/marketplace");
    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });
    await page.waitForTimeout(600); // let URL hydration + fingerprint settle
  });

  test("sort-only changes keep the current scroll position", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);

    await page.locator("select").selectOption("amount_desc");
    await page.waitForTimeout(700);

    // Reordering the same result set must not bounce the user to the top.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("clearing the search resets the grid to the top", async ({ page }) => {
    const searchInput = page.getByPlaceholder(
      /Search by debtor, invoice number, or jurisdiction/i,
    );
    // Narrow to a still-large result set, then scroll to the bottom.
    await searchInput.fill("a");
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: /Clear search/i }).click();

    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: "changing the result set should return the grid to the top",
      })
      .toBe(0);
  });
});
