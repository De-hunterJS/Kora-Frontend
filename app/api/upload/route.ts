import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { verifyUploadToken } from "@/lib/security";
import { logger } from "@/lib/logger";
import { verifyCsrf } from "@/lib/csrf";
import { MAX_INVOICE_PDF_BYTES } from "@/lib/validations/upload";

const PINATA_BASE = "https://api.pinata.cloud";
const PINATA_JWT = process.env.PINATA_JWT ?? "";
const VIRUSTOTAL_API_KEY = process.env.VIRUSTOTAL_API_KEY ?? "";

// In-memory rate limit store: walletAddress -> timestamps (ms)
// Note: Suitable only for single-instance deployments. For multi-instance deployments,
// see docs/architecture.md#redis-migration-for-rate-limiting-and-shared-state.
const RATE_LIMIT_WINDOW = 1000 * 60 * 60; // 1 hour
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, number[]>();

// In-memory rate limit store: clientIP -> timestamps (ms)
// Note: This in-memory storage is suitable only for a single-instance deployment.
// In a multi-instance (autoscaled or serverless) environment, the rate limit state
// will not be shared across instances. For multi-instance, use a centralized store like Redis.
// See docs/architecture.md#redis-migration-for-rate-limiting-and-shared-state for key schemas,
// TTLs, sequence flow, and fallback behavior.
const IP_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const IP_RATE_LIMIT_MAX = 10;
const ipRateLimitMap = new Map<string, number[]>();

function resetIpRateLimit() {
  ipRateLimitMap.clear();
}

if (typeof global !== "undefined") {
  (global as any).__resetIpRateLimit = resetIpRateLimit;
}

function checkIpRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const timestamps = ipRateLimitMap.get(ip) || [];
  
  // Filter out expired timestamps
  const recent = timestamps.filter((t) => t > now - IP_RATE_LIMIT_WINDOW);
  
  if (recent.length >= IP_RATE_LIMIT_MAX) {
    const oldestTimestamp = recent[0];
    const timeRemainingMs = oldestTimestamp + IP_RATE_LIMIT_WINDOW - now;
    const retryAfter = Math.max(1, Math.ceil(timeRemainingMs / 1000));
    return { allowed: false, retryAfter };
  }
  
  recent.push(now);
  ipRateLimitMap.set(ip, recent);
  return { allowed: true };
}

type VirusScanResult =
  | { ok: true; note?: string }
  | { ok: false; error?: string; stats?: Record<string, number> };

type PinataResponse = {
  IpfsHash?: string;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  return isRecord(parsed) ? parsed : {};
}

function bufferToBlobPart(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

async function virusScan(buffer: Buffer, filename: string): Promise<VirusScanResult> {
  if (!VIRUSTOTAL_API_KEY) return { ok: true };

  try {
    const form = new FormData();
    form.append("file", new Blob([bufferToBlobPart(buffer)]), filename);
    form.append("file", new Blob([buffer as unknown as ArrayBuffer]), filename);

    const uploadRes = await fetch("https://www.virustotal.com/api/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${VIRUSTOTAL_API_KEY}` },
      body: form,
    });

    if (!uploadRes.ok) return { ok: false, error: `VirusTotal upload failed: ${uploadRes.status}` };
    const uploadJson = await readJsonRecord(uploadRes);
    const data = isRecord(uploadJson.data) ? uploadJson.data : {};
    const analysisId = getString(data.id);
    if (!analysisId) return { ok: false, error: "VirusTotal returned no analysis id" };

    // Poll analysis result (short timeout)
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const analysisRes = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
        headers: { Authorization: `Bearer ${VIRUSTOTAL_API_KEY}` },
      });
      if (!analysisRes.ok) break;
      const analysisJson = await readJsonRecord(analysisRes);
      const analysisData = isRecord(analysisJson.data) ? analysisJson.data : {};
      const attributes = isRecord(analysisData.attributes) ? analysisData.attributes : {};
      const status = getString(attributes.status);
      if (status === "completed") {
        const rawStats = isRecord(attributes.stats) ? attributes.stats : {};
        const stats = Object.fromEntries(
          Object.entries(rawStats).map(([key, value]) => [key, getNumber(value)])
        );
        const malicious = stats.malicious ?? 0;
        const suspicious = stats.suspicious ?? 0;
        const totalThreats = malicious + suspicious;
        return { ok: totalThreats === 0, stats };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: true, note: "Virus scan timed out — treated as clean" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function checkRateLimit(wallet: string) {
  const now = Date.now();
  const arr = rateLimitMap.get(wallet) || [];
  const recent = arr.filter((t) => t > now - RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimitMap.set(wallet, recent);
  return true;
}

export async function POST(req: NextRequest) {
  const requestId = (req as Request & { headers: Headers }).headers.get("x-request-id") ?? crypto.randomUUID();

  const csrfError = verifyCsrf(req);
  if (csrfError) return csrfError;

  // 1. IP rate limiting (10 req/min)
  const forwardedFor = req.headers.get("x-forwarded-for");
  const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
  const limitResult = checkIpRateLimit(clientIp);
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", requestId },
      {
        status: 429,
        headers: {
          "Retry-After": String(limitResult.retryAfter ?? 60),
        },
      }
    );
  }
  try {
    if (!PINATA_JWT) {
      return NextResponse.json({ error: "Pinata JWT not configured", requestId }, { status: 500 });
    }

    // ── Verify upload signing token (Issue #275) ──────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearerToken) {
      return NextResponse.json({ error: "Unauthorized: missing token", requestId }, { status: 401 });
    }
    const authResult = verifyUploadToken(bearerToken);
    if (!authResult.ok) {
      return NextResponse.json({ error: `Unauthorized: ${authResult.error}`, requestId }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") || "";

    // Handle multipart file upload
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      const wallet = form.get("walletAddress")?.toString();

      if (!file) return NextResponse.json({ error: "file is required", requestId }, { status: 400 });
      if (!wallet) return NextResponse.json({ error: "walletAddress is required", requestId }, { status: 400 });

      // Rate limit per wallet
      if (!checkRateLimit(wallet)) {
        return NextResponse.json({ error: "Rate limit exceeded", requestId }, { status: 429 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Size check
      if (buffer.length > MAX_INVOICE_PDF_BYTES) return NextResponse.json({ error: "File too large", requestId }, { status: 400 });

      // Magic byte validation for PDF: %PDF-
      const magic = buffer.slice(0, 5).toString("utf8");
      if (magic !== "%PDF-") return NextResponse.json({ error: "Invalid PDF file", requestId }, { status: 400 });

      // Virus scan (optional)
      const filename = file.name || "upload.pdf";
      const scan = await virusScan(buffer, filename);
      if (!scan.ok) return NextResponse.json({ error: `Virus scan failed: ${scan.error || JSON.stringify(scan.stats)}`, requestId }, { status: 400 });

      // Forward to Pinata
      const forwardForm = new FormData();
      forwardForm.append("file", new Blob([bufferToBlobPart(buffer)]), filename);
      forwardForm.append("pinataMetadata", JSON.stringify({ name: filename }));

      const pinRes = await fetch(`${PINATA_BASE}/pinning/pinFileToIPFS`, {
        method: "POST",
        headers: { Authorization: `Bearer ${PINATA_JWT}` },
        body: forwardForm,
      });

      const pinJson = (await readJsonRecord(pinRes)) as PinataResponse;
      if (!pinRes.ok) {
        return NextResponse.json({ error: `Pinata error: ${pinJson?.error || pinRes.status}`, requestId }, { status: 502 });
      }

      logger.info("[pinata-proxy] upload", { requestId, route: "/api/upload", wallet, cid: pinJson.IpfsHash });
      return NextResponse.json({ cid: pinJson.IpfsHash });
    }

    // Handle JSON metadata upload
    if (contentType.includes("application/json")) {
      const body = await readJsonRecord(new Response(JSON.stringify(await req.json())));
      const wallet = getString(body.walletAddress);
      const metadata = body.metadata;
      const name = getString(body.name) || "metadata";

      if (!wallet || !metadata) return NextResponse.json({ error: "walletAddress and metadata are required", requestId }, { status: 400 });

      if (!checkRateLimit(wallet)) {
        return NextResponse.json({ error: "Rate limit exceeded", requestId }, { status: 429 });
      }

      // Optional: could run lightweight metadata checks here

      const pinRes = await fetch(`${PINATA_BASE}/pinning/pinJSONToIPFS`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${PINATA_JWT}`,
        },
        body: JSON.stringify({ pinataMetadata: { name }, pinataContent: metadata }),
      });

      const pinJson = (await readJsonRecord(pinRes)) as PinataResponse;
      if (!pinRes.ok) return NextResponse.json({ error: `Pinata error: ${pinJson?.error || pinRes.status}`, requestId }, { status: 502 });

      logger.info("[pinata-proxy] json", { requestId, route: "/api/upload", wallet, cid: pinJson.IpfsHash });
      return NextResponse.json({ cid: pinJson.IpfsHash });
    }

    return NextResponse.json({ error: "Unsupported content type", requestId }, { status: 415 });
  } catch (err) {
    logger.error("[pinata-proxy] error", { requestId, route: "/api/upload", error: err });
    return NextResponse.json({ error: "Server error", requestId }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const requestId = (req as Request & { headers: Headers }).headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearerToken) {
      return NextResponse.json({ error: "Unauthorized: missing token", requestId }, { status: 401 });
    }
    const authResult = verifyUploadToken(bearerToken);
    if (!authResult.ok) {
      return NextResponse.json({ error: `Unauthorized: ${authResult.error}`, requestId }, { status: 401 });
    }

    const { cid } = await req.json();
    if (!cid) {
      return NextResponse.json({ error: "cid is required", requestId }, { status: 400 });
    }

    if (PINATA_JWT) {
      await fetch(`${PINATA_BASE}/pinning/unpin/${cid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${PINATA_JWT}` },
      });
    }

    return NextResponse.json({ ok: true, cid });
  } catch (err) {
    logger.error("[pinata-proxy] unpin error", { requestId, route: "/api/upload", error: err });
    return NextResponse.json({ error: "Server error", requestId }, { status: 500 });
  }
}
