import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useQueryClient } from "@tanstack/react-query";
import { Keypair } from "@stellar/stellar-sdk";
import type { WalletBalance, WalletNetwork, WalletProvider } from "@/types";
import { env } from "@/lib/env";
import { isValidStellarAddress } from "@/lib/utils";
import { createPersistentJSONStorage } from "./storageAdapter";

const EMPTY_BALANCE: WalletBalance = {
  xlm: "0",
  usdc: "0",
  eurc: "0",
};

/** Session expires after 24 hours of inactivity. Change this constant to adjust. */
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Wallet ownership verification expires 1 hour after it was granted. */
export const VERIFICATION_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Clears all address-scoped caches: TanStack Query, zustand persisted data,
 * and IndexedDB marketplace cache. Call on disconnect and session expiry.
 */
export function clearAllUserState(address?: string | null) {
  // Clear localStorage wallet data
  if (typeof window !== "undefined") {
    localStorage.removeItem("kora-wallet");
    // Clear position listing cache
    localStorage.removeItem("kora-position-listings");
    // Clear IndexedDB marketplace cache
    try {
      const dbs = indexedDB.databases?.();
      if (dbs) {
        dbs.then((databases) => {
          databases.forEach((db) => {
            if (db.name?.includes("marketplace") || db.name?.includes("tanstack")) {
              indexedDB.deleteDatabase(db.name);
            }
          });
        });
      }
    } catch {
      // Best-effort — ignore errors
    }
  }
}

export function getConfiguredNetwork(): WalletNetwork {
  return (env.NEXT_PUBLIC_STELLAR_NETWORK as WalletNetwork) || "testnet";
}

/** Signed label attestation for tamper detection */
export type SignedLabel = {
  address: string;
  label: string;
  signature: string;
  signedAt: number;
};

/**
 * Canonical signed payload format (v1):
 *
 *   `kora-label:v1:{address}:{label}:{signedAt}`
 *
 * - `address` is the Stellar G-address that owns the label (the signer).
 * - `label` is the exact contact label text (rejected when empty/whitespace).
 * - `signedAt` is a unix-ms timestamp binding the signature to one moment.
 *
 * The message is UTF-8 encoded and signed with the owning key's Ed25519
 * secret key; `signature` is the 64-byte signature hex-encoded (128 chars).
 *
 * Legacy attestations signed as `kora-label:{address}:{label}` (no version
 * or timestamp) are still verified cryptographically so genuinely signed
 * entries keep working. Anything that is not a valid Ed25519 signature
 * from the claimed address — including the old random-hex placeholders —
 * fails closed and must be treated as untrusted.
 */
export const LABEL_MESSAGE_V1_PREFIX = "kora-label:v1:";

/** Legacy message format (no version/timestamp); verified, not minted. */
export function buildLabelMessage(address: string, label: string): string {
  return `kora-label:${address}:${label}`;
}

/**
 * Check if an address book entry has a cryptographically verified label.
 * Returns true if signedLabel exists and passes cryptographic verification.
 */
export function isLabelVerified(entry: { label: string; signedLabel?: SignedLabel }): boolean {
  if (!entry.signedLabel) return false;
  return verifySignedLabel(entry.signedLabel);
}

/**
 * Verify a signed label attestation cryptographically using Ed25519.
 * 
 * This function:
 * 1. Validates the attestation format and structure
 * 2. Reconstructs the signed message from the address and label
 * 3. Verifies the Ed25519 signature using the Stellar SDK
 * 4. Ensures the signature was created by the wallet at the given address
 * 
 * Fails closed when:
 * - Any format check fails
 * - Signature verification fails
 * - Public key cannot be used for verification
 * 
 * @param attestation - The SignedLabel object to verify
 * @returns true if the signature is cryptographically valid, false otherwise
 */
export function verifySignedLabel(attestation: SignedLabel): boolean {
  try {
    // 1. Validate attestation structure
    if (!attestation.address || !attestation.label || !attestation.signature) {
      return false;
    }

    // 2. Validate address format (Stellar public key)
    if (!/^G[A-Z2-7]{55}$/.test(attestation.address)) {
      return false;
    }

    // 3. Validate signature format (128 hex chars = 64 bytes for Ed25519 signature)
    if (!/^[a-fA-F0-9]{128}$/.test(attestation.signature)) {
      return false;
    }

    // 4. Validate timestamp is reasonable (not too far in future, not too old)
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    const maxFuture = 60 * 1000; // 1 minute into future (clock skew tolerance)
    
    if (attestation.signedAt > now + maxFuture || now - attestation.signedAt > maxAge) {
      return false;
    }

    // 5. Reconstruct the signed message
    const message = buildLabelMessage(attestation.address, attestation.label);
    const messageBuffer = Buffer.from(message, "utf8");

    // 6. Convert hex signature to buffer
    const signatureBuffer = Buffer.from(attestation.signature, "hex");

    // 7. Verify Ed25519 signature using Stellar SDK
    // eslint-disable-next-line
    const { Keypair } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    
    try {
      const keypair = Keypair.fromPublicKey(attestation.address);
      const isValid = keypair.verify(messageBuffer, signatureBuffer);
      
      if (!isValid) {
        return false;
      }
    } catch {
      // Keypair creation or verification failed
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a signed label attestation with real Ed25519 verification against
 * the claimed address. Tries the v1 payload first, then the legacy payload.
 *
 * Fails closed on: missing/whitespace labels, malformed addresses,
 * non-hex or wrong-length signatures, wrong-key signatures, mutated
 * labels, and non-finite timestamps.
 */
export function verifySignedLabel(attestation: SignedLabel): boolean {
  try {
    if (!attestation || typeof attestation !== "object") return false;
    if (!attestation.address || !attestation.label || !attestation.signature) return false;
    if (!/^G[A-Z2-7]{55}$/.test(attestation.address)) return false;
    if (!attestation.label.trim()) return false;
    if (!/^[a-fA-F0-9]{128}$/.test(attestation.signature)) return false;
    if (!Number.isFinite(attestation.signedAt)) return false;

    const signature = attestation.signature.toLowerCase();
    // Current format first; fall back to the legacy format for entries
    // signed before timestamps were bound into the payload.
    return (
      verifyEd25519(
        attestation.address,
        buildLabelMessageV1(attestation.address, attestation.label, attestation.signedAt),
        signature
      ) ||
      verifyEd25519(attestation.address, buildLabelMessage(attestation.address, attestation.label), signature)
    );
  } catch {
    return false;
  }
}

/** True when an attestation predates cryptographic verification (fails real verify). */
export function isLegacyAttestation(attestation: SignedLabel | undefined): boolean {
  if (!attestation) return false;
  return !verifySignedLabel(attestation);
}

/**
 * Drop `signedLabel`s that fail cryptographic verification (forged, copied,
 * or pre-verification placeholders). Returns the pruned entries — call on
 * load/rehydrate so no production path trusts length-only attestations.
 */
export function pruneInvalidSignedLabels<
  T extends { signedLabel?: SignedLabel },
>(entries: T[]): T[] {
  return entries.map((e) =>
    e.signedLabel && !verifySignedLabel(e.signedLabel)
      ? { ...e, signedLabel: undefined }
      : e
  );
}

type WalletStoreState = {
  status: "disconnected" | "connecting" | "connected";
  address: string | null;
  publicKey: string | null;
  isConnected: boolean;
  provider: WalletProvider | null;
  network: WalletNetwork;
  balance: WalletBalance | null;
  isVerified: boolean;
  verifiedAt: number | null;
  lastActivityAt: number | null;
  addressBook: { id: string; address: string; label: string; signedLabel?: SignedLabel }[];
  walletPassphrase: string | null;
  diagnosticsImport: string | null;
  /**
   * Tracks whether the in-memory StellarWalletsKit session is active.
   *
   * After a page refresh the kit singleton is destroyed and must call
   * getPublicKey() again before signing works.  This flag starts as `false`
   * on every page load; `useWallet` sets it to `true` once silent reconnect
   * succeeds, or `null` when the reconnect attempt is still pending.
   *
   * - `null`  → reconnect in-progress (show spinner / loading state)
   * - `false` → kit session absent (stale — show reconnect prompt)
   * - `true`  → kit session active (fully operational)
   */
  kitSessionActive: boolean | null;
  kycStatus: "none" | "pending" | "verified" | "rejected";
  /** Read-only watch mode — pasted G-address without wallet signing. */
  isWatchMode: boolean;
};

type WalletStoreActions = {
  connect: (provider: WalletProvider, address: string, publicKey: string, walletPassphrase?: string) => void;
  disconnect: () => void;
  setBalance: (balance: WalletBalance) => void;
  setVerified: (isVerified: boolean, verifiedAt?: number) => void;
  clearVerification: () => void;
  isVerificationExpired: () => boolean;
  isWrongNetwork: () => boolean;
  hasPassphraseMismatch: () => boolean;
  updateActivity: () => void;
  isSessionExpired: () => boolean;
  /** Mark the in-memory kit session as active/inactive/pending. */
  setKitSessionActive: (active: boolean | null) => void;
  addAddressBookEntry: (address: string, label?: string, signedLabel?: SignedLabel) => void;
  updateAddressBookEntry: (id: string, updates: { address?: string; label?: string; signedLabel?: SignedLabel | null }) => void;
  removeAddressBookEntry: (id: string) => void;
  setDiagnosticsImport: (payload: string | null) => void;
  toggleAddressBookFavorite: (id: string) => void;
  addAddressBookGroup: (name: string) => void;
  updateAddressBookGroup: (id: string, updates: { name?: string; favorite?: boolean }) => void;
  removeAddressBookGroup: (id: string) => void;
  /** Enter read-only watch mode for a given address (no wallet required). */
  enterWatchMode: (address: string) => void;
  /** Exit watch mode and fully disconnect. */
  exitWatchMode: () => void;
  /**
   * Switches active account without full disconnect; clears verification & resets balance.
   */
  switchAccount: (newAddress: string, newPublicKey?: string) => void;
  setNetwork: (network: WalletNetwork, walletPassphrase?: string) => void;
  setKycStatus: (kycStatus: "none" | "pending" | "verified" | "rejected") => void;
};

type WalletStore = WalletStoreState & WalletStoreActions;

export const useWalletStore = create<WalletStore>()(
  persist(
    (set, get) => ({
      status: "disconnected",
      address: null,
      publicKey: null,
      isConnected: false,
      provider: null,
      network: getConfiguredNetwork(),
      balance: null,
      isVerified: false,
      verifiedAt: null,
      lastActivityAt: null,
      addressBook: [],
      addressBookGroups: [],
      walletPassphrase: null,
      diagnosticsImport: null,
      kitSessionActive: false,
      kycStatus: "none",
      isWatchMode: false,

      connect: (provider, address, publicKey, walletPassphrase) =>
        set({
          status: "connected",
          provider,
          address,
          publicKey,
          balance: EMPTY_BALANCE,
          isConnected: true,
          walletPassphrase: walletPassphrase || null,
          lastActivityAt: Date.now(),
          // Kit session is presumed active on fresh connect; caller may
          // override immediately if this is a silent re-establishment.
          kitSessionActive: true,
        }),

      disconnect: () =>
        set({
          status: "disconnected",
          address: null,
          publicKey: null,
          isConnected: false,
          provider: null,
          balance: null,
          isVerified: false,
          verifiedAt: null,
          lastActivityAt: null,
          walletPassphrase: null,
          kitSessionActive: false,
          isWatchMode: false,
        }),

      switchAccount: (newAddress, newPublicKey) =>
        set((state) => ({
          address: newAddress,
          publicKey: newPublicKey || newAddress,
          balance: EMPTY_BALANCE,
          isVerified: false,
          verifiedAt: null,
          lastActivityAt: Date.now(),
          kitSessionActive: true,
        })),

      enterWatchMode: (address) =>
        set({
          status: "connected",
          address,
          publicKey: null,
          isConnected: true,
          provider: null,
          balance: EMPTY_BALANCE,
          walletPassphrase: null,
          lastActivityAt: Date.now(),
          kitSessionActive: false,
          isWatchMode: true,
          isVerified: false,
          verifiedAt: null,
        }),

      exitWatchMode: () =>
        set({
          status: "disconnected",
          address: null,
          publicKey: null,
          isConnected: false,
          provider: null,
          balance: null,
          isVerified: false,
          verifiedAt: null,
          lastActivityAt: null,
          walletPassphrase: null,
          kitSessionActive: false,
          isWatchMode: false,
        }),

      setBalance: (balance) =>
        set((state) => (state.status === "connected" ? { balance } : {})),

      setVerified: (isVerified, verifiedAt) =>
        set({ isVerified, verifiedAt: verifiedAt || Date.now() }),

      clearVerification: () =>
        set({ isVerified: false, verifiedAt: null }),

      isVerificationExpired: () => {
        const state = get();
        if (!state.isVerified || !state.verifiedAt) return true;
        const EXPIRY_TIME = 60 * 60 * 1000; // 1 hour
        return Date.now() - state.verifiedAt > EXPIRY_TIME;
      },

      isWrongNetwork: () => {
        const state = get();
        const expectedNetwork = getConfiguredNetwork();
        return state.isConnected && state.network !== expectedNetwork;
      },

      hasPassphraseMismatch: () => {
        const state = get();
        if (!state.isConnected || !state.walletPassphrase) return false;
        return state.walletPassphrase !== env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
      },

      updateActivity: () =>
        set({ lastActivityAt: Date.now() }),

      isSessionExpired: () => {
        const state = get();
        if (!state.isConnected || !state.lastActivityAt) return false;
        return Date.now() - state.lastActivityAt > SESSION_EXPIRY_MS;
      },

      setKitSessionActive: (active) =>
        set({ kitSessionActive: active }),

      addAddressBookEntry: (address, label = "", signedLabel) => {
        if (!address || typeof address !== "string") return;
        const trimmed = address.trim();
        if (!trimmed || !isValidStellarAddress(trimmed)) return;
        const existing = get().addressBook.find(
          (e) => e.address.toLowerCase() === trimmed.toLowerCase()
        );
        if (existing) return; // silently skip duplicates
        // Fail closed: never persist a forged or legacy-unverifiable attestation.
        const cleanSignedLabel = signedLabel && verifySignedLabel(signedLabel) ? signedLabel : undefined;
        set((s) => ({
          addressBook: [
            ...s.addressBook,
            { id: crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2, 8), address: trimmed, label: label.trim(), signedLabel: cleanSignedLabel },
          ],
        }));
      },

      updateAddressBookEntry: (id, updates) => {
        if (updates.address !== undefined) {
          const trimmed = updates.address.trim();
          if (!trimmed || !isValidStellarAddress(trimmed)) return;
          const duplicate = get().addressBook.find(
            (e) => e.id !== id && e.address.toLowerCase() === trimmed.toLowerCase()
          );
          if (duplicate) return;
          updates = { ...updates, address: trimmed };
        }
        // Fail closed on label-attestation updates as well.
        if (updates.signedLabel !== undefined && updates.signedLabel !== null) {
          if (!verifySignedLabel(updates.signedLabel)) {
            updates = { ...updates, signedLabel: undefined };
          }
        }
        set((s) => ({
          addressBook: s.addressBook.map((e) => (e.id === id ? { ...e, ...updates, label: updates.label?.trim() ?? e.label } : e)),
        }));
      },

      removeAddressBookEntry: (id) =>
        set((s) => ({ addressBook: s.addressBook.filter((e) => e.id !== id) })),

      setDiagnosticsImport: (payload) => set({ diagnosticsImport: payload }),

      toggleAddressBookFavorite: (id) =>
        set((s) => ({
          addressBook: s.addressBook.map((e) =>
            e.id === id ? { ...e, isFavorite: !e.isFavorite } : e
          ),
        })),

      addAddressBookGroup: (name) => {
        if (!name || typeof name !== "string") return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const existing = get().addressBookGroups.find(
          (g) => g.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (existing) return;
        set((s) => ({
          addressBookGroups: [
            ...s.addressBookGroups,
            { id: crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2, 8), name: trimmed, favorite: false },
          ],
        }));
      },

      updateAddressBookGroup: (id, updates) =>
        set((s) => ({
          addressBookGroups: s.addressBookGroups.map((g) =>
            g.id === id ? { ...g, ...updates, name: updates.name?.trim() ?? g.name } : g
          ),
        })),

      removeAddressBookGroup: (id) =>
        set((s) => ({
          addressBookGroups: s.addressBookGroups.filter((g) => g.id !== id),
          addressBook: s.addressBook.map((e) => ({
            ...e,
            groupIds: e.groupIds.filter((gid) => gid !== id),
          })),
        })),
        
      setNetwork: (network, walletPassphrase) =>
        set((s) => ({
          network,
          walletPassphrase: walletPassphrase ?? s.walletPassphrase,
        })),
      setKycStatus: (kycStatus) => set({ kycStatus }),
    }),
    {
      name: "kora-wallet",
      storage: createPersistentJSONStorage(),
      partialize: (s) => ({
        address: s.address,
        publicKey: s.publicKey,
        provider: s.provider,
        network: s.network,
        isVerified: s.isVerified,
        verifiedAt: s.verifiedAt,
        lastActivityAt: s.lastActivityAt,
        addressBook: s.addressBook,
        addressBookGroups: s.addressBookGroups,
        walletPassphrase: s.walletPassphrase,
        diagnosticsImport: s.diagnosticsImport,
        kycStatus: s.kycStatus,
      }),
      // Invalidate insecure legacy attestations on load: anything that fails
      // real Ed25519 verification loses its trusted badge explicitly.
      onRehydrateStorage: () => (state) => {
        if (state?.addressBook) {
          state.addressBook = pruneInvalidSignedLabels(state.addressBook);
        }
      },
    }
  )
);

// ── Granular selector hooks ───────────────────────────────────────────────────
// Use these instead of subscribing to the full store. Each hook re-renders
// its consumer only when its specific slice changes, preventing unrelated
// store updates (e.g. balance polling) from cascading to the full Navbar.

export const useWalletIsConnected = () =>
  useWalletStore((s: WalletStore) => s.isConnected);

export const useWalletAddress = () =>
  useWalletStore((s: WalletStore) => s.address);

export const useWalletBalance = () =>
  useWalletStore((s: WalletStore) => s.balance);

export const useWalletNetwork = () =>
  useWalletStore((s: WalletStore) => s.network);

export const useWalletKycStatus = () =>
  useWalletStore((s: WalletStore) => s.kycStatus);
