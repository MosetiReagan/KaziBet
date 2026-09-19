# KaziBet Security, 2FA & Production Hardening Specification

## 1. Overview

KaziBet enforces multi-layered defense-in-depth security architecture across authentication, transport, resource consumption, and load resilience.

---

## 2. Two-Factor Authentication (TOTP - RFC 6238)

### 2.1 Specification
- **Algorithm**: Time-Based One-Time Password (TOTP) based on HMAC-SHA1 over 30-second steps.
- **Key Generation**: 160-bit (20-byte) cryptographically random keys encoded in Base32 (RFC 4648).
- **Provisioning URI**: Compatible with Google Authenticator, Authy, and hardware authenticators:
  `otpauth://totp/{issuer}:{accountName}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30`
- **Window Tolerance**: $\pm 1$ step ($\pm 30\text{s}$) to tolerate slight bettor device clock drift.

### 2.2 Single-Use Backup Codes
- 8 cryptographically generated 8-character single-use alphanumeric backup codes.
- Stored as salted PBKDF2/SHA-256 hashes.
- Once a backup code is verified during authentication, it is permanently consumed and removed from the active hash register.

### 2.3 Role Enforcement
- **Operator / Admin / Trader**: Mandatory 2FA. Access tokens are denied without a valid TOTP or backup code.
- **Bettor**: Configurable optional self-enrollment.

---

## 3. Sliding Window Rate Limiting

The API Gateway applies real-time sliding window counters per client IP or authenticated identity:

| Endpoint Target | Window Duration | Max Requests | Exceeded Action |
|---|:---:|:---:|:---:|
| `/api/v1/auth/login` | 15 minutes | 5 | 429 Too Many Requests (`Retry-After`) |
| `/api/v1/auth/register` | 60 minutes | 3 | 429 Too Many Requests (`Retry-After`) |
| `/api/v1/bets` (POST) | 1 minute | 60 | 429 Too Many Requests (`Retry-After`) |
| Payment Webhooks | 1 minute | 120 | 429 Too Many Requests (`Retry-After`) |

---

## 4. Input Sanitization, Payload Size & Security Headers

### 4.1 Security Headers
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-XSS-Protection: 0`
- `Content-Security-Policy: default-src 'self'`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 4.2 Request Body Size Ceilings
- **Standard API Requests**: Max 1MB (`1,048,576` bytes).
- **Reconciliation Statement Uploads**: Max 10MB (`10,485,760` bytes).
- Payloads exceeding these bounds are aborted in-flight with HTTP 413 `PAYLOAD_TOO_LARGE`.

### 4.3 CORS Domain Validation
- In `SANDBOX`, requests from developer origins (localhost, 127.0.0.1) are permitted.
- In `PRODUCTION_ACTIVE`, the `Origin` header must strictly match or be a subdomain of the tenant's licensed domain (`tenant.domain`). Unauthorized origins are rejected with HTTP 403 `FORBIDDEN_ORIGIN`.

---

## 5. Load Testing & Performance Targets

Load testing scenarios defined in `tests/load/k6-sportsbook-load.js` and verified by `tests/load/load-runner.ts`:
- **500 Concurrent Virtual Users (VUs)**: Browsing active markets and live odds feeds.
- **100 Concurrent VUs**: Placing wagers against wallet ledger reserves.
- **Latency Thresholds**:
  - Odds read latency: $p95 < 200\text{ms}$
  - Bet placement latency: $p99 < 500\text{ms}$
  - Error rate: $< 0.01$ (1%)
