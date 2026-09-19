# Web Bettor Application Architecture

The KaziBet Bettor Web Application (`apps/web`) provides a fast, mobile-first, reactive sports betting interface connected to the KaziBet API Gateway (`apps/api`) and Realtime Gateway (`apps/realtime`).

---

## 1. Gateway Connections

```
Browser Client (apps/web)
   │
   ├── REST HTTP API ──► API Gateway (apps/api :4000)
   │     ├── /api/v1/auth/*       (Register, Login, JWT verification)
   │     ├── /api/v1/events       (Live & Upcoming catalog + markets)
   │     ├── /api/v1/bets/place   (Idempotent bet placement)
   │     ├── /api/v1/cashier/*    (M-Pesa STK push, balance, B2C withdrawal)
   │     └── /api/v1/bets         (My Bets history & cashout)
   │
   └── Server-Sent Events ──► Realtime Hub (apps/realtime :4002)
         └── /events?channel=global
               ├── ODDS_UPDATED       (Live price fluctuations)
               ├── MARKET_SUSPENDED   (Stale feed or incident auto-suspension)
               └── SCORE_UPDATED      (Match goals and clocks)
```

---

## 2. Authentication & Token Security

- **Kenyan MSISDN Registration**: Bettors register with a Kenyan mobile number (`07XXXXXXXX` or `+254...`).
- **Token Storage Strategy**:
  - The JWT is maintained in application memory and persisted in browser `sessionStorage`.
  - **Rationale**:
    - `sessionStorage` isolates tokens strictly per browser tab, preventing cross-tab session contamination when testing multi-account scenarios.
    - Unlike ambient cookies, explicit `Authorization: Bearer <token>` headers are immune to Cross-Site Request Forgery (CSRF) vulnerabilities.
    - Tokens are scoped to the active tenant code (`X-Tenant-Code`) and verified against the tenant database isolation context on every request.

---

## 3. Financial Engine & Kenya 20% Withholding Tax (WHT)

All monetary amounts are manipulated as **`bigint` cents** (1 KES = 100 cents) across all models, preventing IEEE 754 floating-point rounding errors:

### Calculation Formula
1. **Total Odds**: Multiplicative compounding of accepted decimal odds:
   $$\text{Total Odds} = \prod_{i=1}^n \text{odds}_i$$
2. **Gross Return**:
   $$\text{Gross Payout Cents} = \left\lfloor \frac{\text{Stake Cents} \times \text{Total Odds} \times 10000}{10000} \right\rfloor$$
3. **Net Winnings**:
   $$\text{Net Winnings} = \max(0, \text{Gross Payout Cents} - \text{Stake Cents})$$
4. **Withholding Tax (20%)**:
   $$\text{WHT Cents} = \left\lfloor \frac{\text{Net Winnings} \times 2000 + 5000}{10000} \right\rfloor$$
5. **Est. Net Payout**:
   $$\text{Net User Payout Cents} = \text{Gross Payout Cents} - \text{WHT Cents}$$

*Example*: On a KES 1,000 stake at 2.50 odds:
- Gross Return: KES 2,500.00
- Net Winnings: KES 1,500.00
- 20% WHT: KES 300.00
- Net Payout: KES 2,200.00

---

## 4. Real-Time Odds Dynamics

- Connected via Server-Sent Events (`EventSource`).
- When bookmaker odds shift (`ODDS_UPDATED` event):
  - **Price Up**: Triggers CSS `.odds-up` (green flash animation).
  - **Price Down**: Triggers CSS `.odds-down` (red flash animation).
  - Automatically updates any open legs on the active bet slip.
- When market is suspended (`MARKET_SUSPENDED` event):
  - Disables the market selection button.
  - Badges the bet slip leg as `SUSPENDED` and disables the "Place Bet" button until resolved.

---

## 5. M-Pesa Cashier Integration

1. **Deposit**:
   - Bettor enters amount and phone number.
   - Triggers `POST /api/v1/cashier/deposit`, dispatching an asynchronous Daraja STK Push prompt to the user's handset.
   - The UI automatically polls `/api/v1/cashier/deposit/status/:id` every 2 seconds until the webhook settles the transaction into the double-entry ledger.
2. **Withdrawal**:
   - Triggers `POST /api/v1/cashier/withdraw`, validating available vs held balance, checking risk/fraud flags, and releasing funds via M-Pesa B2C.
