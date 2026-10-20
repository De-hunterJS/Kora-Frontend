/**
 * Storybook stories for Navbar.
 *
 * Navbar reads from multiple Zustand stores and Next.js router hooks, so
 * each story uses decorators to seed the required state. Stories cover:
 *
 *  - Desktop disconnected  — unauthenticated landing state
 *  - Desktop connected     — wallet address shown, balance visible
 *  - Desktop with unread changelog dot
 *  - Mobile menu closed    — hamburger visible
 *  - Mobile menu open      — nav drawer expanded
 *  - Secondary market link visible (feature flag on)
 *
 * Router context is provided by Storybook's Next.js addon
 * (@storybook/nextjs). Store state is injected via decorators.
 */

import type { Meta, StoryObj } from "@storybook/react";
import React, { useEffect } from "react";
import { Navbar } from "./Navbar";
import { useWalletStore } from "@/store/walletStore";
import { useUIStore } from "@/store/uiStore";
import { setFeatureFlagOverride, resetFeatureFlagOverrides } from "@/lib/featureFlags";

// ── Decorators ─────────────────────────────────────────────────────────────

function withWalletState(connected: boolean, address?: string) {
  return function Decorator(Story: React.ComponentType) {
    useEffect(() => {
      useWalletStore.setState({
        isConnected: connected,
        address: connected
          ? (address ?? "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678")
          : null,
        kycStatus: connected ? "verified" : "none",
      } as any);
      return () => {
        useWalletStore.setState({ isConnected: false, address: null } as any);
      };
    }, []);
    return <Story />;
  };
}

function withChangelogUnread(hasUnread: boolean) {
  return function Decorator(Story: React.ComponentType) {
    useEffect(() => {
      // The changelog badge reads from localStorage; set the seen version
      // to a past version so the dot renders.
      if (hasUnread) {
        localStorage.removeItem("kora-changelog-seen");
      } else {
        localStorage.setItem("kora-changelog-seen", "999.0.0");
      }
    }, []);
    return <Story />;
  };
}

function withSecondaryMarket(enabled: boolean) {
  return function Decorator(Story: React.ComponentType) {
    useEffect(() => {
      setFeatureFlagOverride("secondary-market", enabled);
      return () => resetFeatureFlagOverrides();
    }, []);
    return <Story />;
  };
}

// ── Meta ───────────────────────────────────────────────────────────────────

const meta: Meta<typeof Navbar> = {
  title: "Layout/Navbar",
  component: Navbar,
  parameters: {
    layout: "fullscreen",
    // Provide a stable pathname for active-link highlighting
    nextjs: {
      navigation: {
        pathname: "/marketplace",
      },
    },
    chromatic: {
      pauseAnimationAtEnd: true,
      // Capture both breakpoints — mobile menu differs from desktop
      viewports: [375, 1280],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Navbar>;

// ── Stories ────────────────────────────────────────────────────────────────

/** Desktop — wallet not connected. Shows "Connect Wallet" button. */
export const DesktopDisconnected: Story = {
  decorators: [withWalletState(false)],
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
};

/** Desktop — wallet connected. Address and balance shown. */
export const DesktopConnected: Story = {
  decorators: [withWalletState(true)],
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
};

/**
 * Desktop — unread changelog dot visible on the Sparkles icon.
 * Clears when the modal is opened.
 */
export const DesktopChangelogUnread: Story = {
  decorators: [withWalletState(true), withChangelogUnread(true)],
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
};

/**
 * Desktop — secondary market nav link visible.
 * Controlled by the "secondary-market" feature flag.
 */
export const DesktopWithSecondaryMarket: Story = {
  decorators: [withWalletState(true), withSecondaryMarket(true)],
  parameters: {
    viewport: { defaultViewport: "desktop" },
  },
};

/** Mobile — hamburger closed, compact layout. */
export const MobileClosed: Story = {
  decorators: [withWalletState(false)],
  parameters: {
    viewport: { defaultViewport: "mobile1" },
    nextjs: { navigation: { pathname: "/marketplace" } },
  },
};

/** Mobile — connected wallet, compact layout. */
export const MobileConnected: Story = {
  decorators: [withWalletState(true)],
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};
