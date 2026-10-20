/**
 * Unit tests for CSP violation reporting endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";

// Mock headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (key: string) => {
        const mockHeaders: Record<string, string> = {
          "content-type": "application/csp-report",
          "x-forwarded-for": "192.168.1.1",
          "content-length": "500",
        };
        return mockHeaders[key] || null;
      },
    })
  ),
}));

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts legacy CSP report format (application/csp-report)", async () => {
    const payload = {
      "csp-report": {
        "document-uri": "https://kora.finance/dashboard?token=secret",
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.com/malicious.js",
        "source-file": "https://kora.finance/app.js",
        "line-number": 42,
        "column-number": 10,
      },
    };

    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify(payload),
    });

    const response = await POST(req);

    expect(response.status).toBe(204);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.received).toBe(1);
  });

  it("accepts modern Reporting API format (application/reports+json)", async () => {
    const payload = [
      {
        type: "csp-violation",
        age: 1234,
        url: "https://kora.finance/marketplace",
        body: {
          documentURL: "https://kora.finance/marketplace",
          violatedDirective: "script-src-elem",
          effectiveDirective: "script-src-elem",
          blockedURL: "https://untrusted.com/script.js",
          statusCode: 200,
        },
      },
    ];

    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/reports+json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(req);

    expect(response.status).toBe(204);
    const body = await response.json();
    expect(body.received).toBe(1);
  });

  it("rejects invalid content-type", async () => {
    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid content-type");
  });

  it("rejects oversized payloads (>8KB)", async () => {
    const headers = await import("next/headers");
    vi.mocked(headers.headers).mockResolvedValueOnce({
      get: (key: string) => {
        if (key === "content-length") return "10000"; // 10KB
        if (key === "content-type") return "application/csp-report";
        if (key === "x-forwarded-for") return "192.168.1.2";
        return null;
      },
    } as never);

    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "content-length": "10000",
      },
      body: JSON.stringify({ "csp-report": {} }),
    });

    const response = await POST(req);

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toBe("Payload too large");
  });

  it("sanitizes document-uri to strip query params and PII", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const payload = {
      "csp-report": {
        "document-uri": "https://kora.finance/dashboard?token=secret&userId=123",
        "violated-directive": "script-src",
        "blocked-uri": "inline",
      },
    };

    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify(payload),
    });

    await POST(req);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[CSP Violation]",
      expect.objectContaining({
        report: expect.objectContaining({
          "document-uri": "https://kora.finance/dashboard",
        }),
      })
    );

    consoleWarnSpy.mockRestore();
  });

  it("truncates script-sample to 100 chars to prevent logging executable code", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const longScript = "a".repeat(200);
    const payload = {
      "csp-report": {
        "document-uri": "https://kora.finance/",
        "violated-directive": "script-src",
        "script-sample": longScript,
      },
    };

    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify(payload),
    });

    await POST(req);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[CSP Violation]",
      expect.objectContaining({
        report: expect.objectContaining({
          "script-sample": "a".repeat(100) + "...",
        }),
      })
    );

    consoleWarnSpy.mockRestore();
  });

  it("handles multiple violations in Reporting API payload", async () => {
    const payload = [
      {
        type: "csp-violation",
        body: {
          documentURL: "https://kora.finance/page1",
          violatedDirective: "script-src",
        },
      },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://kora.finance/page2",
          violatedDirective: "img-src",
        },
      },
    ];

    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/reports+json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(req);

    expect(response.status).toBe(204);
    const body = await response.json();
    expect(body.received).toBe(2);
  });

  it("rejects malformed JSON", async () => {
    const req = new NextRequest("https://kora.finance/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "not valid json {",
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid JSON payload");
  });
});
