# KaziBet Trading & Risk Management Architecture

## 1. Overview

The KaziBet Risk & Trading Engine (`packages/risk`) provides real-time bookmaker liability tracking, automated exposure ceilings, and fraud/collusion multi-account detection.

---

## 2. Bookmaker Liability & Exposure Controls

### 2.1 Liability Calculation
For any active selection $s$ belonging to market $M$, the engine tracks two critical metrics across all un-settled wagers ($\text{status} = \text{PLACED}$):
- **Gross Exposure**:
  $$\text{GrossExposure}(s) = \sum_{b \in \text{Bets}(s)} b.\text{potentialPayoutCents}$$
- **Net Liability** (Payout minus total stake received):
  $$\text{NetLiability}(s) = \max\left(0, \sum_{b \in \text{Bets}(s)} (b.\text{potentialPayoutCents} - b.\text{stakeCents})\right)$$

### 2.2 Market-Level Maximum Liability
$$\text{MaxMarketLiability}(M) = \max_{s \in \text{Selections}(M)} \text{NetLiability}(s)$$

### 2.3 Automated Market Suspension on Limit Breach
When a prospective wager would cause a selection's net liability to exceed the pre-configured exposure limit ($\text{projectedExposureCents} > \text{limitCents}$):
1. **Immediate Execution Rejection**: The incoming wager is blocked (`allowed = false`).
2. **Automated Market Suspension**: The market is atomically updated to `status = 'SUSPENDED'` with `suspensionReason = 'EXPOSURE_LIMIT_EXCEEDED'`.
3. **Trading Desk Alert**: An urgent `RiskCaseEntity` is created with `severity: 'HIGH'` and score `0.90` for trader review.

---

## 3. Multi-Account & Syndicate Detection

To combat bonus abuse, self-exclusion evasion, and betting syndicates, KaziBet profiles incoming user sessions across three vectors:

| Signal Type | Detection Vector | Risk Severity | Composite Score |
|---|---|:---:|:---:|
| `MULTI_ACCOUNT_DEVICE_SHARING` | Identical hardware / browser canvas fingerprint shared across distinct user accounts | **CRITICAL** | `0.95` |
| `MULTI_ACCOUNT_PAYMENT_SHARING` | Same M-Pesa account name / KYC identity used across different phone numbers | **HIGH** | `0.85` |
| `MULTI_ACCOUNT_IP_SHARING` | Same public IP address detected simultaneously across multiple active accounts | **MEDIUM** | `0.60` |

When composite risk score $\ge 0.70$, an open `RiskCaseEntity` is registered with linked user IDs for compliance audit.
