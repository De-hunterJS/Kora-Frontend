/**
 * Test suite for Ed25519 label signature verification.
 * 
 * These tests verify:
 * 1. Cryptographically valid signatures pass verification
 * 2. Invalid signatures are rejected (tampering detection)
 * 3. Malformed attestations are rejected
 * 4. Timestamp validation works correctly
 * 5. Different message formats are rejected
 */

import { buildLabelMessage, verifySignedLabel, isLabelVerified, type SignedLabel } from '../walletStore';
// eslint-disable-next-line
const StellarSdk = require("@stellar/stellar-sdk");

describe('Label Signature Verification', () => {
  // Use a known test keypair for deterministic testing
  const testKeypair = StellarSdk.Keypair.random();
  const testAddress = testKeypair.publicKey();
  const testLabel = "Test Exchange";

  /**
   * Helper: Create a valid signed label using the test keypair
   */
  function createValidSignedLabel(
    address: string = testAddress,
    label: string = testLabel,
    timestampOffset = 0
  ): SignedLabel {
    const message = buildLabelMessage(address, label);
    const messageBuffer = Buffer.from(message, "utf8");
    const signatureBuffer = testKeypair.sign(messageBuffer);
    const signatureHex = signatureBuffer.toString('hex');

    return {
      address,
      label,
      signature: signatureHex,
      signedAt: Date.now() + timestampOffset,
    };
  }

  describe('Valid Signatures', () => {
    it('should accept a cryptographically valid signature', () => {
      const attestation = createValidSignedLabel();
      expect(verifySignedLabel(attestation)).toBe(true);
    });

    it('should accept valid signatures with special characters in labels', () => {
      const specialLabels = [
        "Alice's Account",
        "Exchange & Broker",
        "Test-Label_123",
        "Label (main)",
        "中文标签",
        "🚀 Rocket Address",
      ];

      for (const label of specialLabels) {
        const attestation = createValidSignedLabel(testAddress, label);
        expect(verifySignedLabel(attestation)).toBe(true);
      }
    });

    it('should accept signatures with empty label string', () => {
      const attestation = createValidSignedLabel(testAddress, "");
      expect(verifySignedLabel(attestation)).toBe(true);
    });
  });

  describe('Invalid Signatures (Tampering Detection)', () => {
    it('should reject a signature from wrong keypair', () => {
      const validAttestation = createValidSignedLabel();
      const wrongKeypair = StellarSdk.Keypair.random();
      
      // Create signature with different keypair
      const message = buildLabelMessage(testAddress, testLabel);
      const messageBuffer = Buffer.from(message, "utf8");
      const wrongSignature = wrongKeypair.sign(messageBuffer).toString('hex');
      
      const tamperedAttestation: SignedLabel = {
        ...validAttestation,
        signature: wrongSignature,
      };

      expect(verifySignedLabel(tamperedAttestation)).toBe(false);
    });

    it('should reject signature with corrupted hex', () => {
      const attestation = createValidSignedLabel();
      const corruptedSignature = attestation.signature
        .split('')
        .map((c, i) => i === 0 ? (c === 'a' ? 'b' : 'a') : c)
        .join('');

      expect(verifySignedLabel({
        ...attestation,
        signature: corruptedSignature,
      })).toBe(false);
    });

    it('should reject signature with modified address', () => {
      const attestation = createValidSignedLabel();
      const wrongAddress = StellarSdk.Keypair.random().publicKey();

      expect(verifySignedLabel({
        ...attestation,
        address: wrongAddress,
      })).toBe(false);
    });

    it('should reject signature with modified label', () => {
      const attestation = createValidSignedLabel();

      expect(verifySignedLabel({
        ...attestation,
        label: attestation.label + " (modified)",
      })).toBe(false);
    });

    it('should reject signature with empty message', () => {
      const attestation = createValidSignedLabel();

      expect(verifySignedLabel({
        ...attestation,
        label: "",
        address: testAddress,
      })).toBe(false);
    });
  });

  describe('Malformed Attestations', () => {
    it('should reject attestation with missing address', () => {
      const attestation = createValidSignedLabel();
      const { address, ...incomplete } = attestation;

      expect(verifySignedLabel({
        ...incomplete,
        address: "",
      })).toBe(false);
    });

    it('should reject attestation with missing label', () => {
      const attestation = createValidSignedLabel();

      expect(verifySignedLabel({
        ...attestation,
        label: undefined as any,
      })).toBe(false);
    });

    it('should reject attestation with missing signature', () => {
      const attestation = createValidSignedLabel();

      expect(verifySignedLabel({
        ...attestation,
        signature: "",
      })).toBe(false);
    });

    it('should reject invalid Stellar address format', () => {
      const invalidAddresses = [
        "GABC1234567890",  // Too short
        "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJ",  // Too long
        "BABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC",  // Wrong prefix
        "gabc1234567890abcdefghijklmnopqrstuvwxyz1234567890abc",  // lowercase
        "0ABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC",  // numeric start
      ];

      for (const address of invalidAddresses) {
        const attestation = createValidSignedLabel(address);
        expect(verifySignedLabel(attestation)).toBe(false);
      }
    });

    it('should reject signature with wrong length', () => {
      const attestation = createValidSignedLabel();

      const invalidSignatures = [
        "aabbccdd",  // Too short
        "aabbccdd" + "aabbccdd".repeat(20),  // Too long
        "aabbccdd" + "gggggggg".repeat(10),  // Invalid hex chars
        attestation.signature.slice(0, 127),  // Off by one
        attestation.signature + "aa",  // One extra
      ];

      for (const sig of invalidSignatures) {
        expect(verifySignedLabel({
          ...attestation,
          signature: sig,
        })).toBe(false);
      }
    });
  });

  describe('Timestamp Validation', () => {
    it('should accept signatures from the past (within 30 days)', () => {
      const oneDayAgo = -1 * 24 * 60 * 60 * 1000;
      const attestation = createValidSignedLabel(testAddress, testLabel, oneDayAgo);
      expect(verifySignedLabel(attestation)).toBe(true);
    });

    it('should accept signatures with minor clock skew (1 minute into future)', () => {
      const slightlyInFuture = 30 * 1000; // 30 seconds in future
      const attestation = createValidSignedLabel(testAddress, testLabel, slightlyInFuture);
      expect(verifySignedLabel(attestation)).toBe(true);
    });

    it('should reject signatures too far in the past (> 30 days)', () => {
      const thirtyOneDaysAgo = -1 * (31 * 24 * 60 * 60 * 1000);
      const attestation = createValidSignedLabel(testAddress, testLabel, thirtyOneDaysAgo);
      expect(verifySignedLabel(attestation)).toBe(false);
    });

    it('should reject signatures too far in the future (> 1 minute)', () => {
      const twoMinutesInFuture = 2 * 60 * 1000;
      const attestation = createValidSignedLabel(testAddress, testLabel, twoMinutesInFuture);
      expect(verifySignedLabel(attestation)).toBe(false);
    });
  });

  describe('isLabelVerified helper', () => {
    it('should return false for entries without signedLabel', () => {
      const entry = { label: "Test", signedLabel: undefined };
      expect(isLabelVerified(entry)).toBe(false);
    });

    it('should return true for entries with valid signed label', () => {
      const attestation = createValidSignedLabel();
      const entry = { label: testLabel, signedLabel: attestation };
      expect(isLabelVerified(entry)).toBe(true);
    });

    it('should return false for entries with invalid signed label', () => {
      const attestation = createValidSignedLabel();
      const entry = {
        label: testLabel,
        signedLabel: {
          ...attestation,
          label: "Different Label",
        },
      };
      expect(isLabelVerified(entry)).toBe(false);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle Freighter-exported labels correctly', () => {
      // Simulate an exported label from Freighter address book
      const exportedLabel = createValidSignedLabel(testAddress, "My Trading Bot");
      expect(verifySignedLabel(exportedLabel)).toBe(true);
    });

    it('should detect phishing attempt with swapped address', () => {
      // Attacker tries to make label appear to be from one address, but it's signed by another
      const legitimateLabel = createValidSignedLabel(testAddress, "Trusted Exchange");
      const attackerAddress = StellarSdk.Keypair.random().publicKey();

      expect(verifySignedLabel({
        ...legitimateLabel,
        address: attackerAddress,  // Attacker tries to claim the label
      })).toBe(false);
    });

    it('should detect phishing attempt with modified label', () => {
      // Attacker modifies the label text after import but before display
      const importedLabel = createValidSignedLabel(testAddress, "Binance");
      
      expect(verifySignedLabel({
        ...importedLabel,
        label: "Binance (Phishing Scam)",  // Modified locally
      })).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle very long labels', () => {
      const longLabel = "A".repeat(1000);
      const attestation = createValidSignedLabel(testAddress, longLabel);
      expect(verifySignedLabel(attestation)).toBe(true);
    });

    it('should handle labels with all special characters', () => {
      const specialLabel = "!@#$%^&*()_+-=[]{}|;:',.<>?/\\`~";
      const attestation = createValidSignedLabel(testAddress, specialLabel);
      expect(verifySignedLabel(attestation)).toBe(true);
    });

    it('should handle null byte in label gracefully', () => {
      const labelWithNull = "Label\x00Injection";
      const attestation = createValidSignedLabel(testAddress, labelWithNull);
      expect(verifySignedLabel(attestation)).toBe(true);
    });
  });
});
