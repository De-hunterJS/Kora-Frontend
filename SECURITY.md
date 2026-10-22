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
