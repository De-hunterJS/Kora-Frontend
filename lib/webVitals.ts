/**
 * Web Vitals monitoring utilities for Kora Protocol.
 *
 * Development: logs all vitals to console with pass/fail against Core Web Vitals thresholds.
 * Production:  sends vitals to /api/vitals endpoint.
 *
 * Thresholds (Google Core Web Vitals 2024):
 *   LCP  < 2500ms  (good) / < 4000ms (needs improvement)
 *   FID  < 100ms   (good) / < 300ms  (needs improvement)
 *   CLS  < 0.1     (good) / < 0.25   (needs improvement)
 *   TTFB < 800ms   (good) / < 1800ms (needs improvement)
 *   INP  < 200ms   (good) / < 500ms  (needs improvement)
 */

import type { NextWebVitalsMetric } from "next/app";
import { getCsrfToken } from "@/lib/csrfClient";

// ─── Thresholds ───────────────────────────────────────────────────────────────

export type VitalRating = "good" | "needs-improvement" | "poor";

export interface VitalThreshold {
  good: number;
  needsImprovement: number;
  unit: string;
}

export const VITAL_THRESHOLDS: Record<string, VitalThreshold> = {
  LCP:  { good: 2500,  needsImprovement: 4000,  unit: "ms" },
  FID:  { good: 100,   needsImprovement: 300,   unit: "ms" },
  CLS:  { good: 0.1,   needsImprovement: 0.25,  unit: "" },
  TTFB: { good: 800,   needsImprovement: 1800,  unit: "ms" },
  INP:  { good: 200,   needsImprovement: 500,   unit: "ms" },
};

export function getVitalRating(name: string, value: number): VitalRating {
  const threshold = VITAL_THRESHOLDS[name];
  if (!threshold) return "good";
  if (value <= threshold.good) return "good";
  if (value <= threshold.needsImprovement) return "needs-improvement";
  return "poor";
}

// ─── CI regression gate (Issue #437) ─────────────────────────────────────────
//
// VITAL_THRESHOLDS above answers "is this page fast enough in absolute terms".
// That is not the same question CI needs to ask. A page can sit comfortably
// under the "good" LCP bar while a PR doubles it — still green, still a real
// regression, and nothing catches it until it crosses 2500ms months later.
//
// The gate below is relative: it compares a run against the committed
// performance-baseline.json and fails when a metric has grown by more than
// REGRESSION_THRESHOLD_PCT. Consumed by e2e/performance.spec.ts.

/** A metric regresses when it exceeds baseline by more than this fraction. */
export const REGRESSION_THRESHOLD_PCT = 0.1;

/**
 * Minimum absolute growth before a metric can be reported as a regression.
 *
 * Percentage alone is far too twitchy at the small end: a TTFB moving 8ms →
 * 9ms is +12.5% and would fail the build, but it is indistinguishable from CI
 * runner noise. A regression must be both proportionally *and* absolutely
 * meaningful, which is what keeps the false-positive rate survivable on shared
 * CI hardware.
 *
 * Keyed by metric; `default` covers millisecond metrics not listed.
 */
export const REGRESSION_MIN_DELTA: Record<string, number> = {
  // CLS is unitless and typically ~0.0–0.25, so its floor is not in ms.
  CLS: 0.02,
  default: 50,
};

/** Vitals the CI gate enforces. */
export const GATED_VITALS = ["LCP", "CLS", "TTFB", "FCP"] as const;

export interface VitalRegression {
  name: string;
  current: number;
  baseline: number;
  /** Growth as a fraction of baseline, e.g. 0.23 for +23%. */
  changePct: number;
  limit: number;
}

export interface VitalsRegressionReport {
  regressions: VitalRegression[];
  /** Metrics that were compared and stayed within budget. */
  passed: VitalRegression[];
  /** Present in one set of numbers but not the other — never a failure. */
  skipped: string[];
}

/**
 * Compare a run's vitals against a baseline and classify each metric.
 *
 * Pure and side-effect free so the gate's logic can be reasoned about (and
 * unit-tested) without booting a browser. The caller decides what to do with
 * a non-empty `regressions` array — the spec fails the test, but a report-only
 * mode is equally possible.
 *
 * A metric is a regression only when **both** conditions hold:
 *   1. `current > baseline * (1 + REGRESSION_THRESHOLD_PCT)`
 *   2. `current - baseline >= REGRESSION_MIN_DELTA[name]`
 *
 * Metrics missing from either side are skipped rather than failed, so adding a
 * new vital does not break the build until a baseline is recorded for it.
 */
export function evaluateVitalsRegression(
  current: Record<string, number>,
  baseline: Record<string, number> | undefined,
  metrics: readonly string[] = GATED_VITALS,
): VitalsRegressionReport {
  const report: VitalsRegressionReport = {
    regressions: [],
    passed: [],
    skipped: [],
  };

  for (const name of metrics) {
    const currentValue = current[name];
    const baselineValue = baseline?.[name];

    if (typeof currentValue !== "number" || !Number.isFinite(currentValue)) {
      report.skipped.push(name);
      continue;
    }
    if (typeof baselineValue !== "number" || !Number.isFinite(baselineValue)) {
      report.skipped.push(name);
      continue;
    }

    const limit = baselineValue * (1 + REGRESSION_THRESHOLD_PCT);
    const minDelta = REGRESSION_MIN_DELTA[name] ?? REGRESSION_MIN_DELTA.default;
    // Guard against a zero baseline, which would make changePct infinite.
    const changePct =
      baselineValue === 0 ? 0 : (currentValue - baselineValue) / baselineValue;

    const entry: VitalRegression = {
      name,
      current: currentValue,
      baseline: baselineValue,
      changePct,
      limit,
    };

    const overBudget =
      currentValue > limit && currentValue - baselineValue >= minDelta;

    if (overBudget) {
      report.regressions.push(entry);
    } else {
      report.passed.push(entry);
    }
  }

  return report;
}

/** Human-readable one-liner for a regression, for CI logs and failure output. */
export function formatRegression(r: VitalRegression): string {
  const pct = (r.changePct * 100).toFixed(1);
  const unit = VITAL_THRESHOLDS[r.name]?.unit ?? "";
  return (
    `${r.name}: ${r.current.toFixed(2)}${unit} vs baseline ` +
    `${r.baseline.toFixed(2)}${unit} (+${pct}%, limit ${r.limit.toFixed(2)}${unit})`
  );
}

// ─── Console logger (development) ────────────────────────────────────────────

const RATING_STYLES: Record<VitalRating, string> = {
  "good":              "color: #22c55e; font-weight: bold",
  "needs-improvement": "color: #f59e0b; font-weight: bold",
  "poor":              "color: #ef4444; font-weight: bold",
};

const RATING_LABELS: Record<VitalRating, string> = {
  "good":              "✅ PASS",
  "needs-improvement": "⚠️  WARN",
  "poor":              "❌ FAIL",
};

export function logVitalToConsole(metric: NextWebVitalsMetric): void {
  const { name, value, id, label } = metric;
  const threshold = VITAL_THRESHOLDS[name];
  const rating = getVitalRating(name, value);
  const unit = threshold?.unit ?? "";
  const displayValue = name === "CLS" ? value.toFixed(4) : `${Math.round(value)}${unit}`;

  const style = RATING_STYLES[rating];
  const badge = RATING_LABELS[rating];

  console.groupCollapsed(
    `%c${badge}%c  Web Vital: %c${name}%c = ${displayValue}`,
    style,
    "color: inherit; font-weight: normal",
    "color: #14b8a6; font-weight: bold",
    "color: inherit"
  );
  console.log("Value:   ", displayValue);
  console.log("Rating:  ", rating);
  console.log("ID:      ", id);
  console.log("Label:   ", label);
  if (threshold) {
    console.log(
      `Threshold: good < ${threshold.good}${unit} | needs-improvement < ${threshold.needsImprovement}${unit}`
    );
  }
  console.groupEnd();

  // Warn loudly when a vital exceeds its threshold
  if (rating === "poor") {
    console.warn(
      `[Kora Web Vitals] ❌ ${name} is POOR (${displayValue}). ` +
        `Threshold: good < ${threshold?.good}${unit}. ` +
        `This will hurt Core Web Vitals scores.`
    );
  } else if (rating === "needs-improvement") {
    console.warn(
      `[Kora Web Vitals] ⚠️  ${name} needs improvement (${displayValue}). ` +
        `Target: < ${threshold?.good}${unit}.`
    );
  }
}

// ─── Production reporter ──────────────────────────────────────────────────────

/** Batched queue so we don't fire a request per metric */
let _queue: NextWebVitalsMetric[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(() => {
    void flushVitals();
    _flushTimer = null;
  }, 2000); // batch within 2 s
}

export async function flushVitals(): Promise<void> {
  if (_queue.length === 0) return;
  const payload = _queue.splice(0);

  const body = JSON.stringify({
    metrics: payload.map(({ name, value, id, label, startTime }) => ({
      name,
      value: name === "CLS" ? Number(value.toFixed(4)) : Math.round(value),
      id,
      label,
      startTime: Math.round(startTime),
      rating: getVitalRating(name, value),
      url: typeof window !== "undefined" ? window.location.pathname : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      timestamp: Date.now(),
    })),
  });

  const csrfToken = await getCsrfToken();
  fetch("/api/vitals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "x-kora-csrf": csrfToken } : {}),
    },
    body,
    keepalive: true,
  }).catch(() => {
    // Silently ignore — vitals reporting must never break the app
  });
}

export function sendVitalToEndpoint(metric: NextWebVitalsMetric): void {
  _queue.push(metric);
  scheduleFlush();
}

// ─── Main handler (used by reportWebVitals in layout.tsx) ────────────────────

export function handleWebVital(metric: NextWebVitalsMetric): void {
  if (process.env.NODE_ENV === "development") {
    logVitalToConsole(metric);
  } else {
    sendVitalToEndpoint(metric);
  }
}
