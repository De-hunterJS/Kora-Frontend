"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import { useWallet } from "@/hooks/useWallet";
import { VerificationModal } from "./VerificationModal";
import { VERIFICATION_EXPIRY_MS } from "@/store/walletStore";
import { setCsrfWalletAddress } from "@/lib/csrfClient";

interface VerificationContextType {
  requireVerification: (actionType: string) => Promise<void>;
  isVerified: boolean;
  isLoading: boolean;
}

const VerificationContext = createContext<VerificationContextType | null>(null);

/**
 * Detects whether an error message indicates a replay or skew condition
 * that should trigger a fresh challenge request rather than a retry.
 */
function isReplayOrSkewError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("already used") ||
    lower.includes("nonce not found") ||
    lower.includes("challenge expired") ||
    lower.includes("skew")
  );
}

export function VerificationProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionType, setActionType] = useState<string>("");
  const [challengeMessage, setChallengeMessage] = useState<string | undefined>(
    undefined
  );
  const [verificationPromise, setVerificationPromise] = useState<{
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);

  useEffect(() => {
    setCsrfWalletAddress(wallet.address ?? null);
  }, [wallet.address]);

  const fetchFreshChallenge = useCallback(async (): Promise<string | null> => {
    try {
      const challenge = await wallet.requestChallenge();
      setChallengeMessage(challenge);
      return challenge;
    } catch {
      setChallengeMessage(undefined);
      return null;
    }
  }, [wallet]);

  const requireVerification = useCallback(
    async (type: string): Promise<void> => {
      if (wallet.checkVerification()) {
        return;
      }

      setActionType(type);
      setError(null);

      const prefetchedChallenge = await fetchFreshChallenge();

      return new Promise((resolve, reject) => {
        setVerificationPromise({ resolve, reject });
        setIsOpen(true);
      });
    },
    [wallet, fetchFreshChallenge]
  );

  const handleVerify = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await wallet.verifyOwnership();
      setIsOpen(false);
      setChallengeMessage(undefined);
      verificationPromise?.resolve();
      setVerificationPromise(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Verification failed. Please try again.";

      if (isReplayOrSkewError(message)) {
        setError(null);
        setChallengeMessage(undefined);
        const freshChallenge = await fetchFreshChallenge();
        if (!freshChallenge) {
          setError("Failed to refresh challenge. Please try again.");
        }
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [wallet, verificationPromise, fetchFreshChallenge]);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setChallengeMessage(undefined);
    verificationPromise?.reject(new Error("Verification cancelled"));
    setVerificationPromise(null);
  }, [verificationPromise]);

  useEffect(() => {
    if (!wallet.isConnected && isOpen) {
      handleCancel();
    }
  }, [wallet.isConnected, isOpen, handleCancel]);

  return (
    <VerificationContext.Provider
      value={{
        requireVerification,
        isVerified: wallet.isVerified,
        isLoading,
      }}
    >
      {children}
      <VerificationModal
        isOpen={isOpen}
        isLoading={isLoading}
        error={error ?? undefined}
        actionType={actionType}
        challengeMessage={challengeMessage}
        sessionExpiresAt={
          wallet.isVerified && wallet.verifiedAt
            ? wallet.verifiedAt + VERIFICATION_EXPIRY_MS
            : undefined
        }
        onVerify={handleVerify}
        onCancel={handleCancel}
      />
    </VerificationContext.Provider>
  );
}

export function useVerification() {
  const context = useContext(VerificationContext);
  if (!context) {
    throw new Error(
      "useVerification must be used within VerificationProvider"
    );
  }
  return context;
}