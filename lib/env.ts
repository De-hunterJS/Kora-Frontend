/**
 * Environment Variable Validation — Issue #269
 *
 * Validates all required env vars at startup using Zod.
 * - NEXT_PUBLIC_* vars are client-safe and validated on both server and client.
 * - Server-only vars (e.g. PINATA_JWT) are validated server-side only and are
 *   never included in the client bundle.
 * - Missing required vars throw at build time with a clear error listing each
 *   offending key.
 * - Optional vars fall back to documented defaults.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   env.NEXT_PUBLIC_STELLAR_NETWORK  // "testnet" | "mainnet" | "futurenet"
 *   env.PINATA_JWT                   // server-side only
 */
import { z } from "zod";

// ─── Soroban C-strkey validation ──────────────────────────────────────────────
// A valid Soroban contract address is a 56-character Stellar C-strkey:
//   • Starts with the letter 'C'
//   • Uses base-32 alphabet (A-Z, 2-7)
//   • Exactly 56 characters total
//
// The all-zeros placeholder (CAAAA...ABSC4) is the Soroban zero-address and is
// never a real deployed contract — we reject it in live mode.

const SOROBAN_CONTRACT_REGEX = /^C[A-Z2-7]{55}$/;
const SOROBAN_ZERO_ADDRESS =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

/**
 * Zod refinement: validates that a string is a well-formed Soroban C-strkey.
 * Does NOT reject the zero-address here — that is done separately in live-mode
 * validation so the error message is actionable.
 */
const sorobanContractId = z
  .string()
  .min(1, "Contract ID is required")
  .refine(
    (v) => SOROBAN_CONTRACT_REGEX.test(v),
    (v) =>
      ({
        message: `Invalid Soroban contract ID "${v}". Expected a 56-character C-strkey starting with 'C' (e.g. CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA).`,
      }) as { message: string },
  );

// ─── Client-safe schema (NEXT_PUBLIC_*) ──────────────────────────────────────
// These vars are embedded into the client bundle by Next.js at build time.
// Never put secrets here.

const clientSchema = z.object({
  /** Stellar network to connect to. Defaults to "testnet". */
  NEXT_PUBLIC_STELLAR_NETWORK: z
    .enum(["testnet", "mainnet", "futurenet"])
    .default("testnet"),

  /** Soroban RPC endpoint URL. Required. */
  NEXT_PUBLIC_STELLAR_RPC_URL: z.string().url(),

  /** Horizon REST API endpoint URL. Required. */
  NEXT_PUBLIC_STELLAR_HORIZON_URL: z.string().url(),

  /** Stellar network passphrase used to sign transactions. Required. */
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: z.string().min(1),

  /**
   * Soroban contract ID for the Invoice NFT contract.
   * Must be a valid 56-char Soroban C-strkey.
   */
  NEXT_PUBLIC_INVOICE_CONTRACT_ID: sorobanContractId,

  /**
   * Soroban contract ID for the Marketplace contract.
   * Must be a valid 56-char Soroban C-strkey.
   */
  NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID: sorobanContractId,

  /**
   * Soroban contract ID for the USDC/token contract.
   * Must be a valid 56-char Soroban C-strkey.
   */
  NEXT_PUBLIC_TOKEN_CONTRACT_ID: sorobanContractId,

  /** IPFS gateway base URL for resolving CIDs. Required. */
  NEXT_PUBLIC_IPFS_GATEWAY: z.string().url(),

  /** Public URL of this app deployment. Defaults to localhost:3000. */
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  /** App display name. Defaults to "Kora". */
  NEXT_PUBLIC_APP_NAME: z.string().default("Kora"),

  /** App description used in meta tags. */
  NEXT_PUBLIC_APP_DESCRIPTION: z
    .string()
    .default("On-chain Invoice Financing Protocol"),

  /** Enable mock data (no live Soroban connection required). Defaults to false. */
  NEXT_PUBLIC_ENABLE_MOCK_DATA: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  /** Enable React Query / debug devtools. Defaults to false. */
  NEXT_PUBLIC_ENABLE_DEVTOOLS: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  /** Enable invoice comparison features. Defaults to true. */
  NEXT_PUBLIC_ENABLE_INVOICE_COMPARISON: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),

  /**
   * Optional USDC issuer address override.
   * Defaults to Circle's canonical testnet issuer when unset.
   * Set NEXT_PUBLIC_USDC_ISSUER on mainnet to the live Circle issuer.
   */
  NEXT_PUBLIC_USDC_ISSUER: z
    .string()
    .optional()
    .default("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),

  /** Configurable USDC threshold requiring KYC before funding above this limit. */
  NEXT_PUBLIC_KYC_FUND_THRESHOLD: z
    .string()
    .transform((v) => parseInt(v, 10))
    .default("10000"),

  // ─── Secondary market fees (issue #597) ────────────────────────────────────
  // Expressed in basis points so the config carries no rounding of its own:
  // 100 bps = 1%. Both are capped at 10_000 bps (100%) — a fee schedule that
  // could exceed the trade value is a misconfiguration, not a business choice.

  /** Protocol fee on a secondary acquisition, in basis points. */
  NEXT_PUBLIC_SECONDARY_PROTOCOL_FEE_BPS: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= 10_000, {
      message: "Protocol fee must be between 0 and 10000 bps",
    })
    .default("50"),

  /** Marketplace/venue fee on a secondary acquisition, in basis points. */
  NEXT_PUBLIC_SECONDARY_MARKET_FEE_BPS: z
    .string()
    .transform((v) => Number.parseInt(v, 10))
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= 10_000, {
      message: "Market fee must be between 0 and 10000 bps",
    })
    .default("25"),
});

// ─── Server-only schema ───────────────────────────────────────────────────────
// These vars are NEVER exposed to the client bundle.
// Importing this module from a client component will only yield the client vars.

const serverSchema = z.object({
  /** Pinata JWT for IPFS pinning. Required in production. */
  PINATA_JWT: z.string().min(1),

  /** Optional legacy Pinata API key (v1 API). */
  PINATA_API_KEY: z.string().optional(),

  /** Optional legacy Pinata secret key (v1 API). */
  PINATA_SECRET_API_KEY: z.string().optional(),

  /** Optional VirusTotal API key for PDF scanning on upload. */
  VIRUSTOTAL_API_KEY: z.string().optional(),

  /**
   * Shared secret for verifying Synaps KYC webhook signatures (#694).
   * Optional: when unset the callback signature header is still required but
   * cannot be checked, which is the mock/dev posture.
   */
  SYNAPS_WEBHOOK_SECRET: z.string().optional(),
});

const clientEnv = {
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  NEXT_PUBLIC_STELLAR_HORIZON_URL: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  NEXT_PUBLIC_INVOICE_CONTRACT_ID: process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID,
  NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID:
    process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID,
  NEXT_PUBLIC_TOKEN_CONTRACT_ID: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID,
  NEXT_PUBLIC_IPFS_GATEWAY: process.env.NEXT_PUBLIC_IPFS_GATEWAY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_DESCRIPTION: process.env.NEXT_PUBLIC_APP_DESCRIPTION,
  NEXT_PUBLIC_ENABLE_MOCK_DATA: process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA,
  NEXT_PUBLIC_ENABLE_DEVTOOLS: process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS,
  NEXT_PUBLIC_KYC_FUND_THRESHOLD: process.env.NEXT_PUBLIC_KYC_FUND_THRESHOLD,
  NEXT_PUBLIC_USDC_ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER,
  NEXT_PUBLIC_SECONDARY_PROTOCOL_FEE_BPS:
    process.env.NEXT_PUBLIC_SECONDARY_PROTOCOL_FEE_BPS,
  NEXT_PUBLIC_SECONDARY_MARKET_FEE_BPS:
    process.env.NEXT_PUBLIC_SECONDARY_MARKET_FEE_BPS,
};

// ─── Parse & validate ─────────────────────────────────────────────────────────

function parseEnv() {
  const isServer = typeof window === "undefined";

  // Validate client vars — runs on both server and client
  const clientResult = clientSchema.safeParse(clientEnv);
  if (!clientResult.success) {
    const msg = clientResult.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`❌ Invalid environment variables:\n${msg}`);
  }

  // ── Live-mode contract ID guard ──────────────────────────────────────────
  // When mock data is disabled the app makes real Soroban RPC calls.  Fail
  // fast here rather than silently sending transactions to the zero-address
  // contract, which would produce opaque on-chain errors.
  const mockEnabled = clientResult.data.NEXT_PUBLIC_ENABLE_MOCK_DATA;
  if (!mockEnabled) {
    const CONTRACT_VARS = [
      "NEXT_PUBLIC_INVOICE_CONTRACT_ID",
      "NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID",
      "NEXT_PUBLIC_TOKEN_CONTRACT_ID",
    ] as const;

    const zeroAddressVars = CONTRACT_VARS.filter(
      (key) => clientResult.data[key] === SOROBAN_ZERO_ADDRESS,
    );

    if (zeroAddressVars.length > 0) {
      throw new Error(
        `❌ Live mode is enabled (NEXT_PUBLIC_ENABLE_MOCK_DATA=false) but the ` +
          `following contract IDs are still set to the Soroban zero-address ` +
          `placeholder:\n` +
          zeroAddressVars.map((k) => `  ${k}`).join("\n") +
          `\n\nDeploy your contracts to ${clientResult.data.NEXT_PUBLIC_STELLAR_NETWORK} ` +
          `and set the real addresses in your .env.local file.\n` +
          `See README.md → "Smart Contract Deployment" for instructions.`,
      );
    }
  }

  if (!isServer) {
    return clientResult.data;
  }

  // Validate server-only vars
  const serverResult = serverSchema.safeParse(process.env);
  if (!serverResult.success) {
    const issues = serverResult.error.issues;
    const isProd = process.env.NODE_ENV === "production";
    const missingRequired = issues.filter((i) => i.path[0] === "PINATA_JWT");

    if (isProd && missingRequired.length > 0) {
      const msg = issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(
        `❌ Missing required server environment variables:\n${msg}`,
      );
    }

    // Dev: warn about optional missing vars but don't throw
    issues.forEach((i) => {
      console.warn(
        `⚠️  Optional env var missing or invalid: ${i.path.join(".")}`,
      );
    });

    return {
      ...clientResult.data,
      ...serverSchema.partial().parse(process.env),
    };
  }

  return { ...clientResult.data, ...serverResult.data };
}

export const env = parseEnv();
