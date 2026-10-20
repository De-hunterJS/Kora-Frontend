# Design System

The Kora frontend uses a semantic, token-based design system built on Tailwind CSS, CSS custom properties, and Radix UI primitives.

## Source of truth

| Layer | Location |
| ----- | -------- |
| CSS tokens | `app/globals.css` (`:root` and `.dark` blocks) |
| Tailwind mapping | `tailwind.config.ts` |
| UI primitives | `components/ui/` |
| Domain components | `components/invoice/`, `components/wallet/`, etc. |

## Theming

- **Dark-mode-first** with light mode via the `class` strategy (`darkMode: ["class"]` in Tailwind).
- The persisted preference (`light` / `dark` / `system`) lives in `uiStore`; an inline bootstrap script in `app/layout.tsx` applies the resolved class before first paint to prevent FOUC.
- `lib/theme.ts` is the **single source of truth** for theme resolution: `resolveTheme()` is shared by the inline bootstrap script (`THEME_INIT_SCRIPT`) and `components/layout/ThemeProvider.tsx`, so the pre-paint class and the hydrated class can never drift when the OS switches color scheme. A unit test executes the script and compares its result against `resolveTheme` for every preference/OS combination.
- Color tokens are defined as **HSL components** (e.g. `--color-primary: 174 72% 40%`) and consumed as `hsl(var(--primary))` in Tailwind.

### Browser chrome color (`themeColor`)

The mobile browser UI bar (and PWA title bar) follows the resolved theme via `THEME_COLORS` in `lib/theme.ts`:

| Token | Value | Surface |
| ----- | ----- | ------- |
| `THEME_COLORS.light` | `#ffffff` | white page background |
| `THEME_COLORS.dark` | `#09090b` | zinc-950 dashboard background |

- `app/layout.tsx` exports a media-scoped `viewport.themeColor` (via `buildViewportThemeColor()`) so the server-rendered `<meta name="theme-color">` tags match the OS preference before hydration.
- After hydration, `ThemeProvider` calls `applyBrowserThemeColor(resolved)`, which forces the resolved color onto every `theme-color` tag — this is what makes an in-app override (e.g. OS light + user-picked dark) win over the OS preference.
- The manifest's `theme_color` / `background_color` (built in `lib/pwa/manifest.ts`) use the same dark token so the PWA install splash stays consistent. Keep them in sync via `THEME_COLORS`.

### PWA manifest localization

The manifest is served by the `/manifest.json` route handler (`app/manifest.json/route.ts`), not a static file, so it renders for the active `kora-locale`:

- Shortcut **names** reuse the translated navbar labels (`nav.marketplace`, `nav.createInvoice`) so a shortcut's title matches its destination.
- Shortcut `short_name`, descriptions and screenshot labels come from the `pwa.manifest` message namespace; missing keys fall back to English.
- Shortcut URLs are **locale-agnostic** app paths (`/marketplace`, `/invoice/create`). The locale lives in the `kora-locale` cookie, never in the URL, so localized manifests must not ship locale-prefixed shortcut paths.

## Token categories

### Color

Semantic tokens in `globals.css`:

- **Brand:** `--color-primary`, `--color-accent`
- **Surfaces:** `--color-surface`, `--color-surface-elevated`, `--color-surface-muted`
- **Text:** `--color-text`, `--color-text-muted`, `--color-text-subtle`
- **Feedback:** `--color-success`, `--color-warning`, `--color-destructive`, `--color-info`

Legacy shadcn-compatible aliases (`--background`, `--foreground`, `--card`, etc.) map to the semantic tokens for compatibility with existing UI components.

### Spacing & typography

Spacing scale (`--space-1` … `--space-12`) and font sizes (`--font-size-xs` … `--font-size-3xl`) are defined in `globals.css` and referenced where needed for consistent rhythm.

## UI primitives

Reusable building blocks live under `components/ui/`. Every file in that folder is listed below with its purpose and when to use it. Prefer composing these primitives over one-off styles. Use `cn()` from `lib/utils` for conditional class merging.

### Form controls

| Primitive | File | Purpose | When to use |
| --------- | ---- | ------- | ----------- |
| `Button` | `button.tsx` | Primary CTA, secondary, ghost, danger variants with loading spinner, `asChild`, and `iconLabel` a11y support. | Any clickable action. Use `isLoading` for async submits; `iconLabel` for icon-only buttons. |
| `Input` | `input.tsx` | Text input with label, error, hint, and size variants. | Single-line text entry (debtor name, invoice number, search). |
| `Textarea` | `textarea.tsx` | Multi-line text with auto-resize, label, error, hint. | Description/memo, incident notes, long-form entry. |
| `NumberInput` | `number-input.tsx` | Numeric input with steppers, min/max, currency formatting. | Amount fields (invoice amount, min investment, funding amount). |
| `Select` | `select.tsx` | Custom select with grouped options, search, and Radix popover. | Jurisdiction, category, risk tier, status filters. |
| `DatePicker` | `date-picker.tsx` | Calendar popover (Radix Popover + date-fns), min/max clamping, keyboard nav, hidden `input` for `react-hook-form`. | Due date, listing expiry, any date field. |
| `FileInput` | `file-input.tsx` | Drag-and-drop file dropzone with validation and preview. | Invoice PDF upload in the mint wizard. |
| `RangeSlider` | `range-slider.tsx` | Dual-thumb range slider for numeric intervals. | APR range, amount range filters on marketplace. |

### Layout & overlay

| Primitive | File | Purpose | When to use |
| --------- | ---- | ------- | ----------- |
| `Card` | `card.tsx` | Surface container with header, content, footer slots and hover/selected states. | Invoice cards, dashboard stats wrappers, panel sections. |
| `Dialog` | `dialog.tsx` | Radix Dialog (modal) with overlay, title, description, focus trap, and close affordances. | Confirmations (CancelInvoice, Repay, Share), KYC dialogs, wizard review. |
| `Drawer` | `drawer.tsx` | Slide-in panel from the right with focus trap, Escape, backdrop, and scroll lock. | Position detail, analytics breakdowns, history drawer. |
| `BottomSheet` | `bottom-sheet.tsx` | Mobile slide-up sheet with drag-handle swipe-to-dismiss, focus trap, Escape, and scroll lock (`lg:hidden`). | Marketplace filters on mobile, secondary market filters. |
| `Breadcrumb` | `breadcrumb.tsx` | Navigational hierarchy trail with separators and current-page marking. | Page headers where parent context matters (e.g. invoice detail → marketplace). |
| `BackButton` | `back-button.tsx` | Router-aware back navigation with icon and label. | Detail pages, wizard steps, dashboard drill-downs. |
| `PrintLayout` | `print-layout.tsx` | Print/PDF export wrapper with `@media print` rules and page-break controls. | Invoice PDF generation and print preview. |

### Feedback & state

| Primitive | File | Purpose | When to use |
| --------- | ---- | ------- | ----------- |
| `Badge` | `badge.tsx` | Status pill with color variants (default, secondary, destructive, outline, success, warning). | Risk tier, invoice status, live counts. |
| `Progress` | `progress.tsx` | Radix Progress bar with determinate value and accessible label. | Funding progress on invoice cards and detail. |
| `Skeleton` | `skeleton.tsx` | Animated placeholder block/circle for loading states. | Any async surface before data resolves. |
| `EmptyState` | `EmptyState.tsx` | Illustrated empty state with title, description, action slot and variant (`default`, `search`, `error`). | No results, no invoices, filtered-empty marketplace. |
| `ErrorBoundary` | `error-boundary.tsx` | React error boundary with fallback UI, retry, and classified error kinds. | Route-level and widget-level crash containment. |
| `ErrorPage` | `ErrorPage.tsx` | Full-page error display with translated title/description and reset CTA. | `error.tsx` and `global-error.tsx` boundaries. |
| `Tooltip` | `tooltip.tsx` | Radix Tooltip with delay, side, and arrow. | Icon buttons, truncated labels, APR explainers. |
| `animations.tsx` | `animations.tsx` | Framer-motion helpers: `SuccessCheckmark`, reduced-motion guard, shared transitions. | Success states (minted, funded), micro-interactions. |
| `CountdownTimer` | `CountdownTimer.tsx` | Live countdown with ICS export helper for maturity reminders. | Time-to-maturity on invoice cards and detail. |

### Data display

| Primitive | File | Purpose | When to use |
| --------- | ---- | ------- | ----------- |
| `DataTable` | `data-table.tsx` | Headless data table with sortable columns, row selection, and empty state. | SME/investor dashboards, transactions list. |
| `Pagination` | `pagination.tsx` | Page navigation with ellipsis, previous/next, and accessible labels. | Any paginated list (marketplace, transactions, dashboards). |
| `StatCard` | `stat-card.tsx` | Metric card with value, trend, icon, and change indicator. | Portfolio stats, marketplace aggregates, analytics KPIs. |
| `APRDisplay` | `apr-display.tsx` | Formatted APR with tier badge and tooltip. | Invoice cards, detail financing terms, comparison table. |
| `Highlight` | `Highlight.tsx` | Query-aware text highlighter that wraps matches in `<mark>`. | Search results (marketplace, transactions, address book). |
| `StellarAddress` | `stellar-address.tsx` | Truncated Stellar `G…` address with copy and explorer link. | Seller address, debtor wallet, transaction from/to. |
| `StellarTxLink` | `stellar-tx-link.tsx` | Transaction hash link to Stellar Expert with copy and external icon. | Toast, history, detail confirmations. |
| `investor-dashboard-skeleton` | `investor-dashboard-skeleton.tsx` | Composite skeleton layout mirroring the investor dashboard grid. | Loading state for `/dashboard/investor`. |

### Utilities & affordances

| Primitive | File | Purpose | When to use |
| --------- | ---- | ------- | ----------- |
| `CopyButton` | `CopyButton.tsx` | Copy-to-clipboard button with copied feedback, `useTranslations("copyButton")`, and tooltip. | Address, hash, share link, taxonomy copy. |
| `ShortcutBadge` | `ShortcutBadge.tsx` | Keyboard shortcut hint badge (`⌘K`, `?`, etc.). | Command palette, shortcut reference modal. |
| `index.ts` | `index.ts` | Barrel re-exports for the most commonly composed primitives. | Import via `components/ui` instead of deep paths. |

> **Note on `index.ts`:** the barrel currently re-exports `button`, `card`, `badge`, `skeleton`, `progress`, `input`, `textarea`, `number-input`, `date-picker`, `file-input`, `pagination`, `dialog`, `select`, `stat-card`, `data-table`, `CopyButton`, `Highlight`, `apr-display`, `drawer`, and `range-slider`. Other primitives (e.g. `bottom-sheet`, `breadcrumb`, `tooltip`, `EmptyState`) are imported via their direct paths — this is intentional and not a gap; extend the barrel only when a primitive is used widely enough to justify it.

## Storybook

Component stories live alongside components as `*.stories.tsx` files. Storybook
packages are **not currently wired** as an `npm run storybook` script — visual
coverage runs through the Vitest snapshot test instead. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

Run the snapshot suite for stories:

```bash
npm run test -- __tests__/stories.snapshot.test.tsx
```

If you make intentional markup changes, regenerate the committed snapshots:

```bash
npm run test -- __tests__/stories.snapshot.test.tsx -u
```

Snapshots are stored in `__tests__/__snapshots__/` and must be committed with
your change.

- `npm run storybook` — dev server at `http://localhost:6006`
- `npm run build-storybook` — static build
- `npm run test -- __tests__/stories.snapshot.test.tsx` — Vitest snapshot coverage without a dev server

## Adding new tokens

1. Add the CSS variable to `:root` and `.dark` in `app/globals.css`.
2. Map it in `tailwind.config.ts` under `theme.extend`.
3. Use the Tailwind utility in components — avoid hard-coded hex values in feature code.

## Adding a new primitive

1. Create `components/ui/<name>.tsx` following the existing patterns (forwardRef where appropriate, `cn()` for classes, `aria-*` for a11y, `useTranslations` only when the primitive owns user-facing copy).
2. Add `components/ui/<name>.stories.tsx` with at least `Default` and one variant/accessibility story.
3. Export it from `components/ui/index.ts` if it is broadly reused; otherwise document its direct import path in the table above.
4. Update this inventory doc so the new primitive appears in the correct table.

## Layout & Landmark Structure

Screen readers rely on semantic landmarks to navigate page regions efficiently. All major layout surfaces expose explicit ARIA roles and labels:

| Component | Landmark | Label | Rationale |
| --------- | -------- | ----- | --------- |
| `Header` (navbar) | `banner` | Implicit via `<header>` in top-level layout | Primary site navigation; one per page |
| `Footer` | `contentinfo` | `aria-labelledby="footer-copyright"` | Copyright, changelog, shortcuts; links footer region to copyright text |
| `main` (layout children) | `main` | Implicit via `<main>` wrapper in layout | Primary page content; one per page |

### Focus Management

- **Modal dialogs** (`Dialog`, `Drawer`, `BottomSheet`) automatically trap focus and restore it to the trigger element on close via Radix UI primitives.
- **Footer changelog button** stores a ref to the trigger; when `uiStore.changelogOpen` transitions from `true` → `false`, focus is programmatically restored to the button via `useEffect`.
- **Page navigation** (via Next.js `<Link>`) moves focus to the new page's `<main>` element automatically; no custom focus management is needed for route changes.

### Skip Links

Currently not implemented. Consider adding a visually-hidden "Skip to main content" link at the start of `<body>` if user feedback indicates keyboard users are navigating through repetitive chrome on every page load.

### Testing Landmarks

Run `npm run test:a11y` (if available) to audit landmark structure. Manual verification:

1. Enable a screen reader (NVDA on Windows, VoiceOver on macOS).
2. Navigate by landmarks (NVDA: `D`/`Shift+D`, VoiceOver: `VO+U` → Landmarks).
3. Verify `banner`, `main`, and `contentinfo` are announced and navigable.
4. Confirm footer's label reads "Kora Protocol copyright" or similar localized text.

