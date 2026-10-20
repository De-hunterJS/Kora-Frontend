/**
 * robots.txt — Issue #305
 *
 * Allows all crawlers to index public pages while blocking /api/ and
 * wallet-gated routes from search engines. Meta robots tags (layout.tsx) are
 * not reliably honored by all crawlers, so path-level Disallow entries reduce
 * accidental indexing of app shells and query-heavy URLs.
 *
 * Keep this list synchronized with sitemap.xml exclusions (app/sitemap.xml/route.ts #1001).
 */
export function GET() {
  const body = `# Kora Protocol — robots.txt
User-agent: *
Allow: /

# API routes (never public)
Disallow: /api/

# Wallet-gated authenticated surfaces
Disallow: /dashboard/
Disallow: /transactions
Disallow: /invoice/create
Disallow: /analytics
Disallow: /settings

# Secondary market (authenticated user positions)
Disallow: /secondary/

# Allow public marketplace and marketing pages
Allow: /marketplace

Sitemap: ${process.env.NEXT_PUBLIC_APP_URL || "https://kora.finance"}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

