# Contributing to Kora Protocol

Thank you for helping improve Kora Protocol. Kora is an on-chain invoice financing app on Stellar: SMEs tokenize invoices, investors fund invoice positions, and wallet flows connect the UI to Soroban and USDC activity.

This guide is written for first-time contributors. Follow it from top to bottom when you set up the project, pick an issue, make a branch, test your work, and open a pull request.

## Contents

- [Before You Start](#before-you-start)
- [Fork and Clone](#fork-and-clone)
- [Local Setup](#local-setup)
- [Mock Data Mode](#mock-data-mode)
- [Daily Development Commands](#daily-development-commands)
- [Storybook](#storybook)
- [Component Test Fixtures](#component-test-fixtures)
- [Internationalization (i18n)](#internationalization-i18n)
  - [Checklist for a four-locale PR](#checklist-for-a-four-locale-pr)
- [Your First Issue](#your-first-issue)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
- [Testing Checklist](#testing-checklist)
- [Pull Request Checklist](#pull-request-checklist)
- [Code Style](#code-style)
- [Getting Help](#getting-help)

## Before You Start

Install these tools:

- Node.js 18 or newer.
- npm 9 or newer.
- Git.
- A GitHub account.
- Freighter or another Stellar wallet extension if you are testing wallet flows.

This repository uses npm. Use `npm install` for local setup so npm can reconcile `package.json` with the lockfile when dependencies change.

## Fork and Clone

1. Fork `OpenLedger-Foundation/Kora-Frontend` on GitHub.
2. Clone your fork:

```bash
git clone https://github.com/<your-github-user>/Kora-Frontend.git
cd Kora-Frontend
```

3. Add the upstream repository:

```bash
git remote add upstream https://github.com/OpenLedger-Foundation/Kora-Frontend.git
git fetch upstream
```

4. Start every new task from the latest upstream `main`:

```bash
git switch main
git pull --ff-only upstream main
```

## Local Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

The example file documents the variables the app expects. Do not commit `.env.local`; it is ignored by Git and may contain private values.

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

### Docker Development

The Docker path is useful for contributors who want a reproducible local
environment without installing Node modules on the host:

```bash
cp .env.example .env.local
docker compose up --build
```

After the app starts, visit `http://localhost:3000` and verify hot reload by
editing a component or copy string. Source files are bind-mounted into the
container; `node_modules` stays in a container volume. Rebuild the image after
dependency changes with `docker compose build --no-cache kora-frontend`.

## Mock Data Mode

Mock data mode lets you work on marketplace pages, SME dashboards, investor views, invoice cards, filters, and many UI states without live Stellar contracts.

Use mock data mode when:

- You are building UI.
- You are adding tests for stores, components, filters, or formatting.
- You do not need a real wallet signature or Soroban transaction.

Check `.env.example` for the mock-data flag. If it is enabled in `.env.local`, you can browse the app without live contract IDs or Pinata credentials.

Use a wallet only when the issue specifically touches wallet connection, transaction signing, funding, repayment, or network mismatch behavior. For wallet testing, use Stellar Testnet and never commit seed phrases, private keys, or real credentials.

## Daily Development Commands

Use these commands before you open a PR:

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

Other useful commands:

```bash
npm run test:watch       # run Vitest in watch mode
npm run test:coverage    # generate a coverage report
npm run test:e2e         # run Playwright end-to-end tests (all projects)
npm run test:components  # browser component tests (Playwright --project=components)
npm run test:mobile      # mobile E2E (Pixel 5 emulation)
npm run test:a11y        # axe audit for key routes (e2e/a11y-audit.spec.ts)
npm run test:a11y:all    # a11y + skip-link checks (a11y-audit + accessibility)
npm run check:i18n       # locale parity check (messages/*.json)
npm run storybook        # local Storybook dev server (p6006) — requires storybook deps
npm run build-storybook  # static Storybook build
npm run format:check     # check Prettier formatting
npm run format           # format files with Prettier
```

These map 1:1 to CI entrypoints — see `.github/workflows/test.yml` (`test:e2e`, `test:components`, `test:mobile`) and `.github/workflows/a11y.yml` (`test:a11y`). The `storybook` scripts are available when `@storybook/*` deps are installed; otherwise `npm run test -- __tests__/stories.snapshot.test.tsx` (Vitest) covers story rendering without a dev server (see [Storybook](#storybook)).

If a command fails because of existing unrelated failures, mention that clearly in your PR description and include the exact command output that proves your changed area was tested.

## Storybook

Component stories live beside components as `*.stories.tsx` files. Use the
contributor scripts:

```bash
npm run storybook          # dev server at http://localhost:6006 (requires @storybook/* deps)
npm run build-storybook    # static build to ./storybook-static
```

If Storybook deps are not installed, Vitest snapshot coverage provides the same
render check without a dev server:

```bash
npm run test -- __tests__/stories.snapshot.test.tsx
```

If you make intentional markup changes, update snapshots with:

```bash
npm run test -- __tests__/stories.snapshot.test.tsx -u
```

Add or update stories when you change reusable UI in `components/ui`, invoice
cards, empty states, dialogs, drawers, and similar pieces.
Or using the full `--updateSnapshot` flag:

```bash
npx vitest run __tests__/stories.snapshot.test.tsx --updateSnapshot
```

The generated snapshots are stored in `__tests__/__snapshots__/` and must be committed to the repository.

## Component Test Fixtures

For local QA and isolated component testing (such as Playwright component tests for `FileInput`, `RangeSlider`, and `DatePicker`), an isolated test fixture page is available at `/test-components`.

This route is development-only and is controlled by the `test-components` feature flag
([`NEXT_PUBLIC_ENABLE_TEST_COMPONENTS`](docs/feature-flags.md#flag-reference)).
In development (`NODE_ENV === "development"`), the page is always accessible.
In production builds or on non-dev deployments, requests to `/test-components` are
automatically redirected to the home page (`/`) unless the flag is explicitly enabled via env var.
See [Feature Flags § test-components](docs/feature-flags.md#flag-reference) for more details.

## Internationalization (i18n)

Kora ships in four locales, using [`next-intl`](https://next-intl.dev/): **English** (`en`, the source
of truth), **Spanish** (`es`), **Arabic** (`ar`, right-to-left), and **Brazilian Portuguese** (`pt-BR`).
All message catalogs live in `messages/`:

```text
messages/
  en.json      # source of truth — every key originates here
  es.json
  ar.json
  pt-BR.json
```

Each file is a nested JSON object grouped by feature/component namespace (`wallet`, `marketplace`,
`createInvoice`, `invoiceCard`, `common`, and so on). **All four files must contain exactly the same set
of keys**, in the same nested shape. This is enforced in CI — see [Checking parity](#checking-parity)
below — so a PR that adds an English string without its translations will fail the build.

### Checklist for a four-locale PR

Copy this into your PR description and tick it off. Each step links to the
detail below.

```markdown
- [ ] Key added to `messages/en.json` under the right namespace
- [ ] Same key, same nesting path, added to `es.json`, `ar.json`, `pt-BR.json`
- [ ] ICU placeholders identical in all four (`{count}` stays `{count}`)
- [ ] No user-facing string left hardcoded in the component
- [ ] `npm run check:i18n` passes locally
- [ ] Checked the UI in Arabic (RTL) if the change is visual
- [ ] Any untranslated placeholder copy called out explicitly in this PR
```

**The one command that matters:**

```bash
npm run check:i18n
```

It is wired into CI, so a locale mismatch blocks merge the same way a failing
type-check does. Running it locally turns a round-trip through CI into a
five-second check.

#### Common pitfalls

| Pitfall | What happens | Fix |
|---|---|---|
| Translated a placeholder name | `{count}` became `{cuenta}` — the value never interpolates and users see the literal brace text | Placeholder **names** are never translated; only the text around them |
| Dropped a placeholder | `"Fund {amount} USDC"` → `"Financiar USDC"` — the number silently vanishes | `check:i18n` catches this; run it |
| Added the key to `en.json` only | CI fails on parity | Add to all four in the same commit |
| Different nesting path per locale | Key exists but `next-intl` can't resolve it | Same path in every file — `marketplace.filters.title`, not `marketplace.title` in one |
| Pluralisation assumed from English | Arabic has six plural forms; a hand-rolled `{count} item(s)` reads wrong | Use ICU `plural` syntax and let the locale decide |
| Only checked the LTR layout | Arabic silently breaks on absolutely-positioned elements — dropdowns, tooltips, badges | Switch the language toggle to Arabic and look; see [Right-to-left (Arabic)](#right-to-left-arabic) |
| Placeholder English copy merged quietly | A locale drifts untranslated for months — this has already happened to `ar.json` | Say so in the PR description so a translator can follow up |

Detail on each of these follows.

### Adding or changing a string

1. **Never hardcode user-facing text in a component.** Add a key under the relevant namespace in
   `messages/en.json` first, then pull it in with `next-intl`:

   ```tsx
   import { useTranslations } from "next-intl";

   const t = useTranslations("invoiceCard");
   // ...
   <button>{t("fundInvoice")}</button>
   ```

   For strings with dynamic values, use ICU placeholders and pass them as the second argument:

   ```json
   // messages/en.json
   "showing": "Showing {count} listed invoices"
   ```

   ```tsx
   t("showing", { count: invoices.length })
   ```

2. **Add the same key, translated, to `es.json`, `ar.json`, and `pt-BR.json`** — same nesting path,
   same placeholder names (`{count}` must stay `{count}` in every locale; only the surrounding text
   changes). Placeholder names are not translated.

3. If you don't speak one of the target languages, it is fine to open the PR with the English string
   copied into the other three files **as a temporary placeholder**, but say so explicitly in the PR
   description (e.g. "es/ar/pt-BR strings for `feedback.newField` are untranslated placeholders —
   need review from a native speaker") so a translator can follow up before merge. Do not let a
   placeholder merge silently — this repo has previously had an entire locale (`ar.json`) sit almost
   completely untranslated for a long time because placeholder copies went in without anyone flagging
   them for follow-up.

4. Keep proper nouns and technical/protocol terms consistent with the rest of the file you're editing —
   e.g. Stellar, Soroban, Kora Protocol, USDC, XLM, IPFS, NFT, APR are generally left in Latin script
   across all four locales, matching the existing convention in each file.

### Checking parity

Run the same check CI runs before opening a PR:

```bash
npm run check:i18n
```

This fails if any locale is missing a key, has an extra key not present in `en.json`, or has a
translated string whose ICU placeholders don't match the English source (e.g. a translation that
dropped `{amount}`). It's wired into the `test` GitHub Actions workflow, so a locale mismatch blocks
merge the same way a failing type-check does.

### Right-to-left (Arabic)

`ar` is a right-to-left locale (see `rtlLocales` in `i18n/config.ts`). When building or editing UI:

- Prefer logical Tailwind classes (`ps-*`/`pe-*`, `ms-*`/`me-*`, `start-*`/`end-*`,
  `text-start`/`text-end`) over physical ones (`pl-*`/`pr-*`, `ml-*`/`mr-*`, `left-*`/`right-*`,
  `text-left`/`text-right`) so layout flips correctly under `dir="rtl"`. The `rtl:` variant
  (`tailwind.config.ts`) is the escape hatch when a value genuinely must change rather than mirror.
- Check components that position things absolutely (dropdowns, tooltips, badges, inputs with
  leading icons) with the language switcher set to Arabic — absolute positioning is the most common
  place RTL breaks silently.
- Directional icons (arrows, chevrons) generally should flip; apply `rtl:rotate-180` (see
  `components/layout/LanguageSwitcher.tsx`).
- Motion and transforms are not mirrored automatically: a checked toggle that slides
  `translate-x-5` in LTR needs a matching `rtl:-translate-x-5` so the knob still travels away from
  the inline-start edge.

Before merging UI work, run the RTL smoke checks in `e2e/a11y-audit.spec.ts` (they cover
`/settings` and `/secondary` at 390px, portaled-dialog direction, and horizontal overflow) and
confirm no horizontal scroll on a 390px viewport.

### Category Taxonomy & Preview Mode

Kora organizes marketplace invoices by industry taxonomy (e.g. `manufacturing`, `technology`, `agriculture`, `logistics`, `healthcare`, etc.). To keep category taxonomy definitions and translations synchronized across metadata schemas (`lib/invoiceMetadata.ts`), filters (`components/marketplace/filters.tsx`), and message catalogs (`messages/*.json`), Kora includes an interactive Developer Category Taxonomy Preview.

#### Enabling the Preview Panel
Set the feature flag in `.env.local`:
```bash
NEXT_PUBLIC_ENABLE_CATEGORY_TAXONOMY_PREVIEW=true
```

When enabled, a **Taxonomy Preview** pill appears in the marketplace category filter header. The preview panel allows contributors to:
- View all active taxonomy keys, labels, and icons.
- Check live invoice count distribution against current inventory.
- Identify unused / zero-inventory categories requiring test seed data or review.
- Inspect i18n translation parity across English (`en`), Spanish (`es`), Arabic (`ar`), and Portuguese (`pt-BR`).
- Copy the canonical category taxonomy definition directly to clipboard.

When adding or renaming an invoice category:
1. Update `SUPPORTED_CATEGORIES` in `lib/invoiceMetadata.ts`.
2. Add the category definition to `CATEGORIES` in `components/marketplace/filters.tsx`.
3. Add translated strings to `marketplace.categoryLabels.<key>` across `en.json`, `es.json`, `ar.json`, and `pt-BR.json`.
4. Run `npm run check:i18n` to ensure all locale catalogs maintain parity.

Secondary-market filter option labels are defined in the `secondary.filters`
message namespace. Keep option values stable for URL encoding, and translate
only their display labels through `next-intl`.

### Manually testing the language switcher

The switcher lives in `components/layout/LanguageSwitcher.tsx` (rendered in the navbar) and persists
the chosen locale via `i18n/LocaleProvider.tsx`. When testing a change, switch locales and click
through at least:

- The marketplace (`/marketplace`) — filters, sort labels, empty states, invoice cards.
- The invoice-creation wizard (`/invoice/create`) — all three steps, validation messages, the live
  preview panel, and the upload/mint confirmation screen.

These two flows have the deepest, most frequently-touched translation surface in the app, so they're
the fastest way to catch a missed `t()` call or a broken placeholder.

### Known gaps / intentional exceptions

- **Risk-tier codes** (`AAA`, `AA`, `A`, `BBB`, `BB`, `B`, `CCC` in the marketplace risk filter) are
  rating-agency-style codes and are intentionally left untranslated in all locales.
- **Network/protocol labels** (`Testnet`, `Mainnet`, `Soroban RPC`, `Horizon API`, `TESTNET` badge) are
  kept in English across all locales to match Stellar's own tooling and documentation.
- A handful of lower-level `components/ui/*` primitives (button, card, badge, pagination, data-table,
  select, drawer, skeleton, etc.) intentionally take label text as props from their callers rather than
  owning `useTranslations` themselves — that's expected, not a gap.
- As of this writing, several larger page-level surfaces beyond the marketplace and invoice-creation
  wizard — both dashboards (`app/dashboard/sme`, `app/dashboard/investor`), `app/analytics`,
  `app/transactions`, and the landing page (`app/page.tsx`) — as well as some feature components
  (e.g. `PortfolioDonut`, `ComparisonBar`/`ComparisonTable`, `CommandPalette`, `PositionDetailDrawer`)
  still render hardcoded English strings even though matching keys already exist in `messages/en.json`
  for most of them. This is tracked as follow-up work, not an intentional design decision — if you're
  picking up an issue in one of those areas, wiring its strings to `useTranslations` while you're in
  there is welcome.

## Your First Issue

Start with small issues that have clear files, acceptance criteria, and tests:

```text
is:issue is:open label:"good first issue"
```

You can also look for documentation, test, or accessibility issues labeled
`help wanted`. Before starting, read the issue comments. Do not take an issue
that is already assigned. If a maintainer asks contributors to apply first,
comment on the issue and wait for assignment.

## Branch Naming

Use short, descriptive branch names:

```bash
git switch -c docs/contributing-quickstart
git switch -c test/invoice-store-filters
git switch -c fix/wallet-network-mismatch
git switch -c feat/marketplace-filter-chips
```

Recommended prefixes:

- `docs/` for documentation only.
- `test/` for tests only.
- `fix/` for bug fixes.
- `feat/` for new user-facing behavior.
- `chore/` for tooling, configuration, or maintenance.

## Commit Messages

Use Conventional Commits:

```text
docs(contributing): add contributor quick-start guide
test(invoice-store): cover filter combinations
fix(wallet): handle network mismatch reconnects
feat(marketplace): add active filter chip removal
```

Keep commits focused. If a commit includes unrelated formatting, generated output, and feature code together, it is harder to review.

## Testing Checklist

Choose the smallest useful validation for your change:

- Documentation only: run `npm run format:check` if Markdown formatting changed, and verify links/commands manually.
- Utility functions: run `npm run test -- <test-file>`.
- Components or hooks: run the relevant Vitest file and `npm run lint`.
- UI flows: run Storybook or Playwright where the issue asks for browser behavior.
- Shared behavior: run `npm run lint`, `npm run type-check`, `npm run test`, and `npm run build`.

For coverage issues, run:

```bash
npm run test:coverage
```

Add the coverage summary or relevant excerpt to the PR description when the issue asks for it.

## Pull Request Checklist

Before opening a PR:

- Rebase on the latest upstream `main`.
- Keep the PR limited to the issue scope.
- Link the issue with `Closes #123`.
- Explain what changed and why.
- List every command you ran.
- Add screenshots or recordings for UI changes.
- Mention known limitations or existing unrelated failures.
- Confirm no secrets, private keys, wallet seed phrases, or `.env.local` values are included.

Example PR body:

```text
## Summary

- Added focused tests for invoice store category, APR, jurisdiction, and risk filters.
- Added fixture coverage for empty-result sorting.

Closes #235

## Testing

- [x] npm run test -- store/__tests__/invoiceStore.test.ts
- [x] npm run lint
```

## Pre-commit Hooks

This project uses [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) to run `eslint --fix` and `tsc --noEmit` on staged `.ts`/`.tsx` files before every commit. The hook must complete cleanly for the commit to succeed.

If the hook fails, fix the reported errors before committing. Lint errors are printed directly in the terminal output.

Emergency bypass (use sparingly — CI will still catch errors):

```bash
git commit --no-verify -m "chore: emergency fix"
```

Never use `--no-verify` for normal development. It skips all pre-commit checks and should only be used when the hook itself is broken or you are committing a work-in-progress branch that will not be merged.

## Code Style

### TypeScript

- Prefer typed inputs and outputs.
- Avoid `any`; use `unknown` and narrow it.
- Keep domain types in `types/` when they are shared.

### React

- Use functional components and hooks.
- Add `"use client"` only when the component needs browser APIs, state, effects, or event handlers.
- Extract repeated logic into hooks only when it simplifies the caller.

### Styling

- Use Tailwind utility classes and existing design tokens.
- Use `cn()` from `lib/utils.ts` for conditional classes.
- Keep accessibility in mind: labels, focus states, keyboard navigation, and screen reader announcements matter.

### Security

- Never commit private keys, seed phrases, API keys, JWTs, or real customer data.
- Do not log signatures, wallet seeds, private invoices, or credentials.
- Use `.env.local` for local secrets and `.env.example` only for safe placeholders.

## Getting Help

- Ask questions on the issue when the acceptance criteria are unclear.
- Include file paths, screenshots, and command output when reporting setup problems.
- Keep discussion on GitHub unless maintainers explicitly ask contributors to use another channel.

Thanks for contributing to Kora Protocol.
