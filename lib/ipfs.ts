/**
 * IPFS upload service via Pinata.
 * Supports XHR progress tracking, CID validation, and retry on 5xx errors.
 *
 * All metadata uploads are validated against InvoiceMetadataV1 schema before
 * being pinned to IPFS. An SVG invoice preview is generated and uploaded as
 * the NFT image field.
 */
import type { InvoiceMetadata } from "@/types";
import { withRetry } from "@/lib/utils";
import { env } from "@/lib/env";
import {
  buildInvoiceMetadata,
  validateInvoiceMetadata,
  METADATA_VERSION,
  type InvoiceMetadataV1,
  type InvoiceMetadataV1Input,
} from "@/lib/invoiceMetadata";
import { generateInvoiceSvg, svgToFile, rasterizeSvgToThumbnail } from "@/lib/invoiceSvg";
import { createMockUploadToken } from "@/lib/security";
import { parseUploadRejection } from "@/lib/uploadScanResult";
import { MAX_INVOICE_PDF_BYTES } from "@/lib/validations/upload";
import { getCsrfToken } from "@/lib/csrfClient";

const IPFS_GATEWAY = env.NEXT_PUBLIC_IPFS_GATEWAY;

/**
 * Ordered list of IPFS gateway bases used for content resolution.
 *
 * The configured gateway is tried first; the public gateways act as
 * fallbacks so a single gateway outage never blocks content retrieval.
 * Each entry is a base that resolves a CID via `${base}/${cid}`.
 */
export const IPFS_GATEWAYS: string[] = Array.from(
  new Set(
    [
      IPFS_GATEWAY,
      "https://ipfs.io/ipfs",
      "https://cloudflare-ipfs.com/ipfs",
      "https://gateway.pinata.cloud/ipfs",
      "https://dweb.link/ipfs",
    ].filter((g): g is string => Boolean(g))
  )
);

// CID v0 (Qm...) or CID v1 base32 (bafy… dag-pb, bafk… raw, etc.)
const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{55,})$/;

// ─── Pinata Health Check ──────────────────────────────────────────────────────

const HEALTH_CACHE_TTL = 60_000; // 60 seconds
const HEALTH_TIMEOUT_MS = 3_000; // 3 seconds

interface HealthCacheEntry {
  healthy: boolean;
  checkedAt: number;
}

let _healthCache: HealthCacheEntry | null = null;

/**
 * Ping the Pinata health endpoint.
 * Result is cached for 60 s to avoid hammering Pinata.
 * Times out in < 3 s to avoid blocking the UI.
 *
 * @returns true  — Pinata is reachable and healthy
 * @returns false — Pinata is down, unreachable, or timed out
 */
export async function checkPinataHealth(): Promise<boolean> {
  const now = Date.now();
  if (_healthCache && now - _healthCache.checkedAt < HEALTH_CACHE_TTL) {
    return _healthCache.healthy;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const res = await fetch("https://api.pinata.cloud/data/testAuthentication", {
      method: "GET",
      signal: controller.signal,
      // No auth needed — this endpoint returns 401 even without a JWT,
      // but a reachable 401 means Pinata is up. Only network errors / timeouts
      // mean it's truly unavailable.
    });

    clearTimeout(timeoutId);

    // Any HTTP response (including 401 Unauthorized) means the service is reachable.
    const healthy = res.status < 500;
    _healthCache = { healthy, checkedAt: Date.now() };
    return healthy;
  } catch {
    // AbortError (timeout) or network error → treat as unhealthy
    _healthCache = { healthy: false, checkedAt: Date.now() };
    return false;
  }
}

/**
 * Invalidate the health cache (useful in tests or after a known outage).
 */
export function invalidatePinataHealthCache(): void {
  _healthCache = null;
}

export function isValidCID(cid: string): boolean {
  return CID_REGEX.test(cid);
}

export class InvalidCIDError extends Error {
  constructor(cid: string) {
    super(`Invalid IPFS CID: ${cid}`);
    this.name = "InvalidCIDError";
  }
}

export function validateCid(cid: string): void {
  if (!isValidCID(cid)) {
    throw new InvalidCIDError(cid);
  }
}

export const MAX_FILE_SIZE = MAX_INVOICE_PDF_BYTES;

export class FileSizeError extends Error {
  constructor(size: number) {
    super(`File size ${size} bytes exceeds the ${MAX_FILE_SIZE / (1024 * 1024)}MB limit.`);
    this.name = "FileSizeError";
  }
}

/** Thrown when a file is rejected by the VirusTotal scan. */
export class VirusScanRejectionError extends Error {
  public readonly reason: string;
  public readonly stats?: Record<string, number>;

  constructor(reason: string, stats?: Record<string, number>) {
    super(`File rejected by security scan: ${reason}`);
    this.name = "VirusScanRejectionError";
    this.reason = reason;
    this.stats = stats;
  }
}

/** Thrown for non-scan upload failures (network, server, etc). */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Thrown when an in-flight upload is cancelled via an `AbortSignal`
 * (wizard unmount, file replace, or explicit cancel). Callers must treat
 * this as "cancelled", not "failed": an aborted upload must never write
 * CID / progress state into the active draft.
 */
export class UploadAbortedError extends Error {
  constructor() {
    super("Upload aborted");
    this.name = "UploadAbortedError";
  }
}

/** True for abort-driven failures (vs genuine network/server failures). */
export function isUploadAborted(err: unknown): boolean {
  return (
    err instanceof UploadAbortedError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/**
 * Create a controller for one upload attempt. Hand its `signal` to the
 * upload helpers and call `abort()` on wizard unmount, file replace, or
 * explicit cancel. One controller per attempt — do not reuse after abort.
 */
export function createUploadAbortController(): AbortController {
  return new AbortController();
}

/** Upload a file via XHR so we get real progress events. */
function xhrUpload(
  url: string,
  form: FormData,
  onProgress?: (percent: number) => void,
  authToken?: string,
  signal?: AbortSignal
): Promise<{ IpfsHash: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    const token = authToken || createMockUploadToken();
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      try {
        xhr.abort();
      } finally {
        reject(new UploadAbortedError());
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      cleanup();
      if (signal?.aborted) {
        reject(new UploadAbortedError());
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = JSON.parse(xhr.responseText);
        const cid = parsed.cid || parsed.IpfsHash;
        resolve({ IpfsHash: cid });
      } else {
        // Parse error response to check if it's a virus scan rejection
        try {
          const errorBody = JSON.parse(xhr.responseText);
          const rejection = parseUploadRejection(errorBody);
          if (rejection.rejected) {
            // Scan rejection — throw with specific error type
            reject(new VirusScanRejectionError(rejection.reason, rejection.stats));
          } else {
            // Generic upload error
            reject(new UploadError(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
        } catch {
          // Failed to parse response, treat as generic error
          reject(new UploadError(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(
        signal?.aborted
          ? new UploadAbortedError()
          : new UploadError("Network error during IPFS upload")
      );
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadAbortedError());
    };
    void getCsrfToken().then((csrfToken) => {
      if (signal?.aborted) {
        cleanup();
        reject(new UploadAbortedError());
        return;
      }
      if (csrfToken) xhr.setRequestHeader("x-kora-csrf", csrfToken);
      xhr.send(form);
    }).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Upload an invoice PDF to IPFS via Pinata with progress tracking.
 * Returns the validated CID.
 *
 * Pass an `AbortSignal` (from `createUploadAbortController()`) to cancel:
 * the XHR is aborted and the promise rejects with `UploadAbortedError`
 * instead of resolving — aborted uploads must not write CID state.
 * `withRetry` only retries 5xx failures, so aborts are never retried.
 */
export async function uploadInvoicePDF(
  file: File,
  walletAddress: string,
  onProgress?: (percent: number) => void,
  authToken?: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new UploadAbortedError();
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new FileSizeError(file.size);
  }

  const form = new FormData();
  form.append("file", file);
  form.append("walletAddress", walletAddress || "GABC1234567890TESTADDRESS");

  const data = await withRetry(() => xhrUpload(`/api/upload`, form, onProgress, authToken, signal), 3);

  const cid = data.IpfsHash;
  validateCid(cid);
  return cid;
}

/**
 * Upload invoice metadata JSON to IPFS via Pinata.
 * Returns the validated CID.
 */
export async function uploadInvoiceMetadata(
  metadata: InvoiceMetadata,
  walletAddress: string,
  authToken?: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new UploadAbortedError();
  }
  const token = authToken || createMockUploadToken(walletAddress);
  const res = await withRetry(
    async () => {
      const csrfToken = await getCsrfToken();
      return fetch(`/api/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(csrfToken ? { "x-kora-csrf": csrfToken } : {}),
        },
        body: JSON.stringify({
          walletAddress: walletAddress || "GABC1234567890TESTADDRESS",
          metadata,
          name: `invoice-metadata-${metadata.invoiceNumber}`,
        }),
        signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Metadata upload failed: ${r.status}`);
        return r.json() as Promise<{ cid: string }>;
      });
    },
    3
  );

  validateCid(res.cid);
  return res.cid;
}

/**
 * Upload both PDF and metadata, returning both CIDs.
 */
export async function uploadInvoiceToIPFS(
  file: File,
  metadata: InvoiceMetadata,
  walletAddress: string,
  onProgress?: (percent: number) => void,
  authToken?: string,
  signal?: AbortSignal
): Promise<{ pdfCid: string; metadataCid: string }> {
  const pdfCid = await uploadInvoicePDF(file, walletAddress, onProgress, authToken, signal);
  const metadataCid = await uploadInvoiceMetadata({
    ...metadata,
    documentHash: pdfCid,
    documentUrl: ipfsUrl(pdfCid),
  }, walletAddress, authToken, signal);
  return { pdfCid, metadataCid };
}

/** Build a public IPFS gateway URL from a CID. */
export function ipfsUrl(cid: string): string {
  validateCid(cid);
  return `${IPFS_GATEWAY}/${cid}`;
}

// ─── Multi-Gateway Fallback + CID Integrity Verification (#393) ───────────────

/** Thrown when every gateway returned content that failed CID integrity checks. */
export class IpfsTamperError extends Error {
  constructor(cid: string) {
    super(
      `IPFS content for CID ${cid} failed integrity verification on all gateways. ` +
        `The content hash does not match the CID — it may have been tampered with.`
    );
    this.name = "IpfsTamperError";
  }
}

/** Thrown when no gateway could return the content (all unreachable / errored). */
export class IpfsUnavailableError extends Error {
  constructor(cid: string) {
    super(`Unable to fetch IPFS content for CID ${cid} from any configured gateway.`);
    this.name = "IpfsUnavailableError";
  }
}

/** Result of a per-CID content-hash verification against the CID itself. */
export type IpfsIntegrity =
  | "verified" // content hash provably matches the CID
  | "unverifiable" // CID uses a codec/hash we can't recompute client-side (no failure)
  | "skipped"; // verification was explicitly disabled

const MULTIHASH_SHA2_256 = 0x12;
const CODEC_RAW = 0x55;

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base58Decode(str: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = B58_ALPHABET.indexOf(ch);
    if (value === -1) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Preserve leading zero bytes (encoded as '1').
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function base32Decode(str: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.toLowerCase()) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Minimal unsigned LEB128 varint reader. Returns [value, nextOffset]. */
function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    const b = bytes[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

interface DecodedCid {
  version: 0 | 1;
  codec: number;
  hashCode: number;
  digest: Uint8Array;
}

/**
 * Decode a CID into its codec + multihash digest.
 * Supports base58btc CIDv0 (Qm...) and base32 CIDv1 (bafy...).
 * Returns null for anything we can't parse.
 */
export function decodeCid(cid: string): DecodedCid | null {
  try {
    if (cid.startsWith("Qm")) {
      const bytes = base58Decode(cid);
      if (!bytes || bytes.length < 2) return null;
      const [hashCode, p1] = readVarint(bytes, 0);
      const [len, p2] = readVarint(bytes, p1);
      const digest = bytes.slice(p2, p2 + len);
      if (digest.length !== len) return null;
      return { version: 0, codec: 0x70 /* dag-pb */, hashCode, digest };
    }
    // CIDv1 multibase: leading char is the base prefix. 'b' => base32.
    if (cid[0] === "b") {
      const bytes = base32Decode(cid.slice(1));
      if (!bytes || bytes.length < 4) return null;
      const [version, p0] = readVarint(bytes, 0);
      if (version !== 1) return null;
      const [codec, p1] = readVarint(bytes, p0);
      const [hashCode, p2] = readVarint(bytes, p1);
      const [len, p3] = readVarint(bytes, p2);
      const digest = bytes.slice(p3, p3 + len);
      if (digest.length !== len) return null;
      return { version: 1, codec, hashCode, digest };
    }
    return null;
  } catch {
    return null;
  }
}

async function sha256(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Copy into a fresh ArrayBuffer-backed view to satisfy the BufferSource type.
  const buf = view.slice();
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as BufferSource);
  return new Uint8Array(digest);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify that fetched content matches the digest embedded in its CID.
 *
 * Returns:
 *  - `true`  — content sha2-256 hash matches the CID digest
 *  - `false` — content does NOT match (possible tampering)
 *  - `null`  — the CID uses a codec/hash we cannot recompute from raw bytes
 *              (e.g. dag-pb wrapped blocks). This is NOT a failure — callers
 *              should treat it as "unverifiable" rather than "tampered".
 *
 * Only sha2-256 `raw` (0x55) CIDs can be verified from the raw content bytes,
 * which covers the small single-block JSON/SVG payloads Kora pins.
 */
export async function verifyCidIntegrity(
  cid: string,
  content: ArrayBuffer | Uint8Array
): Promise<boolean | null> {
  const decoded = decodeCid(cid);
  if (!decoded) return null;
  if (decoded.hashCode !== MULTIHASH_SHA2_256) return null;
  // dag-pb (0x70, and all CIDv0) hashes a wrapped block, not the raw bytes —
  // we cannot recompute it here without re-chunking, so treat as unverifiable.
  if (decoded.codec !== CODEC_RAW) return null;
  const computed = await sha256(content);
  return bytesEqual(computed, decoded.digest);
}

export interface IpfsFetchOptions {
  /** Per-gateway timeout in ms. Default 8000. */
  timeoutMs?: number;
  /** Retries per gateway before rotating to the next. Default 1. */
  retriesPerGateway?: number;
  /** Gateway bases to try, in order. Defaults to IPFS_GATEWAYS. */
  gateways?: string[];
  /** Skip CID integrity verification (e.g. mock mode). Default false. */
  skipIntegrity?: boolean;
}

export interface IpfsFetchResult {
  bytes: Uint8Array;
  text: string;
  /** Gateway base that successfully served the content. */
  gateway: string;
  /** Outcome of CID integrity verification for the returned content. */
  integrity: IpfsIntegrity;
}

async function fetchOnce(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch IPFS content with gateway rotation, per-gateway timeout/retry, and
 * CID integrity verification.
 *
 * Gateways are tried in order. A gateway that times out, errors, or returns a
 * non-2xx response is skipped. If a gateway returns content whose hash does not
 * match the CID, that gateway is skipped as tampered and the next is tried.
 *
 * @throws {InvalidCIDError}     if `cid` is not a valid CID
 * @throws {IpfsTamperError}     if every gateway that responded failed integrity
 * @throws {IpfsUnavailableError} if no gateway could return the content
 */
export async function fetchFromIpfsWithFallback(
  cid: string,
  options: IpfsFetchOptions = {}
): Promise<IpfsFetchResult> {
  validateCid(cid);
  const {
    timeoutMs = 8_000,
    retriesPerGateway = 1,
    gateways = IPFS_GATEWAYS,
    skipIntegrity = false,
  } = options;

  let sawTamper = false;

  for (const gateway of gateways) {
    for (let attempt = 0; attempt <= retriesPerGateway; attempt++) {
      try {
        const res = await fetchOnce(`${gateway}/${cid}`, timeoutMs);
        if (!res.ok) continue;

        const bytes = new Uint8Array(await res.arrayBuffer());

        let integrity: IpfsIntegrity = "skipped";
        if (!skipIntegrity) {
          const verified = await verifyCidIntegrity(cid, bytes);
          if (verified === false) {
            // Content was altered in transit or at this gateway — reject it.
            sawTamper = true;
            break; // stop retrying this gateway; rotate to the next
          }
          integrity = verified === true ? "verified" : "unverifiable";
        }

        return {
          bytes,
          text: new TextDecoder().decode(bytes),
          gateway,
          integrity,
        };
      } catch {
        // Timeout or network error — fall through to retry / next gateway.
      }
    }
  }

  if (sawTamper) throw new IpfsTamperError(cid);
  throw new IpfsUnavailableError(cid);
}

/**
 * Fetch and JSON-parse IPFS content with gateway fallback + integrity check.
 * Returns the parsed value plus the gateway used and the integrity outcome.
 */
export async function fetchIpfsJsonWithFallback<T = unknown>(
  cid: string,
  options: IpfsFetchOptions = {}
): Promise<{ data: T; gateway: string; integrity: IpfsIntegrity }> {
  const result = await fetchFromIpfsWithFallback(cid, options);
  return {
    data: JSON.parse(result.text) as T,
    gateway: result.gateway,
    integrity: result.integrity,
  };
}

// ─── Validated V1 Metadata Upload ────────────────────────────────────────────

/**
 * Upload a validated InvoiceMetadataV1 object to IPFS.
 *
 * This is the canonical upload path for invoice NFT metadata. It:
 *  1. Validates the metadata against the InvoiceMetadataV1 Zod schema
 *  2. Generates an SVG invoice preview and uploads it as the NFT image
 *  3. Injects the image CID into the metadata
 *  4. Uploads the final metadata JSON to IPFS
 *
 * @param input         - Invoice metadata input (without metadata_version)
 * @param walletAddress - Uploader's Stellar wallet address (for rate limiting)
 * @param onProgress    - Optional progress callback (0–100)
 * @returns Object containing the metadata CID, the full-size SVG image CID, and
 *          the rasterised marketplace thumbnail CID when one could be generated
 *          (`undefined` on the server or if rasterisation failed).
 * @throws {Error} if schema validation fails or any upload step fails
 */
export async function uploadValidatedInvoiceMetadata(
  input: InvoiceMetadataV1Input,
  walletAddress: string,
  onProgress?: (percent: number) => void
): Promise<{
  metadataCid: string;
  imageCid: string;
  thumbnailCid: string | undefined;
}> {
  // Step 1: Pre-validate input (without image — we'll add it after upload)
  const preCheck = validateInvoiceMetadata({
    metadata_version: METADATA_VERSION,
    ...input,
    // Provide a placeholder image for pre-validation; real value set below
    image: input.image ?? "ipfs://placeholder",
  });
  if (!preCheck.success) {
    throw new Error(
      `Invoice metadata validation failed:\n${preCheck.errors.join("\n")}`
    );
  }

  onProgress?.(5);

  // Step 2: Generate SVG invoice preview
  // Build a temporary metadata object for SVG generation
  const tempMeta = buildInvoiceMetadata({
    ...input,
    image: input.image ?? "ipfs://placeholder",
  });
  const svgString = generateInvoiceSvg(tempMeta);
  const svgFile = svgToFile(
    svgString,
    `invoice-preview-${input.invoice_number}.svg`
  );

  onProgress?.(15);

  // Step 3: Upload SVG to IPFS
  const imageCid = await uploadInvoicePDF(svgFile, walletAddress, (p) => {
    // Map SVG upload progress to 15–55% of total
    onProgress?.(15 + Math.round(p * 0.4));
  });

  onProgress?.(55);

  // Step 3b: Rasterise a marketplace thumbnail from the same SVG (Issue #438).
  //
  // The SVG stays pinned as the full-resolution asset, but the marketplace card
  // points at this PNG instead: SVG is opaque to next/image, so serving it to
  // the grid means no AVIF/WebP negotiation, no responsive resizing, and vector
  // text rasterised on the main thread for every visible card.
  //
  // Best-effort by design — rasterisation needs a canvas, so it is a no-op on
  // the server and can fail on a malformed SVG. Either way the upload proceeds
  // and `image` falls back to the SVG CID, which is exactly the old behaviour.
  let thumbnailCid: string | undefined;
  const thumbnailBlob = await rasterizeSvgToThumbnail(svgString);
  if (thumbnailBlob) {
    try {
      const thumbnailFile = new File(
        [thumbnailBlob],
        `invoice-thumbnail-${input.invoice_number}.png`,
        { type: "image/png" }
      );
      thumbnailCid = await uploadInvoicePDF(thumbnailFile, walletAddress);
    } catch {
      // Pinning the thumbnail is not worth failing a mint over.
      thumbnailCid = undefined;
    }
  }

  onProgress?.(58);

  // Step 4: Build final validated metadata with real image CID
  const finalMetadata = buildInvoiceMetadata({
    ...input,
    image: `ipfs://${thumbnailCid ?? imageCid}`,
  });

  onProgress?.(60);

  // Step 5: Upload metadata JSON to IPFS
  const token = createMockUploadToken(walletAddress);
  const metadataCid = await withRetry(
    async () => {
      const csrfToken = await getCsrfToken();
      return fetch(`/api/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(csrfToken ? { "x-kora-csrf": csrfToken } : {}),
        },
        body: JSON.stringify({
          walletAddress: walletAddress || "GABC1234567890TESTADDRESS",
          metadata: finalMetadata,
          name: `invoice-metadata-v${METADATA_VERSION}-${input.invoice_number}`,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Metadata upload failed: ${r.status}`);
        const json = (await r.json()) as { cid: string };
        return json.cid;
      });
    },
    3
  );

  validateCid(metadataCid);
  onProgress?.(100);

  return { metadataCid, imageCid, thumbnailCid };
}

/**
 * Unpin a file from Pinata (best-effort).
 * This is called during invoice cancellation to clean up IPFS-pinned files.
 * @param cid - Content ID to unpin
 * @returns true if successful, false if error (best-effort, no throw)
 */
export async function unpinFromPinata(cid: string): Promise<boolean> {
  try {
    validateCid(cid);
    const token = createMockUploadToken();
    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/upload`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(csrfToken ? { "x-kora-csrf": csrfToken } : {}),
      },
      body: JSON.stringify({ cid }),
    });
    return response.ok;
  } catch (err) {
    // Best-effort: log the error and continue
    console.warn(`Failed to unpin CID ${cid}:`, err);
    return false;
  }
}

/**
 * Unpin multiple files from Pinata (best-effort).
 * @param cids - Array of CIDs to unpin
 * @returns Promise that resolves when all unpin attempts are complete
 */
export async function unpinMultipleFromPinata(cids: string[]): Promise<void> {
  const results = await Promise.allSettled(cids.map(unpinFromPinata));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`Failed to unpin ${failed} out of ${cids.length} CIDs`);
  }
}

// ─── Legacy helpers (kept for backward compatibility) ─────────────────────────

export async function uploadFileToPinata(
  file: File,
  _name: string,
  walletAddress?: string,
  onProgress?: (percent: number) => void,
  authToken?: string,
  signal?: AbortSignal
): Promise<string> {
  // If walletAddress is provided, forward it; otherwise use empty string.
  return uploadInvoicePDF(file, walletAddress || "", onProgress, authToken, signal);
}

export async function uploadJsonToPinata(
  metadata: Record<string, unknown>,
  _name: string,
  walletAddress?: string,
  authToken?: string
): Promise<string> {
  const addr = walletAddress || "GABC1234567890TESTADDRESS";
  const token = authToken || createMockUploadToken(addr);
  const res = await withRetry(
    async () => {
      const csrfToken = await getCsrfToken();
      return fetch(`/api/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(csrfToken ? { "x-kora-csrf": csrfToken } : {}),
        },
        body: JSON.stringify({ walletAddress: addr, metadata, name: _name }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Metadata upload failed: ${r.status}`);
        return r.json() as Promise<{ cid: string }>;
      });
    },
    3
  );
  validateCid(res.cid);
  return res.cid;
}
