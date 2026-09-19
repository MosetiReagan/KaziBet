# KaziBet — Security Architecture & Threat Model

---

## 1. Authentication & Session Management

1. **Password Hashing**: Argon2id with strict parameters (memory: 64MB, iterations: 3, parallelism: 4).
2. **Tokens**: Stateless, signed EdDSA (or RS256) JWT access tokens with short lifetimes (15 minutes), paired with server-side revocable refresh tokens stored in Redis with fingerprinting (`User-Agent` + IP hash).
3. **Multi-Factor Authentication (MFA)**: RFC 6238 TOTP with mandatory backup recovery codes.
4. **Brute Force Protection**: Exponential backoff rate limiter keyed by `(tenant_id, ip_address, identifier)`.

---

## 2. Granular Role-Based Access Control (RBAC)

Permissions follow strict resource-action notation:
- `bets:read`, `bets:cancel`
- `markets:create`, `markets:suspend`
- `settlements:run`, `settlements:correct`
- `payments:refund`, `withdrawals:approve`
- `users:suspend`, `users:kyc_override`
- `config:write`, `tenant:update`

### Maker-Checker Protection
Sensitive financial and administrative operations (e.g. manual settlement corrections over \$1,000, withdrawal manual approvals over threshold, tenant capability upgrades) require approval from two distinct authorized identities:
1. **Maker**: Submits proposed action creating a `PendingApproval` record.
2. **Checker**: Reviews audit trail, verifies cryptographic signatures, and approves/rejects.

---

## 3. Webhook Security & Tamper Resistance

External payment gateways (e.g. M-Pesa Daraja, card processors) communicate status via webhooks:
- **Signature Verification**: HMAC-SHA256 signature verification over the raw request body with constant-time comparison (`crypto.timingSafeEqual`).
- **Replay Protection**: Timestamps checked within a 5-minute skew window; deduplication on `(provider, provider_tx_id)`.
- **IP Whitelisting**: Strict verification of originating gateway IP CIDR ranges.

---

## 4. Input Sanitization & Threat Defenses

- **SQL Injection**: Prevented via parameterized queries through Prisma ORM and strict typed query builders.
- **SSRF**: Outgoing HTTP calls to external providers resolve DNS beforehand, rejecting private RFC 1918, loopback, or cloud metadata IP ranges (`169.254.169.254`).
- **XSS & Security Headers**: Helmet middleware enforcing strict Content Security Policy (CSP), `X-Content-Type-Options: nosniff`, and HSTS.
