/**
 * Structured API Logger for Kora Protocol.
 * Outputs logs as JSON to console.log for ingestion/monitoring.
 */

import { getCsrfToken } from "@/lib/csrfClient";

export interface LogContext {
  requestId?: string | null;
  route?: string | null;
  [key: string]: unknown;
}

export interface ClientErrorReportContext extends LogContext {
  boundary?: string;
  digest?: string;
  componentStack?: string;
}

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|key|authorization|cookie|signature|passphrase|mnemonic|seed|jwt/i;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;
const STELLAR_PUBLIC_KEY_PATTERN = /\bG[A-Z2-7]{55}\b/g;

function redactString(value: string): string {
  return value
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(STELLAR_SECRET_PATTERN, "[REDACTED_SECRET_KEY]")
    .replace(STELLAR_PUBLIC_KEY_PATTERN, "[REDACTED_WALLET]");
}

/**
 * Recursively redacts sensitive fields and serializes Error objects.
 */
export function redact(obj: unknown): unknown {
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: redactString(obj.message),
      stack: obj.stack ? redactString(obj.stack) : undefined,
    };
  }

  if (obj === null || typeof obj !== "object") {
    return typeof obj === "string" ? redactString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const source = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redact(source[key]);
    }
  }
  return result;
}

class StructuredLogger {
  private isDevelopment(): boolean {
    return process.env.NODE_ENV === "development";
  }

  private log(level: "info" | "warn" | "error", message: string, context: LogContext = {}) {
    const { requestId, route, ...extra } = context;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: requestId || null,
      route: route || null,
      ...(redact(extra) as Record<string, unknown>),
    };

    if (this.isDevelopment()) {
      const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
      consoleMethod(`[${level.toUpperCase()}] ${message}`, logEntry);
      return;
    }

    console.log(JSON.stringify(logEntry));
  }

  info(message: string, context?: LogContext) {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log("warn", message, context);
  }

  error(message: string, context?: LogContext) {
    this.log("error", message, context);
  }

  async reportClientError(
    error: Error & { digest?: string },
    context: ClientErrorReportContext = {}
  ): Promise<void> {
    const sanitizedError = redact(error);
    const sanitizedContext = redact(context);

    this.error("[client-error]", {
      route: context.route ?? (typeof window !== "undefined" ? window.location.pathname : null),
      error,
      ...context,
    });

    if (typeof window === "undefined") return;

    try {
      const csrfToken = await getCsrfToken();

      await fetch("/api/vitals", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-kora-csrf": csrfToken } : {}),
        },
        body: JSON.stringify({
          metrics: [
            {
              name: "client_error",
              value: 1,
              id: error.digest ?? `client-error-${Date.now()}`,
              label: "error-boundary",
              startTime: Date.now(),
              rating: "poor",
              url: window.location.href,
              userAgent: navigator.userAgent,
              timestamp: Date.now(),
              error: sanitizedError,
              context: sanitizedContext,
            },
          ],
        }),
      });
    } catch (reportError) {
      this.warn("[client-error] failed to report", { error: reportError });
    }
  }
}

export const logger = new StructuredLogger();
