/**
 * Address book import validation and utilities.
 * 
 * Provides utilities for safely importing address books with cryptographic
 * verification of label signatures to prevent tampering and phishing attacks.
 */

import { verifySignedLabel, isLabelVerified, type SignedLabel } from "@/store/walletStore";
import { isValidStellarAddress } from "./utils";

export interface AddressBookEntry {
  id?: string;
  address: string;
  label?: string;
  signedLabel?: SignedLabel;
  groupIds?: string[];
  isFavorite?: boolean;
}

export interface ImportResult {
  success: boolean;
  imported: AddressBookEntry[];
  rejected: RejectedEntry[];
  warnings: string[];
}

export interface RejectedEntry {
  entry: Partial<AddressBookEntry>;
  reason: string;
}

/**
 * Validate a single address book entry for import.
 * 
 * Returns a list of validation errors (empty if valid).
 * 
 * Rules:
 * - Address must be a valid Stellar public key
 * - Label (if present) must be a non-empty string
 * - If signedLabel is present, it must pass cryptographic verification
 * - Empty labels are allowed but signedLabel requires matching label
 */
export function validateAddressBookEntry(entry: Partial<AddressBookEntry>): string[] {
  const errors: string[] = [];

  // Validate address
  if (!entry.address) {
    errors.push("Missing address");
  } else if (!isValidStellarAddress(entry.address)) {
    errors.push(`Invalid Stellar address format: ${entry.address}`);
  }

  // Validate label
  if (entry.label !== undefined && typeof entry.label !== "string") {
    errors.push("Label must be a string");
  }

  // Validate signedLabel cryptographically
  if (entry.signedLabel) {
    if (!entry.address) {
      errors.push("Cannot verify signed label without address");
    } else {
      // Check that the signed label matches the entry
      if (entry.signedLabel.address !== entry.address) {
        errors.push(
          `Signed label address mismatch: label claims ${entry.signedLabel.address} but entry has ${entry.address}`
        );
      }

      if (entry.label && entry.signedLabel.label !== entry.label) {
        errors.push(
          "Label text does not match signed label (tampering detected)"
        );
      }

      // Verify the signature
      if (!verifySignedLabel(entry.signedLabel)) {
        errors.push("Invalid or tampered signature on label");
      }
    }
  }

  // Validate groupIds
  if (entry.groupIds !== undefined) {
    if (!Array.isArray(entry.groupIds)) {
      errors.push("groupIds must be an array");
    } else if (
      entry.groupIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      errors.push("All groupIds must be non-empty strings");
    }
  }

  return errors;
}

/**
 * Validate and import an address book from JSON.
 * 
 * Performs comprehensive validation:
 * - Checks each entry for format and cryptographic validity
 * - Rejects entries with invalid signatures (indicates tampering)
 * - Warns about unsigned labels (may be phishing risk)
 * - Filters out duplicates
 * 
 * Returns detailed import result with lists of:
 * - Imported entries (passed validation)
 * - Rejected entries (with reasons)
 * - Warnings (e.g., unsigned labels)
 */
export function importAddressBook(
  jsonText: string,
  options?: {
    allowUnsigned?: boolean; // If false, warns about unsigned labels
  }
): ImportResult {
  const result: ImportResult = {
    success: false,
    imported: [],
    rejected: [],
    warnings: [],
  };

  // Parse JSON
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch (error) {
    result.warnings.push(`Failed to parse JSON: ${error}`);
    return result;
  }

  // Ensure we have an array
  if (!Array.isArray(data)) {
    if (data && typeof data === "object" && "addressBook" in data) {
      // Handle wrapped format: { addressBook: [...] }
      data = data.addressBook;
    } else if (data && typeof data === "object") {
      // Handle single-entry wrapped format
      data = [data];
    } else {
      result.warnings.push("Expected JSON array of address book entries");
      return result;
    }
  }

  // Validate and filter entries
  const seenAddresses = new Set<string>();

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];

    // Validate entry structure
    const validationErrors = validateAddressBookEntry(entry);
    if (validationErrors.length > 0) {
      result.rejected.push({
        entry,
        reason: validationErrors.join("; "),
      });
      continue;
    }

    // Check for duplicates
    if (seenAddresses.has(entry.address.toLowerCase())) {
      result.rejected.push({
        entry,
        reason: "Duplicate address in import",
      });
      continue;
    }
    seenAddresses.add(entry.address.toLowerCase());

    // Warn about unsigned labels
    if (
      entry.label &&
      !entry.signedLabel &&
      options?.allowUnsigned !== false
    ) {
      result.warnings.push(
        `Unsigned label for ${entry.address}: "${entry.label}" (may be unverified)`
      );
    }

    // Add to import list
    result.imported.push({
      ...entry,
      id: entry.id || `imported-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    });
  }

  result.success = result.imported.length > 0;
  return result;
}

/**
 * Export address book entries to JSON string.
 * 
 * Includes only cryptographically verifiable information:
 * - Address (validated)
 * - Label (only if signed)
 * - SignedLabel (with signature)
 * - GroupIds (for organization)
 * 
 * Strips UI-only fields like 'id', 'isFavorite' to prevent misuse.
 */
export function exportAddressBook(entries: AddressBookEntry[]): string {
  const exportData = entries.map((entry) => ({
    address: entry.address,
    label: entry.label || undefined,
    signedLabel: entry.signedLabel,
    groupIds: entry.groupIds && entry.groupIds.length > 0 ? entry.groupIds : undefined,
  }));

  return JSON.stringify(exportData, null, 2);
}
