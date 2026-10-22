"use client";

/**
 * Concentration threshold settings (issue #604, settings surface).
 *
 * The portfolio concentration banners in the investor dashboard evaluate
 * against `concentration.thresholds`, and the store has always been able to
 * persist them — but there was no surface to change them from the defaults.
 * This is that surface.
 *
 * It writes straight through `setConcentrationThresholds` so the alerts and
 * this form read the same values, and mirrors the notification settings card
 * styling so `/settings` reads as one page rather than two.
 */

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settingsStore";
import {
  DEFAULT_CONCENTRATION_THRESHOLDS,
  type ConcentrationDimension,
} from "@/lib/concentrationRisk";
import { useWallet } from "@/hooks/useWallet";

/** Thresholds are shares of portfolio value, so the domain is a percentage. */
export const CONCENTRATION_THRESHOLD_MIN = 0;
export const CONCENTRATION_THRESHOLD_MAX = 100;

const DIMENSIONS: ConcentrationDimension[] = ["debtor", "jurisdiction", "riskTier"];

/**
 * Clamp a user-entered threshold into the 0–100 percentage domain. Non-finite
 * input collapses to the minimum rather than propagating `NaN` into the store,
 * where it would silently disable the dimension.
 */
export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return CONCENTRATION_THRESHOLD_MIN;
  return Math.min(
    CONCENTRATION_THRESHOLD_MAX,
    Math.max(CONCENTRATION_THRESHOLD_MIN, Math.round(value)),
  );
}

interface ThresholdControlProps {
  dimension: ConcentrationDimension;
  value: number;
  onChange: (value: number) => void;
}

function ThresholdControl({ dimension, value, onChange }: ThresholdControlProps) {
  const t = useTranslations("concentrationRisk");
  // Local draft so the number field can be cleared/retyped without the
  // controlled value snapping back mid-edit; committed (and clamped) on blur.
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const label = t(`dimensions.${dimension}`);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clampThreshold(parsed);
    setDraft(String(next));
    onChange(next);
  };

  const handleSlider = (raw: string) => {
    const next = clampThreshold(Number(raw));
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`dimensionHints.${dimension}`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <input
            type="number"
            min={CONCENTRATION_THRESHOLD_MIN}
            max={CONCENTRATION_THRESHOLD_MAX}
            step={1}
            value={draft}
            aria-label={t("percentageAria", { dimension: label })}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            className="h-8 w-16 rounded-lg border border-border bg-background px-2 text-end text-sm text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            %
          </span>
        </div>
      </div>

      <input
        type="range"
        min={CONCENTRATION_THRESHOLD_MIN}
        max={CONCENTRATION_THRESHOLD_MAX}
        step={1}
        value={value}
        aria-label={t("sliderAria", { dimension: label })}
        onChange={(e) => handleSlider(e.target.value)}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
      />
    </div>
  );
}

export function ConcentrationThresholdSettings() {
  const t = useTranslations("concentrationRisk");
  const { isConnected } = useWallet();
  const thresholds = useSettingsStore((s) => s.concentration.thresholds);
  const setConcentrationThresholds = useSettingsStore(
    (s) => s.setConcentrationThresholds,
  );

  // Preferences are stored per wallet and there is nothing meaningful to edit
  // while disconnected — this matches the `/settings` shell's guard.
  if (!isConnected) return null;

  const resetToDefaults = () =>
    setConcentrationThresholds(DEFAULT_CONCENTRATION_THRESHOLDS);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">
          {t("thresholdsTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("thresholdsDescription")}
        </p>
      </div>

      <div className="space-y-3">
        {DIMENSIONS.map((dimension) => (
          <ThresholdControl
            key={dimension}
            dimension={dimension}
            value={thresholds[dimension]}
            onChange={(value) => setConcentrationThresholds({ [dimension]: value })}
          />
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
        onClick={resetToDefaults}
      >
        {t("resetToDefaults")}
      </Button>
    </div>
  );
}

export default ConcentrationThresholdSettings;
