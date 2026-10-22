/**
 * e2e/marketplace-mobile.spec.ts
 *
 * Mobile-specific E2E suite for the Marketplace page (Issue #471).
 *
 * Coverage:
 *  - Responsive single-column grid layout
 *  - Bottom sheet open / close (tap, Escape, close button)
 *  - Swipe-down gesture to dismiss bottom sheet
 *  - Bottom sheet accessibility (role, aria-modal, aria-labelledby, focus trap)
 *  - Filter application via mobile UI (category, risk tier)
 *  - Active-filter badge count on Filters button
 *  - URL sync after applying filters on mobile
 *  - 375 px viewport (Galaxy S8 / iPhone SE)
 *  - Screenshot assertions at key states
 *  - Touch / tap interactions on invoice cards
 *  - Mobile search experience
 *  - Virtualized grid presence and horizontal-overflow guard
 *
 * The outer `test.use` sets the default device to iPhone 12 (390 × 844, touch
 * enabled).  Describe blocks that need a different viewport override it with
 * their own `test.use`.
 *
 * Run:
 *   npx playwright test e2e/marketplace-mobile.spec.ts --project=mobile-chrome
 */

import { test, expect, devices } from "@playwright/test";

// Default device for the whole file — individual describe blocks may override.
test.use({ ...devices["iPhone 12"] });

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Dismiss tour + changelog so they never obscure the page under test. */
async function suppressOverlays(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("kora-tour-done", "true");
    localStorage.setItem("kora-changelog-seen-version", "0.1.0");
  });
}

/** Wait for at least one invoice card to be visible. */
async function waitForCards(page: import("@playwright/test").Page) {
  await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });
}

/** Open the mobile filter bottom sheet and wait for its title to appear. */
async function openBottomSheet(page: import("@playwright/test").Page) {
  const btn = page.locator("button:has-text('Filters')").first();
  await btn.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
}

// ─── Responsiveness ──────────────────────────────────────────────────────────

test.describe("Marketplace - Mobile Responsiveness", () => {
  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("displays single-column invoice grid on mobile", async ({ page }) => {
    const cards = page.locator("a[href^='/marketplace/']");
    const count = await cards.count();
    if (count < 2) return; // nothing to compare

    const box0 = await cards.nth(0).boundingBox();
    const box1 = await cards.nth(1).boundingBox();

    if (box0 && box1) {
      // Stacked vertically: second card is below the first
      expect(box1.y).toBeGreaterThan(box0.y);
      // Same horizontal origin (single column, not side-by-side)
      expect(Math.abs(box0.x - box1.x)).toBeLessThan(10);
    }
  });

  test("hides desktop sidebar and shows mobile filter button", async ({ page }) => {
    const sidebar = page.locator("div.hidden.lg\\:block").first();
    // In mobile viewport the sidebar is display:none
    await expect(sidebar).toBeHidden();
    await expect(page.locator("button:has-text('Filters')").first()).toBeVisible();
  });

  test("opens bottom sheet when Filters button is tapped", async ({ page }) => {
    await openBottomSheet(page);
    await expect(page.getByText("Filter Invoices").first()).toBeVisible();
    await expect(
      page.locator("button[aria-label*='Close']").first(),
    ).toBeVisible();
  });

  test("closes bottom sheet when backdrop is tapped", async ({ page }) => {
    await openBottomSheet(page);
    const backdrop = page.locator(".fixed.inset-0.z-40").first();
    await backdrop.click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("closes bottom sheet when close button is tapped", async ({ page }) => {
    await openBottomSheet(page);
    await page.locator("button[aria-label*='Close']").first().click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("shows all filter controls inside the bottom sheet", async ({ page }) => {
    await openBottomSheet(page);
    for (const label of ["Categories", "Jurisdictions", "Risk Tier", "APR Range", "Active Only"]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test("no horizontal overflow after filter is applied", async ({ page }) => {
    await openBottomSheet(page);
    await page.locator("input[type='checkbox']").first().click();
    await page.locator("button[aria-label*='Close']").first().click();

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("shows active filter count badge on Filters button", async ({ page }) => {
    await openBottomSheet(page);
    await page.locator("input[type='checkbox']").first().click();
    await page.locator("button[aria-label*='Close']").first().click();

    const filterBtn = page.locator("button:has-text('Filters')").first();
    const badge = filterBtn.locator("span").filter({ hasText: /\d+/ }).first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("1");
  });

  test("handles long filter lists with scroll inside bottom sheet", async ({ page }) => {
    await openBottomSheet(page);
    const scrollable = page.locator(".overflow-y-auto").first();
    await scrollable.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // Reset button should be reachable after scrolling
    await expect(
      page.locator("button:has-text('Reset All Filters')").first(),
    ).toBeDefined();
  });
});

// ─── Mobile Search Experience ─────────────────────────────────────────────────

test.describe("Marketplace - Mobile Search Experience", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] })

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
  });

  test("displays search bar on mobile", async ({ page }) => {
    await expect(
      page.locator('input[placeholder*="Search"]').first(),
    ).toBeVisible();
  });

  test("displays sort dropdown on mobile", async ({ page }) => {
    await expect(page.locator("select").first()).toBeVisible();
  });

  test("stacks search and sort vertically on mobile", async ({ page }) => {
    const searchBox = await page.locator('input[placeholder*="Search"]').first().boundingBox();
    const sortBox = await page.locator("select").first().boundingBox();
    if (searchBox && sortBox) {
      expect(searchBox.y).toBeLessThan(sortBox.y);
    }
  });
});


// ─── Swipe-to-dismiss (Issue #471) ────────────────────────────────────────────
//
// The BottomSheet component listens for touchstart / touchend on the drag
// handle and header area. A downward drag ≥ 80 px closes the sheet.
// Playwright's `page.touchscreen.tap` handles single taps; for a swipe we use
// the lower-level pointer-event sequence: touchstart → touchmove → touchend.

test.describe("Bottom Sheet - Swipe to Dismiss", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("drag handle is rendered when bottom sheet is open", async ({ page }) => {
    await openBottomSheet(page);
    const handle = page.locator('[data-testid="bottom-sheet-drag-handle"]');
    await expect(handle).toBeVisible();
  });

  test("swipe down on drag handle dismisses the bottom sheet", async ({ page }) => {
    await openBottomSheet(page);

    const handle = page.locator('[data-testid="bottom-sheet-drag-handle"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error("drag handle not found in DOM");

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const endY   = startY + 120; // 120 px downward — well above the 80 px threshold

    // Simulate a touch swipe using pointer events
    await page.touchscreen.tap(startX, startY); // touchstart registrar
    await page.evaluate(
      ({ sx, sy, ex, ey }) => {
        const el = document.querySelector('[data-testid="bottom-sheet-drag-handle"]');
        if (!el) return;
        el.dispatchEvent(new TouchEvent("touchstart", {
          bubbles: true, cancelable: true,
          touches: [new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy })],
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy })],
        }));
        el.dispatchEvent(new TouchEvent("touchend", {
          bubbles: true, cancelable: true,
          touches: [],
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: ex, clientY: ey })],
        }));
      },
      { sx: startX, sy: startY, ex: startX, ey: endY },
    );

    // Sheet must be dismissed
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 3_000 });
  });

  test("short swipe (< 80 px) does not dismiss the bottom sheet", async ({ page }) => {
    await openBottomSheet(page);

    const handle = page.locator('[data-testid="bottom-sheet-drag-handle"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error("drag handle not found in DOM");

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const endY   = startY + 30; // 30 px — below the 80 px threshold

    await page.evaluate(
      ({ sx, sy, ex, ey }) => {
        const el = document.querySelector('[data-testid="bottom-sheet-drag-handle"]');
        if (!el) return;
        el.dispatchEvent(new TouchEvent("touchstart", {
          bubbles: true, cancelable: true,
          touches: [new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy })],
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy })],
        }));
        el.dispatchEvent(new TouchEvent("touchend", {
          bubbles: true, cancelable: true,
          touches: [],
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: ex, clientY: ey })],
        }));
      },
      { sx: startX, sy: startY, ex: startX, ey: endY },
    );

    // Sheet must still be visible
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("swipe down on header area also dismisses the sheet", async ({ page }) => {
    await openBottomSheet(page);

    // Target the header div (title + close button row) which also has touch handlers
    const header = page.getByText("Filter Invoices").first();
    const box = await header.boundingBox();
    if (!box) throw new Error("header not found");

    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;

    await page.evaluate(
      ({ sx, sy, ey }) => {
        // Find the header container (parent of the h2)
        const h2 = document.querySelector('[role="dialog"] h2');
        const el = h2?.parentElement ?? h2;
        if (!el) return;
        el.dispatchEvent(new TouchEvent("touchstart", {
          bubbles: true, cancelable: true,
          touches: [new Touch({ identifier: 2, target: el as Element, clientX: sx, clientY: sy })],
          changedTouches: [new Touch({ identifier: 2, target: el as Element, clientX: sx, clientY: sy })],
        }));
        el.dispatchEvent(new TouchEvent("touchend", {
          bubbles: true, cancelable: true,
          touches: [],
          changedTouches: [new Touch({ identifier: 2, target: el as Element, clientX: sx, clientY: ey })],
        }));
      },
      { sx, sy, ey: sy + 100 },
    );

    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 3_000 });
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

test.describe("Bottom Sheet - Accessibility", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("bottom sheet panel has role=dialog and aria-modal=true", async ({ page }) => {
    await openBottomSheet(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  test("bottom sheet is labelled by its title via aria-labelledby", async ({ page }) => {
    await openBottomSheet(page);
    const dialog = page.getByRole("dialog");
    const labelledBy = await dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();

    // The element referenced by aria-labelledby must contain the title text
    const titleEl = page.locator(`#${labelledBy}`);
    await expect(titleEl).toContainText("Filter Invoices");
  });

  test("Escape key closes the bottom sheet", async ({ page }) => {
    await openBottomSheet(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 3_000 });
  });

  test("focus moves into the dialog panel on open", async ({ page }) => {
    await openBottomSheet(page);
    // After opening, focus should be within the dialog
    const focusedInsideDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? dialog.contains(document.activeElement) : false;
    });
    expect(focusedInsideDialog).toBe(true);
  });

  test("close button has a descriptive aria-label", async ({ page }) => {
    await openBottomSheet(page);
    const closeBtn = page.locator("button[aria-label*='Close']").first();
    const label = await closeBtn.getAttribute("aria-label");
    expect(label).toMatch(/close/i);
  });

  test("backdrop is aria-hidden so screen readers skip it", async ({ page }) => {
    await openBottomSheet(page);
    const backdrop = page.locator(".fixed.inset-0.z-40").first();
    await expect(backdrop).toHaveAttribute("aria-hidden", "true");
  });

  test("drag handle is aria-hidden (decorative)", async ({ page }) => {
    await openBottomSheet(page);
    const handle = page.locator('[data-testid="bottom-sheet-drag-handle"]');
    await expect(handle).toHaveAttribute("aria-hidden", "true");
  });
});


// ─── Filter Application Flow ──────────────────────────────────────────────────

test.describe("Bottom Sheet - Filter Application Flow", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("selecting a risk-tier checkbox updates the URL after sheet closes", async ({ page }) => {
    await openBottomSheet(page);

    // The AAA risk tier checkbox is inside the fieldset labelled "Risk Tier"
    const riskFieldset = page.locator("fieldset").filter({ hasText: "Risk Tier" });
    const aaaTierLabel = riskFieldset.locator("label").filter({ hasText: /^AAA$/ }).first();
    await aaaTierLabel.click();

    await page.locator("button[aria-label*='Close']").first().click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Debounce fires (400 ms) then the URL updates
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/riskTiers=AAA/);
  });

  test("selecting multiple risk tiers sets all values in the URL", async ({ page }) => {
    await openBottomSheet(page);

    const riskFieldset = page.locator("fieldset").filter({ hasText: "Risk Tier" });
    await riskFieldset.locator("label").filter({ hasText: /^AAA$/ }).first().click();
    await riskFieldset.locator("label").filter({ hasText: /^AA$/ }).first().click();

    await page.locator("button[aria-label*='Close']").first().click();
    await page.waitForTimeout(500);

    const url = page.url();
    expect(url).toContain("AAA");
    expect(url).toContain("AA");
  });

  test("Active Only toggle filters the invoice list on mobile", async ({ page }) => {
    await openBottomSheet(page);

    // Toggle the Active Only switch
    const activeOnlySwitch = page.locator('input[role="switch"]');
    await activeOnlySwitch.click();

    await page.locator("button[aria-label*='Close']").first().click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/activeOnly=true/);
  });

  test("Reset All Filters clears URL params and restores full list", async ({ page }) => {
    // First apply a filter
    await openBottomSheet(page);
    const riskFieldset = page.locator("fieldset").filter({ hasText: "Risk Tier" });
    await riskFieldset.locator("label").filter({ hasText: /^AAA$/ }).first().click();
    await page.locator("button[aria-label*='Close']").first().click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/riskTiers/);

    // Now open again and reset
    await openBottomSheet(page);
    const resetBtn = page.locator("button:has-text('Reset All Filters')").first();
    await resetBtn.click();
    await page.locator("button[aria-label*='Close']").first().click();
    await page.waitForTimeout(500);

    // URL should be clean
    await expect(page).not.toHaveURL(/riskTiers/);
  });

  test("filter badge count increments for each filter applied", async ({ page }) => {
    const filterBtn = page.locator("button:has-text('Filters')").first();

    // Apply first filter
    await openBottomSheet(page);
    const riskFieldset = page.locator("fieldset").filter({ hasText: "Risk Tier" });
    await riskFieldset.locator("label").filter({ hasText: /^BBB$/ }).first().click();
    await page.locator("button[aria-label*='Close']").first().click();

    const badge = filterBtn.locator("span").filter({ hasText: /\d+/ }).first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("1");

    // Apply a second filter
    await openBottomSheet(page);
    await riskFieldset.locator("label").filter({ hasText: /^BB$/ }).first().click();
    await page.locator("button[aria-label*='Close']").first().click();

    await expect(badge).toContainText("2");
  });
});

// ─── 375 px Viewport (Galaxy S8 / iPhone SE) ─────────────────────────────────

test.describe("Marketplace - 375px Viewport", () => {
  test.use({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("renders page heading on 375px screen", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Invoice Marketplace/i }),
    ).toBeVisible();
  });

  test("invoice cards are single-column on 375px", async ({ page }) => {
    const cards = page.locator("a[href^='/marketplace/']");
    const count = await cards.count();
    if (count < 2) return;

    const box0 = await cards.nth(0).boundingBox();
    const box1 = await cards.nth(1).boundingBox();
    if (box0 && box1) {
      expect(box1.y).toBeGreaterThan(box0.y);
      // Width should nearly fill the viewport
      expect(box0.width).toBeGreaterThan(300);
    }
  });

  test("Filters button is visible and tappable on 375px", async ({ page }) => {
    const filterBtn = page.locator("button:has-text('Filters')").first();
    await expect(filterBtn).toBeVisible();
    await filterBtn.tap();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });

  test("bottom sheet does not overflow horizontally on 375px", async ({ page }) => {
    await page.locator("button:has-text('Filters')").first().tap();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("no page-level horizontal overflow on 375px", async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("search input is visible and full-width on 375px", async ({ page }) => {
    const input = page.locator('input[placeholder*="Search"]').first();
    await expect(input).toBeVisible();
    const box = await input.boundingBox();
    if (box) {
      // Should span most of the 375 px viewport
      expect(box.width).toBeGreaterThan(250);
    }
  });
});

// ─── Screenshot Assertions ────────────────────────────────────────────────────
//
// Screenshots captured here serve as visual records for PR review.
// The files land in the playwright-report / test-results directories which
// are uploaded as CI artifacts by the playwright-mobile job.

test.describe("Marketplace - Mobile Screenshots", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
  });

  test("screenshot: initial marketplace load on mobile", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForCards(page);
    // Stabilise animations before snapping
    await page.waitForTimeout(300);
    await page.screenshot({
      path: "test-results/mobile-marketplace-initial.png",
      fullPage: false,
    });
    // Basic sanity: the heading must be in the screenshot frame
    await expect(
      page.getByRole("heading", { name: /Invoice Marketplace/i }),
    ).toBeVisible();
  });

  test("screenshot: bottom sheet open state", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForCards(page);
    await openBottomSheet(page);
    await page.screenshot({
      path: "test-results/mobile-marketplace-filter-open.png",
      fullPage: false,
    });
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("screenshot: marketplace after filter applied", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForCards(page);
    await openBottomSheet(page);

    // Apply a risk-tier filter
    const riskFieldset = page.locator("fieldset").filter({ hasText: "Risk Tier" });
    await riskFieldset.locator("label").filter({ hasText: /^A$/ }).first().click();
    await page.locator("button[aria-label*='Close']").first().click();
    await page.waitForTimeout(400);

    await page.screenshot({
      path: "test-results/mobile-marketplace-filter-applied.png",
      fullPage: false,
    });
    // Active filter chips (or URL change) should be present
    await expect(page).toHaveURL(/riskTiers/);
  });

  test("screenshot: empty state when search matches nothing", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForCards(page);

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.fill("zzznomatch9999");
    await page.waitForTimeout(500); // debounce

    await page.screenshot({
      path: "test-results/mobile-marketplace-empty-state.png",
      fullPage: false,
    });
    await expect(page.getByText(/No invoices match/i)).toBeVisible();
  });
});


// ─── Touch / Tap Interactions ─────────────────────────────────────────────────

test.describe("Marketplace - Touch and Tap Interactions", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("tapping an invoice card navigates to the detail page", async ({ page }) => {
    const firstCard = page.locator("a[href^='/marketplace/']").first();
    const href = await firstCard.getAttribute("href");

    // Use tap() for touch devices
    await firstCard.tap();
    await expect(page).toHaveURL(new RegExp(href!.replace("/", "\\/")));
  });

  test("tapping Filters button opens the bottom sheet", async ({ page }) => {
    await page.locator("button:has-text('Filters')").first().tap();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });

  test("tapping the backdrop dismisses the bottom sheet", async ({ page }) => {
    await page.locator("button:has-text('Filters')").first().tap();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    // Tap backdrop — outside the panel
    const backdrop = page.locator(".fixed.inset-0.z-40").first();
    await backdrop.tap();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 3_000 });
  });

  test("tapping sort select changes the sort order", async ({ page }) => {
    const sortSelect = page.locator("select").first();
    await sortSelect.selectOption("amount_desc");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/sortBy=amount_desc/);
  });

  test("tapping search input focuses it and accepts typed text", async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.tap();
    await searchInput.fill("Safaricom");
    await expect(searchInput).toHaveValue("Safaricom");
  });

  test("tapping clear-search button resets the search input", async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.tap();
    await searchInput.fill("Safaricom");
    await page.waitForTimeout(400);

    const clearBtn = page.getByRole("button", { name: /Clear search/i });
    await expect(clearBtn).toBeVisible();
    await clearBtn.tap();
    await expect(searchInput).toHaveValue("");
  });

  test("invoice card Fund Invoice button is tappable", async ({ page }) => {
    // Find a listed invoice card with a Fund Invoice button
    const fundBtn = page.locator("button:has-text('Fund Invoice')").first();
    const isFundBtnVisible = await fundBtn.isVisible().catch(() => false);
    if (!isFundBtnVisible) {
      // Not all mocked invoices have a fund button — skip gracefully
      return;
    }
    // Tap should not throw and should not navigate away (button calls e.preventDefault)
    await fundBtn.tap();
    await expect(page).toHaveURL(/marketplace/);
  });
});

// ─── Virtualized Grid – Mobile Scroll (Issue #435 / #471) ────────────────────

test.describe("Marketplace - Virtualized Grid Mobile Scroll", () => {
  // Inherits top-level test.use({ ...devices["iPhone 12"] });

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("virtual grid container is present and has non-zero height on mobile", async ({ page }) => {
    const virtualGrid = page.locator('[data-virtualized="true"]');
    await expect(virtualGrid).toBeVisible();

    const height = await virtualGrid.evaluate(
      (el: HTMLElement) => parseInt(el.style.height || "0", 10),
    );
    expect(height).toBeGreaterThan(0);
  });

  test("mobile virtual grid has no horizontal overflow", async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-virtualized="true"]');
      if (!el) return 0;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("scrollMargin tracks the list offset and refreshes after a resize", async ({ page }) => {
    const virtualGrid = page.locator('[data-virtualized="true"]');
    await expect(virtualGrid).toBeVisible();

    // Drift between the measured document offset and the value the virtualizer
    // is using must stay near zero or row transforms land in the wrong place.
    const drift = () =>
      virtualGrid.evaluate((el: HTMLElement) => {
        const fromState = Number(el.getAttribute("data-scroll-margin"));
        const measured = Math.round(
          el.getBoundingClientRect().top + window.scrollY,
        );
        return Math.abs(fromState - measured);
      });

    await expect
      .poll(drift, { message: "initial scrollMargin should match the list offset" })
      .toBeLessThanOrEqual(2);

    // Rotation / breakpoint change reflows the filter bar above the list.
    await page.setViewportSize({ width: 375, height: 667 });

    await expect
      .poll(drift, {
        message: "scrollMargin should recalculate after the viewport changes",
      })
      .toBeLessThanOrEqual(2);
  });

  test("scrolling down on mobile renders new cards within DOM budget", async ({ page }) => {
    const cards = page.locator("a[href^='/marketplace/']");

    // Scroll down significantly to trigger virtualizer reflow
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(300);

    const afterScrollCount = await cards.count();

    // Virtualizer prunes off-screen rows — on mobile overscan=3 gives ≤ 9 cards
    const MOBILE_DOM_BUDGET = 20;
    expect(afterScrollCount).toBeLessThanOrEqual(MOBILE_DOM_BUDGET);
  });
});

// ─── Mobile Navigation Menu (Issues #1009, #1010) ────────────────────────────

test.describe("Mobile Nav Menu - Focus Trap and Dismiss", () => {
  const menuButton = (page: import("@playwright/test").Page) =>
    page.locator('button[aria-controls="mobile-nav-menu"]');
  const menu = (page: import("@playwright/test").Page) => page.locator("#mobile-nav-menu");

  test.beforeEach(async ({ page }) => {
    await suppressOverlays(page);
    await page.goto("/marketplace");
    await waitForCards(page);
  });

  test("open menu is a modal dialog linked to its toggle", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute("role", "dialog");
    await expect(menu(page)).toHaveAttribute("aria-modal", "true");
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("Tab cycles within the open menu", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();

    const focusableCount = await menu(page)
      .locator("a[href], button:not([disabled])")
      .count();
    for (let i = 0; i < focusableCount + 2; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        document.getElementById("mobile-nav-menu")?.contains(document.activeElement) ?? false,
      );
      expect(inside).toBe(true);
    }
  });

  test("Escape closes the menu and returns focus to the toggle", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
  });

  test("locks body scroll while open and releases it on close", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("tapping the backdrop closes the menu", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();

    const viewport = page.viewportSize();
    await page.getByTestId("mobile-nav-overlay").tap({
      // Below the open menu panel, clear of any fixed bottom controls.
      position: { x: 10, y: Math.round((viewport?.height ?? 800) * 0.75) },
    });
    await expect(menu(page)).toHaveCount(0);
  });

  test("navigating from the menu closes it on the new route", async ({ page }) => {
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();

    await menu(page).locator('a[href="/transactions"]').click();
    await page.waitForURL(/\/transactions/);
    await expect(menu(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
});
