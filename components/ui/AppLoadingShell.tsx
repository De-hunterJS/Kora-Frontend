"use client";

/**
 * AppLoadingShell (#1017)
 *
 * A branded, lightweight skeleton shown while the IndexedDB query cache is
 * being restored by `persistQueryClientRestore`. It replaces the blank white
 * screen that appeared on slow devices / first install by giving the user a
 * visual signal that the app is loading rather than frozen.
 *
 * Design decisions:
 * - Matches the app's dark-mode-first theme using existing Tailwind tokens.
 * - Uses a simple pulsing animation (no external deps) to stay lightweight.
 * - The navbar and content area are approximated so the layout shift when the
 *   real content appears is minimal.
 * - Accessible: `aria-busy="true"` and `role="status"` communicate loading
 *   state to assistive technology.
 */

import { Skeleton } from "@/components/ui/skeleton";

export function AppLoadingShell() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading application"
      className="min-h-screen bg-background"
      data-testid="app-loading-shell"
    >
      {/* ── Navbar skeleton ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* Logo placeholder */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-5 w-24" />
          </div>

          {/* Nav links placeholder */}
          <div className="hidden items-center gap-6 md:flex">
            {[80, 96, 72, 88].map((w, i) => (
              <Skeleton key={i} className={`h-4 w-${w}`} style={{ width: w }} />
            ))}
          </div>

          {/* Right-side actions placeholder */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        </div>
      </header>

      {/* ── Page content skeleton ────────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Page title */}
        <div className="mb-8 space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>

        {/* Stat cards row */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card/60 p-5"
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded-sm" />
              </div>
              <Skeleton className="mt-2 h-8 w-32" />
            </div>
          ))}
        </div>

        {/* Content card */}
        <div className="rounded-xl border border-border bg-card/60">
          <div className="border-b border-border px-6 py-4">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Screen reader announcement */}
      <span className="sr-only">Loading Kora, please wait…</span>
    </div>
  );
}
