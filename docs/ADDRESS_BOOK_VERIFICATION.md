# Address Book Label Signature Verification

## Overview

This document describes the cryptographic verification system for address book labels in Kora-Frontend. The system prevents phishing attacks and tampering by using Ed25519 signatures to verify that imported address labels have not been modified.

## Security Model

### Threat: Label Tampering During Import

Without verification, a malicious JSON file could:
1. Export a legitimate label for a trusted exchange (e.g., "Binance")
2. Modify the address to point to an attacker's wallet
3. User imports the file and sends funds to the wrong address

### Solution: Cryptographic Signatures

Each label can be signed using the wallet's Ed25519 keypair. The signature proves:
- **Authenticity**: The label was created by the holder of the private key
- **Integrity**: The label text has not been modified since signing
- **Non-repudiation**: The signer cannot deny creating the label

## Data Structures

### SignedLabel Type

```typescript
export type SignedLabel = {
  address: string;        // Stellar public key (G-address)
  label: string;          // Human-readable label
  signature: string;      // 128-character hex string (64 bytes Ed25519 signature)
  signedAt: number;       // Unix timestamp when label was signed (milliseconds)
};
```

### AddressBookEntry

```typescript
type AddressBookEntry = {
  id: string;             // Unique ID in local storage
  address: string;        // Stellar public key
  label: string;          // User-visible label (optional)
  signedLabel?: SignedLabel;  // Cryptographic proof (optional)
  groupIds?: string[];    // Organization (optional)
  isFavorite?: boolean;   // UI state (optional)
};
```

## Message Format

All label signatures use a standardized message format:

```
kora-label:{address}:{label}
```

Example:
```
kora-label:GDZST3XVCDTUJ76ZAV2HA72KYPMQ6YZNFPZHYZYB3NU4WFQNRPSXCBQH:My Trading Bot
```

The "kora-label:" prefix serves as a **domain separator** to prevent signature confusion with other signing contexts (challenge-response, authentication, etc.).

## Verification Process

The `verifySignedLabel()` function performs the following checks:

### 1. Structure Validation
- Address field exists and is non-empty
- Label field exists (may be empty string)
- Signature field exists and is non-empty

### 2. Format Validation
- Address matches Stellar public key regex: `^G[A-Z2-7]{55}$`
- Signature is exactly 128 hex characters (64 bytes)

### 3. Timestamp Validation
- Signature age < 30 days (prevents stale label re-verification)
- Signature timestamp ≤ now + 60 seconds (1 minute clock skew tolerance)

### 4. Message Reconstruction
- Recreate the signed message: `buildLabelMessage(address, label)`
- Encode as UTF-8 bytes

### 5. Cryptographic Verification
- Convert signature hex to bytes
- Use `Keypair.verify(message, signature)` from @stellar/stellar-sdk
- Returns true only if signature is valid for the reconstructed message and address

### 6. Failure Modes (Return False)
- Any validation step fails
- Signature verification fails
- Keypair instantiation fails
- Timestamp out of range
- Exception during verification

**Principle**: Fail closed on any error — only return true if verification succeeds.

## Implementation Files

### Core Verification (`store/walletStore.ts`)

```typescript
// Verify a signed label attestation
export function verifySignedLabel(attestation: SignedLabel): boolean

// Check if entry has verified label
export function isLabelVerified(entry: { signedLabel?: SignedLabel }): boolean

// Build message for signing
export function buildLabelMessage(address: string, label: string): string
```

### Import Validation (`lib/addressBookImport.ts`)

```typescript
// Validate single entry
export function validateAddressBookEntry(entry: Partial<AddressBookEntry>): string[]

// Import from JSON with comprehensive validation
export function importAddressBook(jsonText: string, options?: { allowUnsigned?: boolean }): ImportResult

// Export to JSON (strips UI-only fields)
export function exportAddressBook(entries: AddressBookEntry[]): string
```

### UI Component (`components/wallet/AddressBook.tsx`)

**Badge Display**:
- ✅ **Green ShieldCheck**: Cryptographically verified label
- ⚠️ **Yellow Shield**: Unsigned label (potential phishing risk)
- *(No badge)* Unsigned label or verification failed

**Actions**:
- Sign button: Only visible for unsigned labels
- Edit button: Always available (removes signature if modified)
- Delete button: Always available

## Usage Examples

### Signing a Label (Frontend)

```typescript
import { buildLabelMessage, type SignedLabel } from "@/store/walletStore";

// 1. Build the message to sign
const message = buildLabelMessage(address, label);

// 2. Get signature from wallet (using Freighter or other provider)
const { signature, publicKey } = await walletKit.signMessage({
  message,
  publicKey: address,
});

// 3. Convert to hex format
const signatureHex = Buffer.from(signature, 'base64').toString('hex');

// 4. Create SignedLabel
const signedLabel: SignedLabel = {
  address,
  label,
  signature: signatureHex,
  signedAt: Date.now(),
};

// 5. Store in address book
updateAddressBookEntry(entryId, { signedLabel });
```

### Verifying on Import

```typescript
import { importAddressBook } from "@/lib/addressBookImport";

// 1. Get JSON from user file upload
const jsonText = await file.text();

// 2. Validate and import
const result = importAddressBook(jsonText);

if (!result.success) {
  console.error("Import failed:", result.rejected);
  showErrorUI(result.rejected);
}

// 3. Show warnings about unsigned labels
if (result.warnings.length > 0) {
  console.warn("Import warnings:", result.warnings);
  showWarningUI(result.warnings);
}

// 4. Add imported entries
for (const entry of result.imported) {
  addAddressBookEntry(entry.address, entry.label, entry.signedLabel);
}
```

### Verifying a Label

```typescript
import { verifySignedLabel, isLabelVerified } from "@/store/walletStore";

// Single verification
if (verifySignedLabel(entry.signedLabel)) {
  console.log("Label is trusted");
} else {
  console.log("Label failed verification or is unsigned");
}

// Helper check
if (isLabelVerified(entry)) {
  console.log("Label has valid signature");
}
```

## Phishing Prevention

### Attack Scenario 1: Address Swapping

**Attacker's goal**: Make a label appear to be from one address, but claim it's from another.

**Protected by**:
- Signature covers both address and label
- Address mismatch in signed label is detected
- Modifying the address invalidates the signature

### Attack Scenario 2: Label Text Modification

**Attacker's goal**: Change "Binance" to "Binance (Phishing)" after import.

**Protected by**:
- Verification reconstructs the exact message that was signed
- Label must match exactly with signed label
- Any modification invalidates the signature

### Attack Scenario 3: Replay/Stale Signature

**Attacker's goal**: Reuse an old signature after the label has changed.

**Protected by**:
- Timestamp validation rejects signatures older than 30 days
- Recent timestamps only (1 minute future tolerance)
- Prevents signature reuse if label was later modified

### Attack Scenario 4: Signature from Different Keypair

**Attacker's goal**: Sign a label with their own key and claim it's from a trusted address.

**Protected by**:
- Verification uses the address as the public key
- Signature must verify against that specific address
- Mismatched keypair is detected

## Audit Trail and Recovery

### When Verification Fails

1. **UI shows warning icon** (yellow shield) instead of verification badge
2. **Unverified label remains editable** by user
3. **User can manually re-verify** by signing the label again
4. **Import rejects tampering** with detailed error messages

### Recovery Steps

If a user imports a tampered address book:
1. Import fails with reasons for each rejected entry
2. User is shown list of rejected addresses
3. User can manually re-import entries that passed verification
4. User can sign labels locally to create verified versions

## Testing

### Test Coverage

- **Unit tests** (`store/__tests__/walletStore.label-verification.test.ts`):
  - Valid signatures pass verification
  - Tampered signatures fail verification
  - Malformed attestations are rejected
  - Timestamp validation works correctly
  - Special characters in labels are handled
  - Known good/bad signature vectors

- **Integration tests** (`lib/__tests__/addressBookImport.test.ts`):
  - Address book import/export round-trip
  - Duplicate detection
  - Invalid JSON handling
  - Phishing attack scenarios
  - Edge cases (long labels, special characters)

### Running Tests

```bash
# Run label verification tests
npm run test -- store/__tests__/walletStore.label-verification.test.ts

# Run import validation tests
npm run test -- lib/__tests__/addressBookImport.test.ts

# Run all tests
npm run test
```

## Dependencies

- **@stellar/stellar-sdk**: Ed25519 signature verification via `Keypair.verify()`
- **builtin Buffer**: Hex-to-binary conversion
- **builtin crypto**: Random ID generation

## Future Enhancements

1. **Batch Signature Verification**: Verify multiple labels in parallel
2. **Signature Creation UI**: Guide user through label signing process
3. **Label Attestation Sharing**: QR code or link to share verified labels
4. **Timestamp Authority**: Optional server-side timestamp for additional trust
5. **Key Rotation**: Support for multiple keys per address over time
6. **Revocation List**: Ability to revoke signatures if private key is compromised

## Security Considerations

### What This Protects Against

- ✅ Label text modification after export
- ✅ Address swapping in imported labels
- ✅ Phishing attacks via modified address books
- ✅ Supply chain tampering of JSON exports
- ✅ Man-in-the-middle attacks on label data

### What This Does NOT Protect Against

- ❌ Private key compromise (sign with compromised key = untrusted signature)
- ❌ Social engineering (attacker convinces user to sign phishing label)
- ❌ Malware modifying imported data before storage
- ❌ Browser vulnerabilities or XSS attacks
- ❌ Physical/environmental threats to the device

### Best Practices

1. **Sign labels yourself**: Create verified labels by signing locally
2. **Verify imports carefully**: Check warnings when importing unsigned labels
3. **Audit regularly**: Periodically review address book entries
4. **Backup safely**: Store address book backups in secure location
5. **Update signatures**: Re-sign labels when moving to new wallet

## References

- [Stellar Ed25519 Signature Verification](https://developers.stellar.org/docs/build/apps-and-contracts/security/best-practices)
- [Ed25519 Standard (RFC 8037)](https://tools.ietf.org/html/rfc8037)
- [OWASP: Phishing Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Phishing_Prevention_Cheat_Sheet.html)
