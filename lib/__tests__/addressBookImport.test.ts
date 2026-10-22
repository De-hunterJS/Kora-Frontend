/**
 * Test suite for address book import validation.
 * 
 * Tests the validation pipeline for importing address books from JSON,
 * including signature verification and tampering detection.
 */

import { validateAddressBookEntry, importAddressBook, exportAddressBook, type AddressBookEntry } from '../addressBookImport';
// eslint-disable-next-line
const StellarSdk = require("@stellar/stellar-sdk");

describe('Address Book Import Validation', () => {
  // Create test keypair for deterministic signatures
  const testKeypair = StellarSdk.Keypair.random();
  const testAddress = testKeypair.publicKey();

  describe('validateAddressBookEntry', () => {
    it('should accept valid entries with only address', () => {
      const entry = { address: testAddress };
      const errors = validateAddressBookEntry(entry);
      expect(errors).toEqual([]);
    });

    it('should accept valid entries with address and unsigned label', () => {
      const entry = { address: testAddress, label: "My Exchange" };
      const errors = validateAddressBookEntry(entry);
      expect(errors).toEqual([]);
    });

    it('should accept valid entries with signed label', () => {
      const { buildLabelMessage } = require('@/store/walletStore');
      const label = "Trusted Broker";
      const message = buildLabelMessage(testAddress, label);
      const messageBuffer = Buffer.from(message, "utf8");
      const signatureBuffer = testKeypair.sign(messageBuffer);
      const signatureHex = signatureBuffer.toString('hex');

      const entry: AddressBookEntry = {
        address: testAddress,
        label,
        signedLabel: {
          address: testAddress,
          label,
          signature: signatureHex,
          signedAt: Date.now(),
        },
      };

      const errors = validateAddressBookEntry(entry);
      expect(errors).toEqual([]);
    });

    it('should reject entries without address', () => {
      const entry = { label: "Test" };
      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("Missing address"))).toBe(true);
    });

    it('should reject entries with invalid address format', () => {
      const entry = { address: "invalid-address", label: "Test" };
      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("Invalid Stellar address"))).toBe(true);
    });

    it('should reject entries with label type mismatch', () => {
      const entry = { address: testAddress, label: 123 as any };
      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("must be a string"))).toBe(true);
    });

    it('should reject entries with address mismatch in signed label', () => {
      const otherAddress = StellarSdk.Keypair.random().publicKey();
      const entry = {
        address: testAddress,
        label: "Test",
        signedLabel: {
          address: otherAddress, // Mismatch!
          label: "Test",
          signature: "a".repeat(128),
          signedAt: Date.now(),
        },
      };

      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("address mismatch"))).toBe(true);
    });

    it('should reject entries with label text tampering', () => {
      const { buildLabelMessage } = require('@/store/walletStore');
      const originalLabel = "Trusted Broker";
      const message = buildLabelMessage(testAddress, originalLabel);
      const messageBuffer = Buffer.from(message, "utf8");
      const signatureBuffer = testKeypair.sign(messageBuffer);
      const signatureHex = signatureBuffer.toString('hex');

      const entry: AddressBookEntry = {
        address: testAddress,
        label: "MODIFIED Broker", // Tampered!
        signedLabel: {
          address: testAddress,
          label: originalLabel,
          signature: signatureHex,
          signedAt: Date.now(),
        },
      };

      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("does not match signed label"))).toBe(true);
    });

    it('should reject entries with invalid signatures', () => {
      const entry: AddressBookEntry = {
        address: testAddress,
        label: "Test",
        signedLabel: {
          address: testAddress,
          label: "Test",
          signature: "b".repeat(128), // Invalid signature
          signedAt: Date.now(),
        },
      };

      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("Invalid or tampered signature"))).toBe(true);
    });

    it('should reject entries with invalid groupIds', () => {
      const entry = {
        address: testAddress,
        groupIds: ["valid-id", "", "another-valid-id"] as any,
      };

      const errors = validateAddressBookEntry(entry);
      expect(errors.some((e) => e.includes("non-empty strings"))).toBe(true);
    });
  });

  describe('importAddressBook', () => {
    it('should import valid JSON array', () => {
      const data = [
        { address: testAddress, label: "Exchange 1" },
        { address: StellarSdk.Keypair.random().publicKey(), label: "Exchange 2" },
      ];

      const result = importAddressBook(JSON.stringify(data));
      expect(result.success).toBe(true);
      expect(result.imported.length).toBe(2);
      expect(result.rejected.length).toBe(0);
    });

    it('should handle wrapped format { addressBook: [...] }', () => {
      const data = {
        addressBook: [
          { address: testAddress, label: "Test" },
        ],
      };

      const result = importAddressBook(JSON.stringify(data));
      expect(result.success).toBe(true);
      expect(result.imported.length).toBe(1);
    });

    it('should handle single entry wrapped format', () => {
      const data = { address: testAddress, label: "Single Entry" };
      const result = importAddressBook(JSON.stringify(data));
      expect(result.success).toBe(true);
      expect(result.imported.length).toBe(1);
    });

    it('should reject invalid JSON', () => {
      const result = importAddressBook("{ invalid json }");
      expect(result.success).toBe(false);
      expect(result.warnings.some((w) => w.includes("Failed to parse JSON"))).toBe(true);
    });

    it('should reject entries with validation errors', () => {
      const data = [
        { address: testAddress, label: "Valid" },
        { address: "invalid", label: "Invalid Address" },
        { label: "Missing Address" },
      ];

      const result = importAddressBook(JSON.stringify(data));
      expect(result.imported.length).toBe(1);
      expect(result.rejected.length).toBe(2);
    });

    it('should warn about unsigned labels', () => {
      const data = [
        { address: testAddress, label: "Unsigned Label" },
      ];

      const result = importAddressBook(JSON.stringify(data));
      expect(result.warnings.some((w) => w.includes("Unsigned label"))).toBe(true);
    });

    it('should not warn about unsigned labels when allowUnsigned is true', () => {
      const data = [
        { address: testAddress, label: "Unsigned Label" },
      ];

      const result = importAddressBook(JSON.stringify(data), { allowUnsigned: true });
      expect(result.warnings.every((w) => !w.includes("Unsigned label"))).toBe(true);
    });

    it('should filter out duplicate addresses', () => {
      const data = [
        { address: testAddress, label: "First" },
        { address: testAddress, label: "Second (Duplicate)" },
      ];

      const result = importAddressBook(JSON.stringify(data));
      expect(result.imported.length).toBe(1);
      expect(result.rejected.length).toBe(1);
      expect(result.rejected[0].reason).toContain("Duplicate address");
    });

    it('should handle case-insensitive duplicate detection', () => {
      // Stellar addresses should be case-insensitive for duplicate checking
      const data = [
        { address: testAddress, label: "First" },
        { address: testAddress.toLowerCase(), label: "Second" },
      ];

      const result = importAddressBook(JSON.stringify(data));
      expect(result.imported.length).toBe(1);
      expect(result.rejected.length).toBe(1);
    });

    it('should assign IDs to imported entries', () => {
      const data = [{ address: testAddress }];
      const result = importAddressBook(JSON.stringify(data));

      expect(result.imported[0].id).toBeDefined();
      expect(typeof result.imported[0].id).toBe("string");
    });
  });

  describe('exportAddressBook', () => {
    it('should export address book entries as JSON', () => {
      const entries: AddressBookEntry[] = [
        { address: testAddress, label: "Test", id: "test-id" },
      ];

      const json = exportAddressBook(entries);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].address).toBe(testAddress);
      expect(parsed[0].label).toBe("Test");
    });

    it('should exclude UI-only fields from export', () => {
      const entries: AddressBookEntry[] = [
        {
          address: testAddress,
          label: "Test",
          id: "test-id",
          isFavorite: true,
        },
      ];

      const json = exportAddressBook(entries);
      const parsed = JSON.parse(json);

      expect(parsed[0].id).toBeUndefined();
      expect(parsed[0].isFavorite).toBeUndefined();
    });

    it('should include signed labels in export', () => {
      const { buildLabelMessage } = require('@/store/walletStore');
      const label = "Signed Address";
      const message = buildLabelMessage(testAddress, label);
      const messageBuffer = Buffer.from(message, "utf8");
      const signatureBuffer = testKeypair.sign(messageBuffer);
      const signatureHex = signatureBuffer.toString('hex');

      const entries: AddressBookEntry[] = [
        {
          address: testAddress,
          label,
          signedLabel: {
            address: testAddress,
            label,
            signature: signatureHex,
            signedAt: Date.now(),
          },
        },
      ];

      const json = exportAddressBook(entries);
      const parsed = JSON.parse(json);

      expect(parsed[0].signedLabel).toBeDefined();
      expect(parsed[0].signedLabel.signature).toBe(signatureHex);
    });

    it('should omit empty groupIds from export', () => {
      const entries: AddressBookEntry[] = [
        { address: testAddress, label: "Test", groupIds: [] },
      ];

      const json = exportAddressBook(entries);
      const parsed = JSON.parse(json);

      expect(parsed[0].groupIds).toBeUndefined();
    });

    it('should include non-empty groupIds in export', () => {
      const entries: AddressBookEntry[] = [
        { address: testAddress, label: "Test", groupIds: ["group-1", "group-2"] },
      ];

      const json = exportAddressBook(entries);
      const parsed = JSON.parse(json);

      expect(parsed[0].groupIds).toEqual(["group-1", "group-2"]);
    });

    it('should support round-trip export/import cycle', () => {
      const originalEntries: AddressBookEntry[] = [
        { address: testAddress, label: "First", groupIds: ["work"] },
        { address: StellarSdk.Keypair.random().publicKey(), label: "Second" },
      ];

      const exported = exportAddressBook(originalEntries);
      const result = importAddressBook(exported, { allowUnsigned: true });

      expect(result.success).toBe(true);
      expect(result.imported.length).toBe(2);
      expect(result.imported[0].address).toBe(testAddress);
      expect(result.imported[0].label).toBe("First");
      expect(result.imported[0].groupIds).toEqual(["work"]);
    });
  });
});
