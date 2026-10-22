<div align="center">
  <img src="https://img.shields.io/badge/Stellar-Soroban-14b8a6?style=for-the-badge&logo=stellar&logoColor=white" alt="Stellar Soroban" />
  <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/TailwindCSS-3.4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="TailwindCSS" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License" />
</div>

<br />

<div align="center">
  <h1>⬡ Kora Protocol</h1>
  <p><strong>On-chain Invoice Financing built on Stellar Soroban</strong></p>
  <p>SMEs tokenize unpaid invoices as NFTs and sell them at a discount to global liquidity providers — unlocking instant stablecoin liquidity without banks.</p>
</div>

---

## Table of Contents

- [Overview](#overview)
- [Live Demo](#live-demo)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Environment Variables](#environment-variables)
- [Core User Flows](#core-user-flows)
- [Smart Contract Integration](#smart-contract-integration)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

Kora Protocol is a decentralized invoice financing platform built on [Stellar Soroban](https://soroban.stellar.org/). It bridges the gap between SMEs in emerging markets who need working capital and global investors seeking yield on short-duration, real-world assets.

**The problem:** SMEs in Africa, Asia, and Latin America hold trillions of dollars in unpaid invoices. Traditional invoice financing is slow, expensive, and inaccessible to most small businesses.

**The solution:** Kora tokenizes invoices as NFTs on Stellar Soroban. Investors fund them via USDC. Settlement is instant, transparent, and non-custodial.

### How It Works

```
SME                    Kora Protocol              Investor
 │                          │                         │
 ├─ Upload Invoice ─────────►                         │
 │                          ├─ Store on IPFS          │
 │                          ├─ Mint NFT on Soroban    │
 │                          ├─ List on Marketplace ───►
 │                          │                         ├─ Browse & Fund
 │◄─ Receive USDC ──────────┤◄─ USDC Deposited ───────┤
 │                          │                         │
 │  (on due date)           │                         │
 ├─ Repay Principal ────────►                         │
 │                          ├─ Distribute Yield ──────►
 │                          │                         │
```

---

## Live Demo

> **Testnet deployment:** [https://kora-protocol.vercel.app](https://kora-protocol.vercel.app) *(coming soon)*

To run locally, see [Getting Started](#getting-started).

---

## Features

### For SMEs
- ✅ Connect Stellar wallet (Freighter, xBull, LOBSTR, Albedo)
- ✅ Upload invoice PDF to IPFS via Pinata
- ✅ Mint invoice as NFT on Soroban with one click
- ✅ Set custom discount rate and minimum investment
- ✅ Receive USDC instantly when invoice is funded
- ✅ Dashboard to track all active invoices and repayments

### For Investors
- ✅ Browse marketplace with filters (category, jurisdiction, risk tier, APR)
- ✅ Watchlist invoices with funding, status, and APR alerts
- ✅ View detailed invoice information and risk scores
- ✅ Fund invoices with USDC (partial or full)
- ✅ Real-time funding progress bars
- ✅ Portfolio dashboard with yield tracking
- ✅ Analytics with charts (portfolio growth, yield, risk distribution)

### Protocol
- ✅ Non-custodial — funds held in Soroban smart contract escrow
- ✅ On-chain risk scoring and repayment history
- ✅ IPFS-stored invoice metadata (tamper-proof)
- ✅ Transaction status toasts with hash links
- ✅ Optimistic UI updates

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5.6 |
| Styling | TailwindCSS 3.4 + CSS Variables |
| UI Components | Custom + Radix UI primitives |
| State Management | Zustand 5 |
| Data Fetching | TanStack Query v5 |
| Animations | Framer Motion 11 |
| Forms | React Hook Form + Zod |
| Charts | Recharts 2 |
| File Upload | React Dropzone |
| Notifications | Sonner |
| Blockchain | Stellar Soroban (via `@stellar/stellar-sdk`) |
| Wallet | Stellar Wallets Kit (`@creit.tech/stellar-wallets-kit`) |
| Storage | IPFS via Pinata |

---

## Design System

The Kora frontend uses a semantic Tailwind-based design system with CSS custom properties in `app/globals.css`.

- Color tokens are defined in HSL and mapped through `tailwind.config.ts`.
- The app is dark-mode-first and supports light mode through theme overrides.
- Reusable primitives live under `components/ui`.

See [docs/design-system.md](./docs/design-system.md) for the full guide.

---

## Documentation

| Doc | Path |
| --- | ---- |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Design system | [docs/design-system.md](./docs/design-system.md) |
| Debtor privacy | [docs/debtor-privacy.md](./docs/debtor-privacy.md) |
| Analytics events | [docs/analytics-events.md](./docs/analytics-events.md) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Security | [SECURITY.md](./SECURITY.md) |
| Doc index | [docs/README.md](./docs/README.md) |

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- A Stellar wallet browser extension ([Freighter](https://freighter.app) recommended)
- A [Pinata](https://pinata.cloud) account for IPFS uploads (free tier works)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/kora-frontend.git
cd kora-frontend

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your values (see Environment Variables section)

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Docker Dev Environment

If you prefer Docker, run:

```bash
cp .env.example .env.local
# Edit .env.local with your values
docker compose up --build
```

The app will be available at [http://localhost:3000](http://localhost:3000) with hot reload enabled.

Recommended contributor flow:

1. Keep `NEXT_PUBLIC_ENABLE_MOCK_DATA=true` for first-run development unless you are testing live Soroban contracts.
2. Start the container with `docker compose up --build`.
3. Open [http://localhost:3000](http://localhost:3000) and verify the marketplace loads.
4. Confirm hot reload by editing a copy-only string in a component and checking that the browser updates without rebuilding the image.
5. Stop the stack with `docker compose down`. Use `docker compose down --volumes` only when you intentionally want to remove the container-managed `node_modules` volume.

Troubleshooting:

- If changes do not appear, confirm Docker Desktop file sharing includes this repository path.
- If dependencies change, rerun `docker compose build --no-cache kora-frontend`.
- If `.env.local` is missing, Docker will fail because the compose file mounts it read-only.

### Quick Start with Mock Data

The app ships with mock data enabled by default (`NEXT_PUBLIC_ENABLE_MOCK_DATA=true`). You can browse the marketplace, view invoice details, and explore dashboards without a live Soroban connection.

To test wallet interactions, install [Freighter](https://freighter.app), switch it to **Testnet**, and fund your account via [Stellar Friendbot](https://friendbot.stellar.org).

### Seeding Testnet Data

Once you have real contract IDs deployed to testnet (`NEXT_PUBLIC_ENABLE_MOCK_DATA=false`), `scripts/seed-testnet.ts` sets up a wallet with sample data to develop against:

```bash
npm run seed:testnet
```

This generates a new keypair, funds it via Friendbot, mints it testnet USDC, mints 5 sample invoices, partially funds 2 of them, and prints the wallet's public/secret key and the minted token IDs to the console — save the secret key if you want to reuse that wallet (e.g. to import it into Freighter).

Validate the script against your configured contracts without writing any invoice or funding state on-chain:

```bash
npm run seed:testnet -- --dry-run
```

`--dry-run` still generates and funds a keypair (a real, funded account is required to simulate contract calls at all) and builds + simulates every mint call, but never signs or submits a mint or fund transaction.

The script refuses to run unless `NEXT_PUBLIC_STELLAR_NETWORK=testnet` — it will never touch mainnet. It reuses `lib/stellar/contracts.ts` and `@stellar/stellar-sdk` directly (no extra tooling needed) via [Node's built-in TypeScript support](https://nodejs.org/api/typescript.html), so it requires **Node.js 22.6+**.

---

## Project Structure

```
kora-frontend/
├── app/                          # Next.js App Router pages
│   ├── page.tsx                  # Landing page
│   ├── layout.tsx                # Root layout + providers
│   ├── globals.css               # Global styles + CSS variables
│   ├── providers.tsx             # QueryClient, Toaster, WalletModal
│   ├── marketplace/
│   │   ├── page.tsx              # Invoice marketplace listing
│   │   └── [id]/page.tsx         # Invoice detail + fund panel
│   ├── invoice/
│   │   └── create/page.tsx       # 3-step create invoice wizard
│   ├── dashboard/
│   │   ├── sme/page.tsx          # SME dashboard
│   │   └── investor/page.tsx     # Investor dashboard
│   └── analytics/page.tsx        # Portfolio analytics + charts
│
├── components/
│   ├── ui/                       # Reusable primitive components
│   │   ├── button.tsx
│   │   ├── card.tsx              # Card + GlassCard
│   │   ├── badge.tsx
│   │   ├── skeleton.tsx
│   │   ├── progress.tsx
│   │   ├── input.tsx
│   │   ├── dialog.tsx
│   │   ├── select.tsx
│   │   └── stat-card.tsx
│   ├── invoice/
│   │   └── InvoiceCard.tsx       # Marketplace invoice card
│   ├── wallet/
│   │   ├── WalletConnectModal.tsx
│   │   └── WalletButton.tsx
│   └── layout/
│       └── Navbar.tsx
│
├── hooks/
│   ├── useWallet.ts              # Stellar Wallets Kit wrapper
│   ├── useTransaction.ts         # Build → sign → submit lifecycle
│   └── useInvoices.ts            # TanStack Query invoice hooks
│
├── lib/
│   ├── stellar/
│   │   ├── client.ts             # Soroban RPC + Horizon client
│   │   ├── contracts.ts          # Contract call builders
│   │   └── index.ts
│   ├── ipfs.ts                   # Pinata upload helpers
│   ├── utils.ts                  # cn(), formatCurrency, etc.
│   └── validations/
│       └── invoice.ts            # Zod schemas
│
├── services/
│   ├── mockData.ts               # Mock invoices + stats
│   └── invoiceService.ts         # Invoice CRUD + contract calls
│
├── store/
│   ├── walletStore.ts            # Wallet state (persisted)
│   ├── invoiceStore.ts           # Marketplace filters + sort
│   ├── uiStore.ts                # Modal + tx state
│   └── index.ts
│
├── types/
│   ├── invoice.ts                # Invoice, InvoiceMetadata, etc.
│   ├── user.ts                   # WalletState, UserProfile, etc.
│   ├── contract.ts               # ContractConfig, TxState, etc.
│   └── index.ts
│
├── docs/                         # Architecture, design system, doc index
│   ├── README.md
│   ├── architecture.md
│   └── design-system.md
│
├── .env.example                  # Environment variable template
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
# Stellar Network
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Contract Addresses — v0.2 testnet deployments (replace with your own if needed)
NEXT_PUBLIC_INVOICE_CONTRACT_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID=CBWOAOZCOAJQH7HHZRE5BVNL2C4HRP4JCQZF3YQCQYDL5BZJRN4YGK4
NEXT_PUBLIC_TOKEN_CONTRACT_ID=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# IPFS (Pinata)
NEXT_PUBLIC_IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs
PINATA_JWT=your_pinata_jwt_token

# Feature Flags
NEXT_PUBLIC_ENABLE_MOCK_DATA=true   # Set to false for live on-chain calls
NEXT_PUBLIC_ENABLE_DEVTOOLS=true
NEXT_PUBLIC_ENABLE_COMPARISON=true  # Invoice comparison bar (marketplace); share via ?compare=id1,id2
NEXT_PUBLIC_ENABLE_ONBOARDING_TOUR=false
NEXT_PUBLIC_ENABLE_BATCH_ACTIONS=false

# Redis / Shared State (Optional for multi-instance deployments — see docs/architecture.md)
# REDIS_URL=redis://default:password@127.0.0.1:6379
# REDIS_TOKEN=your_redis_token_for_rest_endpoints
```

> **Invoice comparison:** When `NEXT_PUBLIC_ENABLE_COMPARISON=true`, marketplace cards show **Add to Compare**. Select up to **4** invoices, open the comparison table, and share the URL (`?compare=…`) to restore the selection. See `lib/featureFlags.ts` and `lib/comparison.ts`.

---

## Core User Flows

### SME: Create and Finance an Invoice

1. Connect wallet via **Connect Wallet** button
2. Navigate to **Create Invoice**
3. Fill in invoice details (debtor, amount, due date, jurisdiction)
4. Set discount rate and minimum investment
5. Upload invoice PDF
6. Click **Mint Invoice NFT** — this:
   - Uploads PDF to IPFS via Pinata
   - Uploads metadata JSON to IPFS
   - Builds a Soroban `mint_invoice` transaction
   - Prompts wallet for signature
   - Submits to Stellar network
7. Invoice appears on marketplace
8. As investors fund it, USDC flows to your wallet

### Investor: Fund an Invoice

1. Connect wallet
2. Browse **Marketplace** — filter by APR, risk tier, jurisdiction
3. Click an invoice card to view details
4. Enter investment amount (respects min/max)
5. Review expected return
6. Click **Fund Invoice** — this:
   - Builds a Soroban `fund_invoice` transaction
   - Prompts wallet for signature
   - Submits to Stellar network
7. Position appears in **Investor Dashboard**
8. On repayment date, principal + yield is returned

---

## Smart Contract Integration

The frontend interacts with two Soroban contracts:

### v0.2 Testnet Deployments

| Contract | Address | Explorer |
|----------|---------|---------|
| Invoice NFT | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | [View](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Marketplace | `CBWOAOZCOAJQH7HHZRE5BVNL2C4HRP4JCQZF3YQCQYDL5BZJRN4YGK4` | [View](https://stellar.expert/explorer/testnet/contract/CBWOAOZCOAJQH7HHZRE5BVNL2C4HRP4JCQZF3YQCQYDL5BZJRN4YGK4) |
| USDC Token | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | [View](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |

### Smart Contract Deployment

To deploy your own contracts to testnet:

#### Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-stellar-cli) v21+
- Funded testnet account — get XLM from [Friendbot](https://friendbot.stellar.org)

#### Steps

```bash
# 1. Install Stellar CLI
cargo install --locked stellar-cli --features opt

# 2. Generate or import a deployer keypair
stellar keys generate --global deployer --network testnet
stellar keys fund deployer --network testnet   # fund via Friendbot

# 3. Build contract WASM (from the contracts repo)
stellar contract build

# 4. Deploy the Invoice NFT contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/invoice_nft.wasm \
  --source deployer \
  --network testnet
# → Outputs: CONTRACT_ID  (copy this to NEXT_PUBLIC_INVOICE_CONTRACT_ID)

# 5. Deploy the Marketplace contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/marketplace.wasm \
  --source deployer \
  --network testnet
# → Outputs: CONTRACT_ID  (copy this to NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID)

# 6. Deploy or note the USDC token contract
#    On testnet you can use the Stellar Lab USDC contract or deploy a test token.
#    Copy its contract ID to NEXT_PUBLIC_TOKEN_CONTRACT_ID.

# 7. Update .env.local with the three contract IDs, then:
NEXT_PUBLIC_ENABLE_MOCK_DATA=false npm run dev
```

> **Note**: The v0.2 testnet addresses in `.env.example` are the canonical deployments.
> Override them only if you need a private deployment for development/testing.

### Network-aware Contract Switching

`lib/stellar/contracts.ts` maintains a `NETWORK_CONTRACTS` registry keyed by network name.
When `NEXT_PUBLIC_STELLAR_NETWORK` changes (e.g. `testnet` → `mainnet`), the correct
addresses are picked automatically — no code changes needed, only env vars.

To add mainnet addresses when ready, extend the registry:

```typescript
// lib/stellar/contracts.ts
const NETWORK_CONTRACTS = {
  testnet: { invoice: "CBIELTK...", marketplace: "CBWOAOZ...", token: "CDLZFC3..." },
  mainnet: { invoice: "C...",       marketplace: "C...",       token: "C..."       },
};
```

### Invoice Contract (`lib/stellar/contracts.ts`)

| Method | Description |
|--------|-------------|
| `mint_invoice(ipfs_cid, amount, financing_amount, discount_rate, due_date)` | Mints a new invoice NFT |
| `get_invoice(token_id)` | Reads invoice state |
| `update_status(token_id, status)` | Updates invoice status (owner only) |

### Marketplace Contract

| Method | Description |
|--------|-------------|
| `fund_invoice(token_id, amount)` | Investor funds an invoice |
| `repay_invoice(token_id)` | SME repays; triggers yield distribution |
| `get_positions(investor)` | Returns all investor positions |

### Transaction Flow

```typescript
// 1. Build unsigned transaction
const unsignedXdr = await invoiceContract.mintInvoice(params, walletAddress);

// 2. Sign with wallet
const signedXdr = await walletKit.signTransaction(unsignedXdr, { ... });

// 3. Submit to Soroban RPC
const result = await rpc.sendTransaction(tx);

// 4. Poll for confirmation
const confirmed = await waitForTransaction(result.hash);
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to contribute to this project.

---

## Roadmap

- [ ] **v0.2** — Live Soroban contract deployment on testnet
- [ ] **v0.3** — KYC/KYB integration (Synaps or Fractal ID)
- [ ] **v0.4** — Secondary market for invoice positions
- [ ] **v0.5** — Risk oracle integration (on-chain credit scoring)
- [ ] **v0.6** — Multi-currency support (EURC, native XLM)
- [ ] **v1.0** — Mainnet launch

---

## License

MIT © 2025 Kora Protocol Contributors

---

<div align="center">
  <p>Built with ❤️ on Stellar Soroban</p>
  <p>
    <a href="https://stellar.org">Stellar</a> ·
    <a href="https://soroban.stellar.org">Soroban</a> ·
    <a href="https://nextjs.org">Next.js</a>
  </p>
</div>

## Handsoff notes

<!-- handsoff-issue-871 -->
- #871: i18n: WalletButton reconnect/EURC trustline toasts English-only

## Wallet — Trustline Setup

Stellar requires each account to establish a **trustline** before it can hold
any non-native asset (USDC, EURC, etc.).  New wallets therefore start with a
zero USDC balance and cannot fund invoices until a trustline is added.

### USDC trustline

The wallet dropdown shows an **Add USDC trustline** button whenever the
connected wallet has a USDC balance of `0`.  Clicking it:

1. Checks whether the trustline already exists (via `hasTrustline` in
   `config/walletAssets.ts`) — if so, just refreshes the balance and returns.
2. Calls `buildAddTrustlineTx(address, "usdc")` in `lib/stellar/contracts.ts`
   to build a `changeTrust` Soroban XDR.
3. Signs it through the connected wallet extension.
4. Submits to the network and polls for confirmation.
5. Refreshes the balance query so the displayed USDC balance updates immediately.

The CTA is hidden once the USDC balance is non-zero (trustline established and
funded).

#### Mainnet / custom issuer

By default the USDC issuer is Circle's canonical address.  For mainnet or
custom deployments, override it with:

```bash
NEXT_PUBLIC_USDC_ISSUER=G<your_mainnet_usdc_issuer>
```

The env var is read in `config/walletAssets.ts` → `resolveUsdcIssuer()` and
falls back to the testnet issuer when absent.

### EURC trustline

An **Add EURC trustline** button is always present in testnet mode.  It follows
the identical flow above using `buildAddTrustlineTx(address, "eurc")`.

### Edge cases

| Scenario | Behaviour |
|----------|-----------|
| Trustline exists, balance zero | CTA hidden (balance is non-zero internally) — user must fund via testnet faucet |
| User rejects wallet signing | `addUsdcTrustlineOnTestnet` throws; error toast shown via `wallet.trustline.usdc.error` |
| Network mismatch (wrong chain) | CTA is disabled via `hasNetworkMismatch` guard |
| Mainnet vs testnet issuer mismatch | Set `NEXT_PUBLIC_USDC_ISSUER` to the correct mainnet issuer |
