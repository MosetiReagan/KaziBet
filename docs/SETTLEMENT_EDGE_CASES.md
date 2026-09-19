# Settlement Edge Cases & Resettlement Architecture

This document details the financial settlement rules, edge-case evaluations, and ledger-safe resettlement mechanics implemented in `@kazibet/settlement`.

---

## 1. Asian Handicap (AH) Rules

Asian Handicap markets eliminate the draw outcome by applying fractional and quarter-ball goal handicaps to competitors.

Given home goals $G_H$, away goals $G_A$, and handicap $H$ from the selection perspective:
$$D = G_H - G_A \quad (\text{or } G_A - G_H \text{ for Away})$$
$$\text{Effective Margin } E = D + H$$

| Effective Margin $E$ | Outcome | Payout Formula | Double-Entry Ledger Posting |
|---|---|---|---|
| **$E > +0.25$** | **WON** | $\text{Stake} \times \text{Odds}$ (less 20% WHT on net winnings) | DR HOLD, DR GAMING_PAYOUT, CR AVAILABLE, CR TAX_WITHHOLDING |
| **$E = +0.25$** | **HALF_WON** | $\left(\frac{\text{Stake}}{2} \times \text{Odds}\right) + \frac{\text{Stake}}{2}$ | DR HOLD, DR GAMING_PAYOUT, CR AVAILABLE, CR TAX_WITHHOLDING |
| **$E = 0.00$** | **VOID (Push)** | $\text{Stake}$ (full refund) | DR HOLD, CR AVAILABLE |
| **$E = -0.25$** | **HALF_LOST** | $\frac{\text{Stake}}{2}$ (half refund, half lost to house) | DR HOLD, CR AVAILABLE ($\frac{S}{2}$), CR GGR_REVENUE ($\frac{S}{2}$) |
| **$E < -0.25$** | **LOST** | $0$ (full stake lost to house) | DR HOLD, CR GGR_REVENUE |

All postings strictly enforce $\sum \text{DR} == \sum \text{CR}$.

---

## 2. Dead Heat Rule

When $N$ selections tie for $M$ winning positions ($N > M$, e.g. 2 participants tie for 1 winner place, Dead Heat Factor $= M/N = 0.5$):

1. **Effective Stake**:
   $$S_{\text{eff}} = \text{Stake} \times \text{DeadHeatFactor}$$
2. **Lost Stake (to Operator GGR)**:
   $$S_{\text{lost}} = \text{Stake} - S_{\text{eff}}$$
3. **Gross Return**:
   $$\text{Gross Return} = S_{\text{eff}} \times \text{Odds}$$
4. **Net Winnings & 20% WHT**:
   $$\text{Tax Withheld} = \left\lfloor \frac{(\text{Gross Return} - S_{\text{eff}}) \times 20\% \times 100}{100} \right\rfloor$$
   $$\text{Net User Payout} = \text{Gross Return} - \text{Tax Withheld}$$
5. **Ledger Invariant**:
   - $\text{DR USER\_HOLD} = \text{Stake}$
   - $\text{DR GAMING\_PAYOUT} = \text{Gross Return} - S_{\text{eff}}$
   - $\text{CR USER\_AVAILABLE} = \text{Net User Payout}$
   - $\text{CR TAX\_WITHHOLDING} = \text{Tax Withheld}$
   - $\text{CR GGR\_REVENUE} = S_{\text{lost}}$
   - $\sum \text{DR} == \sum \text{CR}$ is maintained down to the cent.

---

## 3. Result Corrections & Resettlement

If an operator or official feed enters an erroneous match score, `resettleEventMarkets` provides a safe, fully audited correction flow within a configurable window (default: 2 hours):

### Invariants:
1. **Zero Ledger Mutation**:
   Existing ledger transactions and line items are **never modified or deleted**. The double-entry ledger is strictly append-only.
2. **Reversing Journal Entries**:
   For each settled bet on the affected event, a reversing journal entry is posted where all debit lines become credit lines, and all credit lines become debit lines:
   $$\text{DR previously credited} \quad \text{and} \quad \text{CR previously debited}$$
3. **Wallet Recovery & Negative Balance Protection**:
   - If the bettor has already withdrawn wrongful winnings before resettlement, deducting the wrongful payout drops `wallet.availableCents` below zero.
   - Negative balances are natively supported via `bigint`.
   - The engine automatically creates an urgent operator risk flag in `riskCases` with `signalType: 'NEGATIVE_BALANCE_AFTER_RESETTLEMENT'` and severity `'HIGH'`.
4. **Immutable Audit Trail**:
   Every resettlement records an audit log entry in `auditLogs` capturing `operatorId`, `reason`, `beforeState`, and `afterState`.
5. **Subsequent Correct Settlement**:
   The event is re-settled under the corrected score using standard settlement rules, posting new, correct journal entries.

---

## 4. Voided & Abandoned Events

- Matches abandoned without official resumption within statutory limits trigger `status: 'ABANDONED'` or `'CANCELLED'`.
- All selections are settled as `VOID`.
- Wagers are refunded via `BET_VOID` journals releasing funds from `USER_HOLD` directly to `USER_AVAILABLE`.
