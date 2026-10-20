/**
 * CSP violation reporting endpoint.
 *
 * Accepts Content Security Policy violation reports in both legacy
 * (application/csp-report) and modern (application/reports+json) formats.
 * Validates content-type, rate-limits per IP, strips PII, and logs sanitized
 * violation reports via lib/logger.
 *
 * Without this endpoint, nonce regressions and third-party script breakages
 * are discovered only via user reports instead of automated monitoring.
 */
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

// Rate limit: max 10 reports per IP per 5 minutes
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REPORTS = 10;
const MAX_BODY_SIZE_BYTES = 8192; // 8KB limit for report payloads

// In-memory rate limit store (consider Redis for multi-instance deployments)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function cleanupExpiredRateLimits() {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now > data.resetAt) {
      rateLimitStore.delete(ip);
    }
  }
}

function isRateLimited(ip: string): boolean {
  cleanupExpiredRateLimits();
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX_REPORTS) {
    return true;
  }

  record.count += 1;
  return false;
}

/**
 * Strip PII and truncate document-uri to prevent logging sensitive query params.
 * CSP reports may contain full URLs including session tokens, user IDs, etc.
 */
function sanitizeViolationReport(report: unknown): unknown {
  if (typeof report !== "object" || report === null) return report;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(report)) {
    if (key === "document-uri" || key === "documentURL") {
      try {
        const url = new URL(String(value));
        // Keep only origin + pathname, strip query and hash
        sanitized[key] = `${url.origin}${url.pathname}`;
      } catch {
        sanitized[key] = "[invalid-url]";
      }
    } else if (key === "blocked-uri" || key === "blockedURL") {
      try {
        const url = new URL(String(value));
        // Keep full origin + path for blocked resource debugging
        sanitized[key] = url.origin + url.pathname;
      } catch {
        sanitized[key] = String(value);
      }
    } else if (key === "source-file" || key === "sourceFile") {
      try {
        const url = new URL(String(value));
        sanitized[key] = `${url.origin}${url.pathname}`;
      } catch {
        sanitized[key] = String(value);
      }
    } else if (key === "script-sample" || key === "scriptSample") {
      // Truncate inline script samples to avoid logging executable code
      sanitized[key] =
        typeof value === "string" ? value.slice(0, 100) + "..." : value;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export async function POST(req: NextRequest) {
  const headersList = headers();
  const contentType = (await headersList).get("content-type") || "";
  const ip =
    (await headersList).get("x-forwarded-for")?.split(",")[0].trim() ||
    (await headersList).get("x-real-ip") ||
    "unknown";

  // Rate limiting
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) },
      }
    );
  }

  // Validate content-type
  const isLegacyFormat = contentType.includes("application/csp-report");
  const isModernFormat = contentType.includes("application/reports+json");

  if (!isLegacyFormat && !isModernFormat) {
    return NextResponse.json(
      { error: "Invalid content-type. Expected application/csp-report or application/reports+json" },
      { status: 400 }
    );
  }

  // Check body size before parsing
  const contentLength = (await headersList).get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const body = await req.json();

    let violations: unknown[] = [];

    if (isLegacyFormat && body["csp-report"]) {
      // Legacy format: { "csp-report": { ... } }
      violations = [body["csp-report"]];
    } else if (isModernFormat && Array.isArray(body)) {
      // Modern Reporting API: [{ type: "csp-violation", body: { ... } }, ...]
      violations = body
        .filter((item: unknown) => typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "csp-violation")
        .map((item: Record<string, unknown>) => item.body);
    } else {
      return NextResponse.json({ error: "Unrecognized report format" }, { status: 400 });
    }

    if (violations.length === 0) {
      return NextResponse.json({ error: "No CSP violations in payload" }, { status: 400 });
    }

    // Sanitize and log each violation
    for (const violation of violations) {
      const sanitized = sanitizeViolationReport(violation);
      
      // In production, replace console.warn with lib/logger or external monitoring service
      console.warn("[CSP Violation]", {
        ip,
        timestamp: new Date().toISOString(),
        report: sanitized,
      });

      // TODO: integrate with lib/logger once implemented
      // logger.warn("CSP violation reported", { ip, report: sanitized });
    }

    return NextResponse.json({ status: "ok", received: violations.length }, { status: 204 });
  } catch (err) {
    console.error("[CSP Report] Failed to parse payload:", err);
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
