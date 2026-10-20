/**
 * Unit tests for robots.txt generation.
 */
import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /robots.txt", () => {
  it("returns robots.txt with correct content-type and cache headers", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, s-maxage=86400");
  });

  it("disallows API routes", async () => {
    const response = await GET();
    const body = await response.text();

    expect(body).toContain("Disallow: /api/");
  });

  it("disallows authenticated dashboard routes", async () => {
    const response = await GET();
    const body = await response.text();

    expect(body).toContain("Disallow: /dashboard/");
    expect(body).toContain("Disallow: /transactions");
    expect(body).toContain("Disallow: /invoice/create");
    expect(body).toContain("Disallow: /analytics");
    expect(body).toContain("Disallow: /settings");
  });

  it("disallows secondary market routes", async () => {
    const response = await GET();
    const body = await response.text();

    expect(body).toContain("Disallow: /secondary/");
  });

  it("explicitly allows public marketplace routes", async () => {
    const response = await GET();
    const body = await response.text();

    expect(body).toContain("Allow: /marketplace");
  });

  it("includes sitemap URL reference", async () => {
    const response = await GET();
    const body = await response.text();

    expect(body).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  });

  it("uses NEXT_PUBLIC_APP_URL when available", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://test.kora.finance";

    const response = await GET();
    const body = await response.text();

    expect(body).toContain("Sitemap: https://test.kora.finance/sitemap.xml");

    // Restore original
    if (originalUrl) {
      process.env.NEXT_PUBLIC_APP_URL = originalUrl;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  it("falls back to default domain when NEXT_PUBLIC_APP_URL is unset", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    const response = await GET();
    const body = await response.text();

    expect(body).toContain("Sitemap: https://kora.finance/sitemap.xml");

    // Restore original
    if (originalUrl) {
      process.env.NEXT_PUBLIC_APP_URL = originalUrl;
    }
  });

  it("documents rationale in comment about meta robots tags", async () => {
    // This test verifies the file contains explanatory comments (read source directly)
    const fs = await import("fs");
    const path = await import("path");
    const fileContent = fs.readFileSync(
      path.join(process.cwd(), "app/robots.txt/route.ts"),
      "utf-8"
    );

    expect(fileContent).toContain("Meta robots tags");
    expect(fileContent).toContain("not reliably honored");
  });
});
