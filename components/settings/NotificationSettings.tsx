"use client";

import { useEffect, useRef, useState } from "react";
import { Compass, Download, Keyboard, RotateCcw, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore, type MaturityReminderDays, type Persona } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { env } from "@/lib/env";

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
          // The knob travels along the inline axis: left-to-right in LTR, right-to-left
          // under dir="rtl". The negative RTL translate mirrors the resting/checked
          // positions instead of leaving the knob pinned to the start edge.
          checked
            ? "translate-x-5 rtl:-translate-x-5"
            : "translate-x-1 rtl:-translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export function NotificationSettings() {
  const t = useTranslations("settings.notifications");
  const tOnboarding = useTranslations("onboarding");
  const { notifications, setNotifications, resetNotifications, tour, setTourSettings, restartTour } = useSettingsStore();
  const shortcutsEnabled = useUIStore((s) => s.shortcutsEnabled);
  const setShortcutsEnabled = useUIStore((s) => s.setShortcutsEnabled);
  const { address, exportWalletDiagnostics, importWalletDiagnostics } = useWallet();
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Items array built at render time from translated strings — no hardcoded English
  const NOTIFICATION_ITEMS: Array<{
    key: "maturityReminder" | "fundingAlerts" | "repaymentAlerts";
    label: string;
    description: string;
  }> = [
    {
      key: "maturityReminder",
      label: t("maturityReminder.label"),
      description: t("maturityReminder.description"),
    },
    {
      key: "fundingAlerts",
      label: t("fundingAlerts.label"),
      description: t("fundingAlerts.description"),
    },
    {
      key: "repaymentAlerts",
      label: t("repaymentAlerts.label"),
      description: t("repaymentAlerts.description"),
    },
  ];

  const handleExportDiagnostics = () => {
    const payload = exportWalletDiagnostics();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kora-wallet-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImportDiagnostics = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      importWalletDiagnostics(raw);
      setImportStatus(t("diagnosticsSection.importSuccess"));
    } catch (error) {
      setImportStatus(
        error instanceof Error ? error.message : t("diagnosticsSection.importFailed")
      );
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Notification Preferences ────────────────────────────────────── */}
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{t("sectionTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("sectionDesc")}</p>
      </div>

      <div className="space-y-3">
        {NOTIFICATION_ITEMS.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
            </div>
            <Toggle
              checked={notifications[item.key]}
              onChange={(next) => setNotifications({ [item.key]: next })}
              ariaLabel={t("toggleAriaLabel", { label: item.label })}
            />
          </div>
        ))}
      </div>

      {/* ── Reminder timing ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-3">
        <label htmlFor="maturity-reminder-days" className="block text-sm font-medium text-foreground">
          {t("reminderTiming.label")}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("reminderTiming.description")}</p>
        <select
          id="maturity-reminder-days"
          value={notifications.maturityReminderDays}
          onChange={(e) => setNotifications({ maturityReminderDays: Number(e.target.value) as MaturityReminderDays })}
          className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          disabled={!notifications.maturityReminder}
        >
          <option value={1}>{t("reminderTiming.day1")}</option>
          <option value={3}>{t("reminderTiming.day3")}</option>
          <option value={7}>{t("reminderTiming.day7")}</option>
        </select>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
        onClick={resetNotifications}
      >
        {t("resetDefaults")}
      </Button>

      {/* ── Onboarding Tour Settings ────────────────────────────────────── */}
      <div className="space-y-1 pt-2">
        <h3 className="text-base font-semibold text-foreground">{t("tourSection.title")}</h3>
        <p className="text-sm text-muted-foreground">
          {tOnboarding("restartTourDesc")}
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div>
          <label htmlFor="tour-persona-select" className="block text-xs font-medium text-foreground">
            {tOnboarding("activePersona")}
          </label>
          <select
            id="tour-persona-select"
            value={tour.persona}
            onChange={(e) => setTourSettings({ persona: e.target.value as Persona })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option value="investor">{tOnboarding("personaInvestor")}</option>
            <option value="sme">{tOnboarding("personaSme")}</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>Status:</span>
          <span className="font-medium text-foreground">
            {tour.completed
              ? tOnboarding("tourCompleted")
              : tour.skipped
                ? tOnboarding("tourSkipped")
                : `Step ${(tour.stepIndex ?? 0) + 1}`}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          leftIcon={<Compass className="h-3.5 w-3.5" />}
          onClick={() => restartTour(tour.persona)}
        >
          {tOnboarding("restartTour")}
        </Button>
      </div>

      {/* ── Keyboard shortcuts toggle ──────────────────────────────────────── */}
      <div className="space-y-1 pt-2">
        <h3 className="text-base font-semibold text-foreground">{t("shortcutsSection.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("shortcutsSection.description")}</p>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("shortcutsSection.enableLabel")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("shortcutsSection.enableDesc", { key: "?" })}
            </p>
          </div>
        </div>
        <Toggle
          checked={shortcutsEnabled}
          onChange={setShortcutsEnabled}
          ariaLabel={t("shortcutsSection.toggleAriaLabel")}
        />
      </div>

      {/* ── Support Diagnostics ──────────────────────────────────────────── */}
      <div className="space-y-2 pt-2">
        <h3 className="text-base font-semibold text-foreground">{t("diagnosticsSection.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("diagnosticsSection.description")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={handleExportDiagnostics}
          >
            {t("diagnosticsSection.exportButton")}
          </Button>
          {env.NEXT_PUBLIC_ENABLE_DEVTOOLS && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportDiagnostics}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("diagnosticsSection.importButton")}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("diagnosticsSection.exportNote")}</p>
        {importStatus && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {importStatus}
          </p>
        )}
      </div>
    </div>
  );
}
