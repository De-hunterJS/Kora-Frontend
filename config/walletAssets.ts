import * as StellarSdk from "@stellar/stellar-sdk";

export type WalletAssetType = "native" | "credit";

export interface WalletAssetConfig {
  symbol: string;
  type: WalletAssetType;
  code?: string;
  issuer?: string;
  decimals?: number;
  lowBalanceThreshold?: number;
}

export const TESTNET_USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
// Circle's EURC testnet issuer. The previous placeholder failed the StrKey
// checksum, so `new StellarSdk.Asset` threw at import and crashed every route.
export const TESTNET_EURC_ISSUER =
  "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO";

/**
 * Resolve the USDC issuer address. Reads NEXT_PUBLIC_USDC_ISSUER at runtime
 * so both testnet and mainnet deployments can use the correct Circle issuer
 * without a code change.  Falls back to the canonical testnet issuer when the
 * env var is absent (development / CI).
 */
function resolveUsdcIssuer(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_USDC_ISSUER) {
    return process.env.NEXT_PUBLIC_USDC_ISSUER;
  }
  return TESTNET_USDC_ISSUER;
}

const USDC_ISSUER = resolveUsdcIssuer();

/**
 * Stellar asset objects + trustline helpers for onboarding flows (EURC/USDC).
 */
export const WALLET_ASSETS = {
  usdc: {
    code: "USDC",
    issuer: USDC_ISSUER,
    trustlineLimit: "1000000",
    asset: new StellarSdk.Asset("USDC", USDC_ISSUER),
  },
  eurc: {
    code: "EURC",
    issuer: TESTNET_EURC_ISSUER,
    trustlineLimit: "1000000",
    asset: new StellarSdk.Asset("EURC", TESTNET_EURC_ISSUER),
  },
} as const;

/**
 * Default asset list shown in the wallet balance panel.
 *
 * There is no existing asset config in the repo yet, so this keeps the
 * supported balances in one place rather than re-hardcoding them in hooks/UI.
 */
export const DEFAULT_WALLET_ASSETS: readonly WalletAssetConfig[] = [
  {
    symbol: "XLM",
    type: "native",
    decimals: 2,
  },
  {
    symbol: "USDC",
    type: "credit",
    code: "USDC",
    issuer: USDC_ISSUER,
    decimals: 2,
    lowBalanceThreshold: 100,
  },
  {
    symbol: "EURC",
    type: "credit",
    code: "EURC",
    issuer: TESTNET_EURC_ISSUER,
    decimals: 2,
  },
];

export const DEFAULT_FUNDING_ASSET_SYMBOL = "USDC";

export function getAssetBalance(
  balances: Array<{ code: string; issuer?: string; balance: string }>,
  code: string,
  issuer?: string
): string {
  return (
    balances.find(
      (asset) => asset.code === code && (!issuer || asset.issuer === issuer)
    )?.balance ?? "0"
  );
}

export function hasTrustline(
  balances: Array<{ code: string; issuer?: string; balance: string }>,
  code: string,
  issuer: string
): boolean {
  return balances.some(
    (asset) => asset.code === code && asset.issuer === issuer
  );
}
