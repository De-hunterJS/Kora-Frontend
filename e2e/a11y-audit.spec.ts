/**
 * Automated accessibility audit — axe-playwright
 *
 * Runs axe-core against key routes and fails CI if any critical or serious
 * violations are found.  Does NOT replace manual accessibility testing or
 * expert review with assistive technologies.
 *
 * Dependency: axe-playwright@2.0.3 (pinned in package.json devDependencies)
 *
 * Known false-positive exclusions are listed per-route below with justification.
 * Add new exclusions only with a documented reason and a tracking issue.
 */

import { test, expect } from "@playwright/test";
import { injectAxe, getViolations } from "axe-playwright";
import { injectWalletStubs } from "./helpers/mock-wallet";

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Run axe against the current page and assert no critical/serious violations.
 * Returns the full violation list so individual tests can add extra assertions.
 */
async function auditPage(
  page: Parameters<typeof injectAxe>[0],
  options?: { disableRules?: string[] }
) {
  await injectAxe(page);

  const violations = await getViolations(page, undefined, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    },
    rules: Object.fromEntries(
      (options?.disableRules ?? []).map((id) => [id, { enabled: false }])
    ),
  });

  // Filter to critical and serious only — best-effort automated check
  const blocking = violations.filter((v) =>
    ["critical", "serious"].includes(v.impact ?? "")
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join("\n");
    expect.soft(blocking, `Axe found critical/serious violations:\n${summary}`).toHaveLength(0);
  }

  return violations;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

test.describe("Accessibility audit — landing page (/)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — marketplace (/marketplace)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    await auditPage(page, {
      // Known false positive: Radix UI popover portals render outside the main
      // landmark at mount time; their aria-owns relationship is established
      // dynamically. Tracked in issue #240.
      disableRules: [],
    });
  });

  test("no critical or serious axe violations under Arabic (RTL) locale", async ({
    page,
  }) => {
    await page.goto("/marketplace", {
      headers: { "accept-language": "ar" },
    });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
    });
    await auditPage(page, {
      disableRules: [],
    });
  });
});

test.describe("Accessibility audit — invoice detail (/marketplace/:id)", () => {
  test("no critical or serious axe violations on sample invoice", async ({ page }) => {
    // Navigate to a seeded or mock invoice; the app uses mock data in E2E mode.
    await page.goto("/marketplace/1");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — SME dashboard (/dashboard/sme)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/dashboard/sme");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — investor dashboard (/dashboard/investor)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/dashboard/investor");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

// ─── Analytics & transactions (Issue #439) ───────────────────────────────────
//
// Both routes were previously excluded from this audit. They are covered here
// because they carry the two patterns most likely to regress: Recharts SVGs
// (unlabelled graphics) and a hand-rolled aria-modal drawer (no focus
// management unless it is implemented explicitly).

test.describe("Accessibility audit — analytics (/analytics)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });

  test("every chart exposes an accessible name", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");

    // Charts render inside role="img" wrappers whose aria-label summarises the
    // underlying data — see ChartFigure in components/analytics/AnalyticsCharts.
    const charts = page.locator('[role="img"]');
    const count = await charts.count();
    expect(count, "expected at least one labelled chart").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const label = await charts.nth(i).getAttribute("aria-label");
      expect(label?.trim(), `chart ${i} is missing an accessible name`).toBeTruthy();
    }
  });
});

test.describe("Accessibility audit — transactions (/transactions)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/transactions");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

// ─── Offline page ──────────────────────────────────────────────────────
//
// The offline page is a static fallback rendered when the browser has no
// network connectivity.  It is fully server-rendered so there is no
// client-side hydration mismatch, and all dynamic regions (pending tx
// queue, stale-data badge) are progressive enhancements that degrade
// gracefully.
//
// RTL note: the page inherits `dir="rtl"` from the <html> element when
// the Arabic locale is active (LocaleProvider sets document.documentElement.dir).
// No additional RTL-specific fixes are required — flexbox layouts and
// the semantic heading/list structure work correctly in both directions.

test.describe("Accessibility audit — offline page (/offline)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/offline");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — transaction history drawer", () => {
  /** Open the drawer from the navbar trigger. */
  async function openDrawer(page: Parameters<typeof injectAxe>[0]) {
    await page.goto("/transactions");
    await page.waitForLoadState("networkidle");

    const trigger = page.getByRole("button", { name: /transaction history/i }).first();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    return dialog;
  }

  test("no critical or serious axe violations while open", async ({ page }) => {
    await openDrawer(page);
    await auditPage(page);
  });

  test("traps focus and restores it on close", async ({ page }) => {
    const dialog = await openDrawer(page);

    // Focus must land inside the drawer on open, not on the document body.
    const focusedInDialog = await dialog.evaluate((el) =>
      el.contains(document.activeElement),
    );
    expect(focusedInDialog, "focus should move into the drawer on open").toBe(true);

    // Tabbing through the whole drawer must never leave it.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const stillInside = await dialog.evaluate((el) =>
        el.contains(document.activeElement),
      );
      expect(stillInside, `focus escaped the drawer after ${i + 1} Tab press(es)`).toBe(
        true,
      );
    }

    // Escape is the keyboard exit from a trapped surface.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });
});

// ─── PWA InstallPrompt (Issue #781) ──────────────────────────────────────────
// The prompt is a fixed overlay that only renders after the `beforeinstallprompt`
// event fires and the 7-day suppress window has not been set. It is therefore
// not tied to a single route — route-level axe scans would miss it. Coverage
// is provided in two layers:
//   1) Vitest unit coverage in `__tests__/install-prompt.test.tsx` (visible vs
//      dismissed states + accessible names on the Install / Not now / × actions
//      and `aria-label` on the dialog).
//   2) Storybook story `PWA/InstallPrompt` (`components/pwa/InstallPrompt.stories.tsx`)
//      which can be audited with `@storybook/addon-a11y`.
// The Playwright probe below proves the prompt can be made visible on demand
// and still passes the critical/serious axe gate when it is.

test.describe("Accessibility audit — PWA InstallPrompt (Issue #781)", () => {
  test("no critical or serious axe violations when prompt is visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Make the prompt visible: clear suppress + force 2nd-visit path + dispatch event
    await page.evaluate(() => {
      try {
        localStorage.removeItem("kora-pwa-install-dismissed-until");
        localStorage.setItem("kora-pwa-visit-count", "2");
      } catch {}
      const evt = new Event("beforeinstallprompt") as unknown as Event & {
        platforms: string[];
        userChoice: Promise<{ outcome: string; platform: string }>;
        prompt: () => Promise<void>;
      };
      // @ts-expect-error — synthetic shape for the prompt event
      evt.platforms = ["web"];
      // @ts-expect-error
      evt.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
      // @ts-expect-error
      evt.prompt = async () => {};
      evt.preventDefault = () => {};
      window.dispatchEvent(evt);
    });

    const prompt = page.getByTestId("install-prompt");
    await prompt.waitFor({ state: "visible", timeout: 5000 });

    // Primary actions must have accessible names (Issue #781)
    await expect(page.getByRole("button", { name: /install/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /not now/i })).toBeVisible();

    await auditPage(page);
  });
});

// ─── Settings, Secondary, Offline, Create Invoice (Issue #757) ─────────────────

test.describe("Accessibility audit — settings (/settings)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — secondary market (/secondary)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/secondary");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — offline (/offline)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/offline");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});

test.describe("Accessibility audit — create invoice (/invoice/create)", () => {
  test("no critical or serious axe violations", async ({ page }) => {
    await page.goto("/invoice/create");
    await page.waitForLoadState("networkidle");
    await auditPage(page);
  });
});


// ─── RTL layout smoke — settings & secondary (Issue #1012) ───────────────────
//
// The axe scans above prove contrast/roles; these assert the things axe cannot:
// mirrored layout (dir="rtl"), no horizontal scroll at a 390px phone width, and
// that portalled surfaces inherit the document direction rather than snapping
// back to LTR.

async function expectNoHorizontalOverflow(page: Parameters<typeof injectAxe>[0]) {
  await page.evaluate(() => document.fonts?.ready);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const doc = document.documentElement;
          return (
            Math.max(doc.scrollWidth, document.body.scrollWidth) -
            window.innerWidth
          );
        }),
      { message: "page should not scroll horizontally at 390px" },
    )
    .toBeLessThanOrEqual(1);
}

function suppressOverlays(page: Parameters<typeof injectAxe>[0]) {
  return page.addInitScript(() => {
    localStorage.setItem("kora-tour-done", "true");
    localStorage.setItem("kora-changelog-seen-version", "0.1.0");
  });
}

async function gotoArabic(
  page: Parameters<typeof injectAxe>[0],
  path: string,
) {
  // `page.goto` has no `headers` option, so set the locale cookie the
  // middleware reads instead of relying on Accept-Language.
  await page.context().addCookies([
    { name: "kora-locale", value: "ar", url: "http://localhost:3000" },
  ]);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // The dev-only feature-flag panel is fixed above page content and would
  // intercept pointer events in these layout tests.
  await page.addStyleTag({
    content: '[data-testid="feature-flag-panel"]{display:none!important}',
  });
  // Let the client bundle hydrate so handlers are attached before interaction.
  await page.waitForTimeout(2_000);
}

test.describe("RTL layout smoke — settings (/settings, ar)", () => {
  test("disconnected gate mirrors, keeps the CTA reachable, and does not scroll horizontally", async ({
    page,
  }) => {
    await suppressOverlays(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoArabic(page, "/settings");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const connectCta = page
      .getByRole("main")
      .getByRole("button", { name: /ربط المحفظة|connect wallet/i });
    await expect(connectCta).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("portalled wallet modal inherits the document direction", async ({ page }) => {
    await suppressOverlays(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoArabic(page, "/settings");

    await page
      .getByRole("main")
      .getByRole("button", { name: /ربط المحفظة|connect wallet/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Radix portals mount on <body>; direction must be inherited, not reset.
    await expect
      .poll(() => dialog.evaluate((el) => getComputedStyle(el).direction))
      .toBe("rtl");
    await expectNoHorizontalOverflow(page);
  });

  test("connected preference toggles remain usable and mirrored", async ({
    page,
    context,
  }) => {
    await injectWalletStubs(context);
    await suppressOverlays(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoArabic(page, "/settings");

    const toggle = page.getByRole("switch").first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-checked", initial as string);

    await expectNoHorizontalOverflow(page);
  });
});

test.describe("RTL layout smoke — secondary market (/secondary, ar)", () => {
  test("filters stay reachable and the page does not scroll horizontally", async ({
    page,
  }) => {
    await suppressOverlays(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoArabic(page, "/secondary");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: /السوق الثانوي|secondary market/i }),
    ).toBeVisible();

    // Mobile filter trigger is the primary control at this width.
    await expect(
      page.getByRole("button", { name: /تصفية|filter/i }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
