/**
 * Storybook stories for KycStatusCard.
 *
 * Covers all four KYC status states:
 *  - none (unverified)
 *  - pending (under review)
 *  - rejected (reverification needed)
 *  - verified (approved)
 *
 * The component reads kycStatus from useWalletStore, so each story
 * injects the desired status via a decorator that pre-populates the store.
 */

import type { Meta, StoryObj } from "@storybook/react";
import React, { useEffect } from "react";
import { KycStatusCard } from "./KycStatusCard";
import { useWalletStore } from "@/store/walletStore";

// ── Helper decorator ───────────────────────────────────────────────────────

function withKycStatus(status: "none" | "pending" | "rejected" | "verified") {
  return function Decorator(Story: React.ComponentType) {
    useEffect(() => {
      useWalletStore.setState({ kycStatus: status } as any);
      return () => useWalletStore.setState({ kycStatus: "none" } as any);
    }, []);
    return <Story />;
  };
}

// ── Meta ───────────────────────────────────────────────────────────────────

const meta: Meta<typeof KycStatusCard> = {
  title: "Dashboard/KycStatusCard",
  component: KycStatusCard,
  parameters: {
    layout: "padded",
    chromatic: { pauseAnimationAtEnd: true },
  },
};

export default meta;
type Story = StoryObj<typeof KycStatusCard>;

// ── Stories ────────────────────────────────────────────────────────────────

/** Default — wallet not yet verified. Shows "Start Verification" CTA. */
export const Unverified: Story = {
  decorators: [withKycStatus("none")],
};

/** KYC submitted and awaiting Synaps review. CTA is a loading spinner. */
export const Pending: Story = {
  decorators: [withKycStatus("pending")],
};

/** Verification failed. Shows "Re-verify Business" danger button. */
export const Rejected: Story = {
  decorators: [withKycStatus("rejected")],
};

/** KYC passed. Shows green verified badge — no CTA button. */
export const Verified: Story = {
  decorators: [withKycStatus("verified")],
};
