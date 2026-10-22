# Security Policy

Thank you for helping keep Kora-Frontend secure. This document explains how to report security issues and our approach to handling them.

## Reporting a Vulnerability

- Preferred: Open a private GitHub security advisory or email the maintainers at security@openledger.foundation (replace with the real address).
- If sensitive data is involved, do not create a public issue or PR.

Provide:

- Affected components and versions.
- Steps to reproduce (minimal repro preferred).
- Impact assessment and suggested mitigation.

## Supported Versions

We support the `main` branch and the latest released tag. If you're unsure whether a version is supported, contact us.

## Our Process

1. Acknowledge receipt within 3 business days.
2. Triage and reproduce the issue.
3. Coordinate fix and disclosure timeline with the reporter.
4. Release a fix and public advisory if appropriate.

## Safe Harbor

We welcome good-faith security research. Please avoid privacy violations, data destruction, and denial-of-service testing without prior consent.

## Auth Challenge Nonce Store (#1019)

`POST /api/auth/challenge` issues a one-time nonce that the wallet signs to prove key ownership. The nonce is stored in an in-memory `Map` inside `app/api/auth/challenge/store.ts`.

### Limits and eviction policy

| Property | Value | Rationale |
|----------|-------|-----------|
| `NONCE_TTL_MS` | 10 minutes | Long enough for a user to read and sign; short enough to limit the replay window. |
| `MAX_NONCES` | 500 | Prevents unbounded heap growth under a serverless flood. |
| Eviction strategy | TTL first, then oldest-first | Stale entries are always removed before the size cap is enforced. |

**TTL eviction** — `evictStaleNonces()` is called automatically at the start of every `generateNonceChallenge()` invocation.  No background timer is needed.

**Size cap** — After TTL eviction, if the store still holds ≥ `MAX_NONCES` entries, the oldest nonces (insertion order) are removed until the count is below the cap.  Under a flood, older challenges are invalidated rather than new ones being rejected.

**Single-use** — `consumeNonce(nonce)` marks a nonce as `used: true` on the first successful call.  Any subsequent call with the same nonce returns `false`, preventing replay attacks.

**Expired consumption** — If a nonce passes its TTL between generation and consumption, `consumeNonce` returns `false` and removes the entry.

### Clock skew

`Date.now()` is used on the server.  Sub-second drift between edge instances is acceptable — a nonce that expires a few milliseconds early is safely regenerated.  In a multi-instance deployment, nonces are **not shared** across instances; clients must verify against the same instance that issued the challenge, or a Redis-backed store variant must be used (see `docs/architecture.md`).

### Implementation

| File | Role |
|------|------|
| `app/api/auth/challenge/store.ts` | In-memory nonce map, TTL, size cap, single-use logic |
| `app/api/auth/challenge/route.ts` | `POST` handler — CSRF-guarded, calls `generateNonceChallenge()` |
| `app/api/auth/challenge/__tests__/store.test.ts` | Unit tests: TTL, single-use, flood, eviction |
| `app/api/auth/challenge/__tests__/route.test.ts` | Route-level integration tests |

---

## CSRF Protection

All mutating API routes (`POST /api/auth/challenge`, `POST /api/auth/verify`, `POST /api/feedback`) are protected against Cross-Site Request Forgery using the **double-submit cookie** pattern.

### How it works

1. **Token issuance** — On page load (or session change), the client calls `GET /api/auth/csrf`. The server:
   - Generates a cryptographically random token via `crypto.randomUUID()`.
   - Sets it as a `__kora_csrf` cookie with `HttpOnly; SameSite=Strict; Secure` flags.
   - Returns the same token in the JSON body.

2. **Token attachment** — The client reads the token from the response body and attaches it as the `x-kora-csrf` request header on every mutating request.

3. **Token verification** — `verifyCsrf(request)` in `lib/csrf.ts` reads both the `__kora_csrf` cookie and the `x-kora-csrf` header. If either is absent or they do not match, the route returns `403 Forbidden`.

### Why this is secure

Cross-origin requests cannot read `HttpOnly` cookies, so an attacker cannot forge the correct header value even though the browser automatically sends the cookie. The header can only be set by JavaScript running on the same origin.

### Token rotation

Calling `GET /api/auth/csrf` again issues a new token and overwrites the previous cookie, invalidating prior tokens. Rotation should happen on authentication state changes (sign-in / sign-out).

### Implementation

| File | Role |
|------|------|
| `app/api/auth/csrf/route.ts` | Issues the token and sets the cookie |
| `lib/csrf.ts` | `verifyCsrf()` and `issueCsrfToken()` helpers |
| `app/api/auth/challenge/route.ts` | Protected — calls `verifyCsrf()` |
| `app/api/auth/verify/route.ts` | Protected — calls `verifyCsrf()` |
| `app/api/feedback/route.ts` | Protected — calls `verifyCsrf()` |

## Security Best Practices for Contributors

- Never commit secrets or credentials. Use environment variables and secret stores.
- Keep dependencies up to date; run `npm audit` and address high/critical issues.
- Validate and sanitize all inputs, especially when interacting with contract builders and IPFS uploads.
- Call `GET /api/auth/csrf` before any form submission that targets a protected route and attach the returned token as the `x-kora-csrf` header.

## Dependency Vulnerability Scanning

We run automated dependency vulnerability scanning in CI using `npm audit --audit-level=high`. The build will fail if any unexcepted high or critical severity vulnerabilities are detected.

### Handling Vulnerability Reports & False Positives

If a vulnerability is identified as a false positive, does not affect Kora-Frontend due to our specific usage, or is a development-only threat, it can be bypassed by adding an entry to [audit-exceptions.json](file:///workspaces/Kora-Frontend/audit-exceptions.json).

Each exception must include:
- `advisoryId`: The security advisory ID.
- `package`: The name of the package.
- `url`: The link to the GitHub Advisory or vulnerability report.
- `reason`: A detailed justification explaining why this vulnerability is not exploitable or applicable in our project.

The CI environment executes `scripts/audit.js` to enforce these checks.

## Contact

Create a private GitHub Security Advisory or email security@openledger.foundation.

## CSP Violation Monitoring

Content Security Policy (CSP) violations are automatically reported to `/api/csp-report`, which logs sanitized violation details including:

- `document-uri` (stripped of query params to remove PII)
- `violated-directive` (e.g., `script-src`, `img-src`)
- `blocked-uri` (the resource that was blocked)
- `source-file`, `line-number`, `column-number` (when available)

### Monitoring Expectations

**Production deployments should:**

1. **Monitor CSP report logs** — violations indicate nonce regressions, third-party script breakages, or potential XSS attempts.
2. **Rate limit enforcement** — the endpoint limits reports to 10 per IP per 5 minutes to prevent abuse.
3. **PII sanitization** — all `document-uri` fields are stripped of query parameters and fragments before logging. Script samples are truncated to 100 characters.
4. **Do not execute reported scripts** — the endpoint never evaluates `script-sample` or `blocked-uri` content to prevent reflected XSS through the reporting mechanism itself.

### Report Formats Supported

- **Legacy format** (`application/csp-report`): `{ "csp-report": { ... } }`
- **Modern Reporting API** (`application/reports+json`): `[{ type: "csp-violation", body: { ... } }]`

### Integration with External Monitoring

For production-grade alerting, integrate the CSP report endpoint with:

- **Sentry** — forward sanitized reports to Sentry's security monitoring.
- **Datadog / CloudWatch Logs** — centralize violation logs for dashboard visualization.
- **PagerDuty** — trigger alerts when violation rate exceeds thresholds.

The endpoint currently logs to `console.warn`; replace with `lib/logger` or your logging service in production.


## CSP Nonce — Per-Request Inline Script Allow-listing (#1022)

The middleware injects a per-request CSP nonce so inline `<script nonce="…">` tags (used by Next.js for the theme-bootstrap snippet) are allow-listed without requiring `'unsafe-inline'` in production.

### How it works

1. **Generation** — `middleware.ts` calls `crypto.randomUUID()` for each request to produce a cryptographically random UUID nonce.
2. **Forwarding** — The nonce is set on the forwarded request headers as `x-nonce`. `app/layout.tsx` reads this header and attaches it to inline `<script>` tags.
3. **CSP injection** — If `next.config.js` has already set a `Content-Security-Policy` header, the middleware replaces the `script-src` directive with a nonce-scoped version, discarding the static placeholder.

### Production vs. development directives

| Environment | `script-src` |
|-------------|--------------|
| production | `'self' 'nonce-<uuid>' 'strict-dynamic'` |
| development | `'self' 'nonce-<uuid>' 'unsafe-inline' 'unsafe-eval'` |

`'unsafe-eval'` and `'unsafe-inline'` are development-only and **gated on `NODE_ENV`** inside `buildNonceCsp()`. They must not appear in production script-src.

### Static asset bypass

The middleware matcher (`config.matcher`) explicitly excludes `_next/static`, `_next/image`, `favicon.ico`, `icons/`, `wallets/`, and `manifest.json` so the nonce injection is never applied to static file responses.

### Implementation

| File | Role |
|------|------|
| `middleware.ts` | `buildNonceCsp(nonce)` and injection logic |
| `app/layout.tsx` | Reads `x-nonce` header and attaches to inline scripts |
| `__tests__/middleware.test.ts` | Regression tests: nonce UUID format, per-request entropy, prod/dev CSP profiles, matcher exclusions |
| `e2e/security-headers.spec.ts` | E2E: `Content-Security-Policy` header present on every page |
