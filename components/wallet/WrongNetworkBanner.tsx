"use client";

import { AlertCircle, X, ChevronRight, CheckCircle2, RefreshCw, ShieldCheck, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useWallet } from "@/hooks/useWallet";
import { useWalletStore } from "@/store";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type WizardStep = "detect" | "switch" | "refresh" | "verify";

const STEPS: { key: WizardStep; stepNumber: number }[] = [
  { key: "detect", stepNumber: 1 },
  { key: "switch", stepNumber: 2 },
  { key: "refresh", stepNumber: 3 },
  { key: "verify", stepNumber: 4 },
];

const NETWORK_LABELS: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
  futurenet: "Futurenet",
};

export function WrongNetworkBanner() {
  const t = useTranslations("wrongNetwork");
  const tWizard = useTranslations("networkWizard");
  const { isConnected, switchNetwork, refreshNetwork, network } = useWallet();
  const { isWrongNetwork, hasPassphraseMismatch, walletPassphrase } = useWalletStore();
  const [dismissed, setDismissed] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>("detect");
  const [stepStatus, setStepStatus] = useState<Record<WizardStep, "pending" | "active" | "done" | "error">>({
    detect: "active",
    switch: "pending",
    refresh: "pending",
    verify: "pending",
  });

  const networkMismatch = isWrongNetwork();
  const passphraseMismatch = hasPassphraseMismatch();
  const expectedNetwork = (env.NEXT_PUBLIC_STELLAR_NETWORK as string) || "testnet";

  useEffect(() => {
    setDismissed(false);
  }, [isConnected, networkMismatch, passphraseMismatch]);

  useEffect(() => {
    if (showWizard) {
      setCurrentStep("detect");
      setStepStatus({
        detect: "active",
        switch: "pending",
        refresh: "pending",
        verify: "pending",
      });
    }
  }, [showWizard]);

  const isWrongNetworkState = (networkMismatch || passphraseMismatch) && !dismissed;

  if (!isWrongNetworkState) return null;

  const mismatchType = passphraseMismatch ? "passphrase" : "network";

  const advanceStep = useCallback(
    async (step: WizardStep) => {
      setStepStatus((prev) => ({ ...prev, [step]: "done" }));
      const nextIdx = STEPS.findIndex((s) => s.key === step) + 1;
      if (nextIdx < STEPS.length) {
        const nextStep = STEPS[nextIdx].key;
        setCurrentStep(nextStep);
        setStepStatus((prev) => ({ ...prev, [nextStep]: "active" }));
      }
    },
    []
  );

  const handleSwitchNetwork = async () => {
    setIsSwitching(true);
    try {
      await switchNetwork();
      await advanceStep("switch");
      setCurrentStep("refresh");
      setStepStatus((prev) => ({ ...prev, refresh: "active" }));
      await refreshNetwork();
      await advanceStep("refresh");
      setCurrentStep("verify");
      setStepStatus((prev) => ({ ...prev, verify: "active" }));
      const currentMismatch = useWalletStore.getState().isWrongNetwork() || useWalletStore.getState().hasPassphraseMismatch();
      if (!currentMismatch) {
        await advanceStep("verify");
      } else {
        setStepStatus((prev) => ({ ...prev, verify: "error" }));
      }
    } catch {
      setStepStatus((prev) => ({ ...prev, [currentStep]: "error" }));
    } finally {
      setIsSwitching(false);
    }
  };

  const handleRetry = () => {
    setStepStatus((prev) => ({ ...prev, [currentStep]: "active" }));
    handleSwitchNetwork();
  };

  const getStepInstructions = () => {
    const provider = useWalletStore.getState().provider;
    const steps = tWizard(provider === "freighter" ? "freighterSteps" : provider === "xbull" ? "xbullSteps" : "genericSteps", { network: NETWORK_LABELS[expectedNetwork] || expectedNetwork });
    return steps;
  };

  if (showWizard) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="sticky top-0 z-40 border-b border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-medium">{tWizard("title")}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowWizard(false)}
              aria-label={t("dismiss")}
              className="shrink-0 rounded-md p-1 hover:bg-destructive/20 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{tWizard("mismatchType")}:</span>
              <span className="font-medium">{tWizard(mismatchType)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{tWizard("currentNetwork")}:</span>
              <span className="font-medium">{NETWORK_LABELS[network] || network}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{tWizard("expectedNetwork")}:</span>
              <span className="font-medium">{NETWORK_LABELS[expectedNetwork] || expectedNetwork}</span>
            </div>
            {passphraseMismatch && walletPassphrase && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{tWizard("passphraseLabel")}:</span>
                <span className="font-mono text-[10px] break-all">{walletPassphrase}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 mb-3">
            {STEPS.map(({ key, stepNumber }) => {
              const status = stepStatus[key];
              const isCurrent = currentStep === key;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                    isCurrent && "bg-background border border-border",
                    status === "done" && "text-green-600",
                    status === "error" && "text-destructive",
                  )}
                >
                  {status === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : status === "active" && !isSwitching ? (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current" />
                  ) : status === "active" && isSwitching ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : status === "error" ? (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30" />
                  )}
                  <span className="font-medium">
                    {stepNumber}. {tWizard(`${key}Title`)}
                  </span>
                </div>
              );
            })}
          </div>

          {currentStep === "detect" && (
            <div className="rounded-lg border border-border bg-background/50 p-3 text-xs mb-3">
              <p>{tWizard("step1Desc")}</p>
            </div>
          )}

          {currentStep === "switch" && (
            <div className="rounded-lg border border-border bg-background/50 p-3 text-xs mb-3">
              <p className="mb-2 font-medium">{tWizard("switchInstructions")}</p>
              <pre className="whitespace-pre-wrap text-muted-foreground">{getStepInstructions()}</pre>
            </div>
          )}

          {currentStep === "verify" && stepStatus.verify === "error" && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs mb-3">
              <p>{tWizard("step4Desc")}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            {currentStep === "detect" || currentStep === "switch" ? (
              <Button
                variant="danger"
                size="sm"
                onClick={handleSwitchNetwork}
                isLoading={isSwitching}
              >
                {tWizard("switchButton")}
              </Button>
            ) : currentStep === "verify" && stepStatus.verify === "error" ? (
              <Button
                variant="danger"
                size="sm"
                onClick={handleRetry}
                isLoading={isSwitching}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                {tWizard("tryAgain")}
              </Button>
            ) : currentStep === "verify" && stepStatus.verify === "done" ? (
              <div className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {tWizard("success")}
              </div>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWizard(false)}
            >
              {tWizard("cancel")}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-destructive/10 px-4 py-3 text-sm text-destructive border-b border-destructive/20"
      >
        <div className="flex items-center gap-2 flex-1">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-medium">
            {t("message", {
              current: NETWORK_LABELS[network] || network,
              expected: NETWORK_LABELS[expectedNetwork] || expectedNetwork,
              passphrase: passphraseMismatch ? t("passphraseMismatch") : "",
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowWizard(true)}
            aria-label={t("fix")}
          >
            <ChevronRight className="h-3 w-3 mr-0.5" />
            {t("fix")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleSwitchNetwork}
            isLoading={isSwitching}
            aria-label={t("switchNetwork")}
          >
            {t("switchNetwork")}
          </Button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t("dismiss")}
            className="shrink-0 rounded-md p-1 hover:bg-destructive/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}