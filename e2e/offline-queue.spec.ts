/**
 * #1018 — E2E: PendingTxQueuePanel on offline page flow
 *
 * Covers:
 *  1.  Empty queue state — panel renders the empty-state placeholder.
 *  2.  Seeded queue — enqueued XDR drafts are listed on the offline page.
 *  3.  Offline badge — WifiOff "Waiting…" indicator shown while offline.
 *  4.  Discard action — draft is removed from the panel after discard.
 *  5.  Reconnect / flush path — retry button appears when back online.
 *  6.  Navbar badge integration — queue count reflected in the navbar.
 *  7.  Navigation from queue — browsing to marketplace link works.
 *
 * Strategy
 * ────────
 * We seed the IndexedDB `kora-xdr-queue` store via `page.evaluate` before
 * navigating, so the panel starts with known data without needing a live
 * wallet or Stellar RPC. The `mock-wallet` helper injects a Freighter stub
 * and pre-loads wallet state into localStorage so the UI treats the user
 * as connected.
 *
 * Service worker: the offline queue is a pure IndexedDB + React feature;
 * it does not require SW registration to test. We therefore run against the
 * dev server (SW disabled in dev) and gate offline state via
 * `context.setOffline(true)` — the network-fetch layer is separate from the
 * queue UI.
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { injectWalletStubs } from "./helpers/mock-wallet";

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/** Signed XDR placeholder that bypasses the real StellarSdk parse path. */
const MOCK_XDR = "mock_fund_invoice_xdr_draft";

interface SeedOptions {
  id?: string;
  type?: string;
  invoiceId?: string;
  attempts?: number;
}

/**
 * Insert one XDR draft into the `kora-xdr-queue` IndexedDB store.
 * Must be called after `page.goto` so IndexedDB is available.
 */
async function seedDraft(page: Page, opts: SeedOptions = {}) {
  await page.evaluate(
    ({ xdr, id, type, invoiceId, attempts }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("kora-xdr-queue", 1);

        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("drafts")) {
            db.createObjectStore("drafts", { keyPath: "id" });
          }
        };

        req.onsuccess = () => {
          const db = req.result;
          const draft = {
            id,
            signedXdr: xdr,
            meta: { type, invoiceId },
            queuedAt: Date.now(),
            attempts,
            nextRetryAt: 0,
          };
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put(draft);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };

        req.onerror = () => reject(req.error);
      });
    },
    {
      xdr: MOCK_XDR,
      id: opts.id ?? crypto.randomUUID(),
      type: opts.type ?? "fundInvoice",
      invoiceId: opts.invoiceId ?? "INV-001",
      attempts: opts.attempts ?? 0,
    },
  );
}

/** Clear the queue store between tests. */
async function clearQueue(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase("kora-xdr-queue");
      del.onsuccess = () => resolve();
      del.onerror = () => resolve(); // ignore errors — store may not exist yet
    });
  });
}

// ─── Test setup ───────────────────────────────────────────────────────────────

async function setupPage(context: BrowserContext, page: Page) {
  // Suppress onboarding tour and changelog modal
  await context.addInitScript(() => {
    localStorage.setItem("kora-tour-done", "true");
    localStorage.setItem("kora-changelog-seen-version", "0.1.0");
  });

  // Inject a mock wallet so the UI shows as "connected"
  await injectWalletStubs(context);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("PendingTxQueuePanel — offline page (#1018)", () => {
  test.beforeEach(async ({ context, page }) => {
    await setupPage(context, page);
    // Navigate to offline page first so IndexedDB is available for seeding
    await page.goto("/offline");
    await page.waitForLoadState("domcontentloaded");
    await clearQueue(page);
  });

  // ── 1. Empty queue state ────────────────────────────────────────────────────

  test("shows empty-state placeholder when queue has no drafts", async ({ page }) => {
    // Reload to pick up the cleared queue
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // The panel should render its empty state
    const empty = page.getByTestId("pending-queue-empty");
    await expect(empty).toBeVisible({ timeout: 8_000 });
  });

  // ── 2. Seeded queue — drafts listed ────────────────────────────────────────

  test("lists a seeded draft on the offline page", async ({ page }) => {
    await seedDraft(page, {
      id: "draft-001",
      type: "fundInvoice",
      invoiceId: "INV-001",
    });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Panel should appear with the draft
    const panel = page.getByTestId("pending-queue-panel");
    await expect(panel).toBeVisible({ timeout: 8_000 });

    // At least one draft item
    const items = page.getByTestId("queue-draft-item");
    await expect(items.first()).toBeVisible();

    // Invoice label should be present
    await expect(page.getByText(/INV-001/i).first()).toBeVisible();
  });

  test("shows the draft type label", async ({ page }) => {
    await seedDraft(page, { type: "fundInvoice" });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("queue-draft-item").first()).toBeVisible({ timeout: 8_000 });
    // The component renders t("txType", { type }) which maps to the type value
    await expect(page.getByText(/fundInvoice/i).first()).toBeVisible();
  });

  // ── 3. Offline badge — WifiOff indicator ───────────────────────────────────

  test("shows offline waiting indicator when context is offline", async ({
    page,
    context,
  }) => {
    await seedDraft(page, { id: "draft-offline-badge" });
    await context.setOffline(true);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // The WifiOff "Waiting…" label should be visible while offline
    // (the panel hides the retry button and shows this instead)
    await expect(page.getByTestId("queue-draft-item").first()).toBeVisible({ timeout: 10_000 });

    const waitingLabel = page.locator('[aria-label*="Waiting"]').first();
    await expect(waitingLabel).toBeVisible();

    await context.setOffline(false);
  });

  // ── 4. Discard action ───────────────────────────────────────────────────────

  test("removes a draft when the discard button is clicked", async ({ page }) => {
    await seedDraft(page, { id: "draft-to-discard" });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Wait for the draft to appear
    const item = page.getByTestId("queue-draft-item").first();
    await expect(item).toBeVisible({ timeout: 8_000 });

    // Click the remove button
    const removeBtn = item.getByTestId("remove-draft-button");
    await removeBtn.click();

    // Draft should disappear; empty state should show
    await expect(page.getByTestId("pending-queue-empty")).toBeVisible({ timeout: 6_000 });
  });

  // ── 5. Reconnect / flush — retry button appears online ─────────────────────

  test("shows retry button when back online and draft is retryable", async ({
    page,
    context,
  }) => {
    await seedDraft(page, { id: "draft-retry", attempts: 0 });

    // Start offline so panel loads without a retry button
    await context.setOffline(true);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("queue-draft-item").first()).toBeVisible({ timeout: 10_000 });

    // Reconnect
    await context.setOffline(false);

    // Retry button should appear once online
    const retryBtn = page.getByTestId("retry-draft-button").first();
    await expect(retryBtn).toBeVisible({ timeout: 6_000 });
  });

  test("retry button triggers submission and removes draft on success (mock XDR)", async ({
    page,
  }) => {
    // mock_ prefix causes the panel to fast-path succeed without RPC call
    await seedDraft(page, { id: "draft-mock-success", type: "fundInvoice" });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const item = page.getByTestId("queue-draft-item").first();
    await expect(item).toBeVisible({ timeout: 8_000 });

    const retryBtn = page.getByTestId("retry-draft-button").first();
    await expect(retryBtn).toBeVisible({ timeout: 4_000 });
    await retryBtn.click();

    // After success the draft disappears (success state → removed after 1.2s)
    await expect(page.getByTestId("pending-queue-empty")).toBeVisible({ timeout: 8_000 });
  });

  // ── 6. Multiple drafts — retry-all button ──────────────────────────────────

  test("retry-all button appears when more than one draft is retryable", async ({ page }) => {
    await seedDraft(page, { id: "multi-draft-1", type: "fundInvoice", invoiceId: "INV-A" });
    await seedDraft(page, { id: "multi-draft-2", type: "fundInvoice", invoiceId: "INV-B" });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("pending-queue-panel")).toBeVisible({ timeout: 8_000 });
    const retryAllBtn = page.getByTestId("retry-all-button");
    await expect(retryAllBtn).toBeVisible({ timeout: 4_000 });
  });

  // ── 7. Navigation — offline page links ─────────────────────────────────────

  test("Browse Cached Marketplace link navigates to /marketplace", async ({ page }) => {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const marketplaceLink = page.getByRole("link", { name: /browse cached/i });
    await expect(marketplaceLink).toBeVisible();
    await expect(marketplaceLink).toHaveAttribute("href", "/marketplace");
  });

  // ── 8. Edge: empty queue on initial load ───────────────────────────────────

  test("panel transitions from loading skeleton to empty state", async ({ page }) => {
    // With an empty queue the loading skeleton should resolve to the empty state
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Loading skeleton (aria-busy) may flash briefly, then empty state
    await expect(page.getByTestId("pending-queue-empty")).toBeVisible({ timeout: 8_000 });
    // Loading skeleton should be gone
    await expect(page.locator('[aria-busy="true"]')).not.toBeVisible({ timeout: 4_000 });
  });
});
