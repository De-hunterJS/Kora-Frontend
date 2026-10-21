import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, redact } from "../logger";

describe("Structured Logger", () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should output valid JSON with required fields", () => {
    logger.info("Test message", { requestId: "req-123", route: "/api/test" });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logString = consoleSpy.mock.calls[0][0];
    const logObj = JSON.parse(logString);

    expect(logObj).toHaveProperty("timestamp");
    expect(logObj.level).toBe("info");
    expect(logObj.message).toBe("Test message");
    expect(logObj.requestId).toBe("req-123");
    expect(logObj.route).toBe("/api/test");
  });

  it("should redact sensitive fields", () => {
    logger.warn("Warning sensitive", {
      requestId: "req-456",
      route: "/api/secure",
      password: "my-secret-password",
      apiToken: "super-secret-token",
      authorization: "Bearer key123",
      nested: {
        cookie: "session=xyz",
        safeField: "safe-value",
      },
    });

    const logObj = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logObj.password).toBe("[REDACTED]");
    expect(logObj.apiToken).toBe("[REDACTED]");
    expect(logObj.authorization).toBe("[REDACTED]");
    expect(logObj.nested.cookie).toBe("[REDACTED]");
    expect(logObj.nested.safeField).toBe("safe-value");
  });

  it("should serialize Error objects", () => {
    const testError = new Error("Something went wrong");
    logger.error("Error occurred", {
      requestId: "req-789",
      route: "/api/error",
      error: testError,
    });

    const logObj = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logObj.error).toHaveProperty("name", "Error");
    expect(logObj.error).toHaveProperty("message", "Something went wrong");
    expect(logObj.error).toHaveProperty("stack");
  });

  it("should redact Stellar wallet addresses, private keys, and JWTs in strings", () => {
    const publicKey = "G".padEnd(56, "A");
    const secretKey = "S".padEnd(56, "B");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";

    expect(redact({ wallet: publicKey })).toEqual({ wallet: "[REDACTED_WALLET]" });
    expect(redact({ message: `secret ${secretKey}` })).toEqual({
      message: "secret [REDACTED_SECRET_KEY]",
    });
    expect(redact({ header: `Bearer ${jwt}` })).toEqual({
      header: "Bearer [REDACTED_JWT]",
    });
  });

  it("accepts unknown values and passes non-object primitives through", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact([{ token: "abc" }, "plain"])).toEqual([{ token: "[REDACTED]" }, "plain"]);
  });

  it("reports client errors to vitals with a csrf token and sanitized payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ token: "csrf-token" }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { href: "https://kora.test/dashboard", pathname: "/dashboard" } });
    vi.stubGlobal("navigator", { userAgent: "vitest" });

    await logger.reportClientError(new Error(`Failed for ${"G".padEnd(56, "A")}`), {
      boundary: "TestBoundary",
      jwt: "do-not-send",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/csrf", {
      method: "GET",
      credentials: "same-origin",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/vitals",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "x-kora-csrf": "csrf-token" }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.metrics[0].name).toBe("client_error");
    expect(body.metrics[0].error.message).toContain("[REDACTED_WALLET]");
    expect(body.metrics[0].context.jwt).toBe("[REDACTED]");

    vi.unstubAllGlobals();
  });
});
