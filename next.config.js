/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",

  // ── Cache rules ────────────────────────────────────────────────────────────
  // Security: never cache wallet, transaction, or auth pages/APIs.
  // These pages handle signing keys and sensitive tx state — must always be
  // fetched fresh from the network.
  buildExcludes: [/middleware-manifest\.json$/],

  runtimeCaching: [
    // 0. Sensitive wallet, dashboard, transaction, and auth routes — NetworkOnly (never cache)
    {
      urlPattern: /^\/(?:dashboard|transactions|invoice\/create|api).*/i,
      handler: "NetworkOnly",
    },
    // 1. Google Fonts stylesheet — stale-while-revalidate
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "google-fonts-stylesheets-v1",
        expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
    // 2. Google Fonts files — cache-first (immutable)
    {
      urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts-webfonts-v1",
        expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // 3. Next.js static assets (_next/static) — cache-first (content-hashed)
    {
      urlPattern: /^\/_next\/static\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static-assets-v1",
        expiration: { maxEntries: 200, maxAgeSeconds: 365 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // 4. Next.js image optimization — stale-while-revalidate
    {
      urlPattern: /^\/_next\/image\?.*/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "next-image-cache-v1",
        expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // 5. Public static files (wallets, icons, fonts, og-image) — cache-first
    {
      urlPattern: /^\/(?:icons|wallets|fonts|og-image\.png|favicon\.ico).*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "static-public-v1",
        expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // 5b. PWA manifest — now a locale-aware route (#988), so cache-first would
    // pin the first locale's shortcuts for 30 days. Revalidate on every use and
    // keep a short-lived cache so an offline install still resolves.
    {
      urlPattern: /^\/manifest\.json$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "pwa-manifest-v1",
        expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    // 6. Marketplace page + detail pages — stale-while-revalidate (safe to serve cached).
    // /marketplace and /marketplace/[id] are read-only views; no sensitive data.
    // Wallet/signing routes are excluded by rule 0 above and never reach this rule.
    {
      urlPattern: /^\/marketplace(\/[^/]+)?(\?.*)?$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "marketplace-page",
        expiration: { maxEntries: 32, maxAgeSeconds: 5 * 60 },
      },
    },
    // 7. Home page — stale-while-revalidate
    {
      urlPattern: /^\/$/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "home-page",
        expiration: { maxEntries: 2, maxAgeSeconds: 5 * 60 },
      },
    },
    // 8. IPFS gateway images — stale-while-revalidate
    {
      urlPattern:
        /^https:\/\/(?:gateway\.pinata\.cloud|ipfs\.io|cloudflare-ipfs\.com|dweb\.link|[a-z0-9]+\.ipfs\.dweb\.link)\/.*/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "ipfs-assets",
        expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],

  // Offline fallback — shown when a navigation request fails and no cache hit
  fallbacks: {
    document: "/offline",
  },

  // Security boundary: exclude wallet, dashboard, signing, and API routes from SW fallback intercept
  // so they return a true browser network error instead of a stale cached page/shell offline.
  workboxOptions: {
    navigateFallbackDenylist: [
      /^\/(?:dashboard|transactions|invoice\/create|api).*/i,
    ],
  },
});

// ─── Content Security Policy ──────────────────────────────────────────────────
// script-src is nonce-based in production (see middleware.ts, which injects a
// per-request 'nonce-<value>' and overrides this header). 'unsafe-inline' is
// kept only as a dev-mode fallback since Next.js dev tooling relies on it.
const scriptSrc = ["'self'"];
if (process.env.NODE_ENV === "development") {
  scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
}

const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": scriptSrc,
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://ipfs.io",
    "https://gateway.pinata.cloud",
    "https://cloudflare-ipfs.com",
    "https://dweb.link",
    "https://nftstorage.link",
    "https://*.ipfs.dweb.link",
    // Wallet provider icons
    "https://assets.freighter.app",
    "https://xbull.app",
    "https://lobstr.co",
    "https://albedo.link",
  ],
  "font-src": ["'self'"],
  "connect-src": [
    "'self'",
    "https://soroban-testnet.stellar.org",
    "https://horizon-testnet.stellar.org",
    // Mainnet RPC/Horizon — previously missing, which broke connect-src for
    // any mainnet-configured deployment.
    "https://soroban-rpc.mainnet.stellar.org",
    "https://horizon.stellar.org",
    "https://api.pinata.cloud",
    "https://gateway.pinata.cloud",
    "https://ipfs.io",
    "https://cloudflare-ipfs.com",
    "https://dweb.link",
    "https://*.ipfs.dweb.link",
    "wss:",
  ],
  "frame-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  // Service worker requires 'self'; blob: for wallet kit internals
  "worker-src": ["'self'", "blob:"],
  // CSP violation reporting — allows monitoring nonce regressions and third-party breakages
  "report-uri": ["/api/csp-report"],
};

function buildCspHeader() {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: buildCspHeader() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@stellar/stellar-sdk"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
      // Sensitive wallet & transaction routes — no-store (security)
      {
        source: "/:path(dashboard|transactions|invoice/create|api)/:rest*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
      {
        source: "/:path(dashboard|transactions|invoice/create|api)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
      // Static assets: long-lived cache (content-hashed by Next.js)
      {
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Service worker must be served without caching headers so browsers
      // always check for updates.
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
      {
        source: "/workbox-:hash.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      // OG image and public icons — moderate cache
      {
        source: "/og-image.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/icons/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
    ];
  },

  images: {
    // Serve modern formats — Next.js negotiates AVIF → WebP → original
    formats: ["image/avif", "image/webp"],

    // Standard responsive breakpoints
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],

    // Minimum cache TTL for optimised images (7 days)
    minimumCacheTTL: 604800,

    remotePatterns: [
      // The gateway this deployment actually uses. Derived from
      // NEXT_PUBLIC_IPFS_GATEWAY so a self-hosted or paid gateway still gets
      // optimised instead of failing next/image's allowlist at runtime; the
      // literal entries below stay as fallbacks for the public gateways that
      // lib/ipfs.ts rotates through. Spread-and-filter so a malformed or
      // missing env var degrades to the static list rather than throwing at
      // build time.
      ...(() => {
        try {
          const { hostname } = new URL(
            process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs",
          );
          return [{ protocol: "https", hostname }];
        } catch {
          return [];
        }
      })(),

      // IPFS gateways (invoice document thumbnails / metadata images)
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "cloudflare-ipfs.com" },
      { protocol: "https", hostname: "dweb.link" },
      { protocol: "https", hostname: "nftstorage.link" },
      { protocol: "https", hostname: "*.ipfs.dweb.link" },

      // Wallet provider icon CDNs
      { protocol: "https", hostname: "assets.freighter.app" },
      { protocol: "https", hostname: "xbull.app" },
      { protocol: "https", hostname: "lobstr.co" },
      { protocol: "https", hostname: "albedo.link" },
    ],
  },

  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "./"),
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

module.exports = withBundleAnalyzer(withNextIntl(withPWA(nextConfig)));
