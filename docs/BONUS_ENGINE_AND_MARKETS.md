# KaziBet Bonus Engine & Extended Market Settlement Specification

## 1. Overview

This document specifies the architecture, financial mechanics, and invariant guarantees for extended sports betting market types and the Wagering Bonus Engine in KaziBet.

---

## 2. Extended Market Types

### 2.1 Double Chance (`DOUBLE_CHANCE`)
Double Chance allows a bettor to cover two of the three possible match outcomes in a 3-way market:
- **`1X`**: Home Win or Draw. Settles as `WON` if $H \ge A$, else `LOST`.
- **`X2`**: Draw or Away Win. Settles as `WON` if $A \ge H$, else `LOST`.
- **`12`**: Home Win or Away Win (No Draw). Settles as `WON` if $H \neq A$, else `LOST`.

### 2.2 Draw No Bet (`DRAW_NO_BET` / `DNB`)
Draw No Bet eliminates the draw outcome:
- If the match ends in a **Draw** ($H == A$): All selections in the market are marked **`VOID`**, and the bettor's stake is refunded directly to their available balance via the ledger refund journal.
- If **Home Win** ($H > A$): Home selection is `WON`; Away selection is `LOST`.
- If **Away Win** ($A > H$): Away selection is `WON`; Home selection is `LOST`.

### 2.3 Asian Handicap (`ASIAN_HANDICAP` / `AH`)
Supports whole, half, and quarter-goal handicap lines:
- Full line (e.g. `0`, `+1.0`, `-1.0`): Can result in `WON`, `LOST`, or `VOID` (push).
- Half line (e.g. `+0.5`, `-0.5`): Strictly `WON` or `LOST`.
- Quarter line (e.g. `+0.25`, `-0.25`):
  - Difference $+0.25$: `HALF_WON` — half the stake wins at full odds, half the stake is refunded (`VOID`).
  - Difference $-0.25$: `HALF_LOST` — half the stake is lost, half the stake is refunded (`VOID`).

---

## 3. Bonus Engine Architecture

### 3.1 Bonus Types
1. **`DEPOSIT_MATCH`**: Grants matching promotional funds upon qualifying deposit (e.g. 100% match up to KES 5,000).
2. **`FREE_BET`**: A risk-free betting token where the stake is not returned upon winning.
3. **`WAGERING_BONUS`**: Reload and loyalty bonus funds subject to turnover wagering requirements before cashout.

### 3.2 Double-Entry Ledger Posting Rules

All bonus transactions strictly adhere to double-entry bookkeeping ($\sum \text{DR} == \sum \text{CR}$):

#### Bonus Granting
When promotional funds are granted to a bettor:
```
DR EXPENSE:MARKETING_BONUS            [bonusCents]
CR LIABILITY:USER_BONUS:{userId}      [bonusCents]
```

#### Rollover Completion (Conversion to Cash)
When the user fulfills the turnover requirement (e.g. $3\times$ turnover at odds $\ge 1.50$):
```
DR LIABILITY:USER_BONUS:{userId}      [currentBonusCents]
CR LIABILITY:USER_AVAILABLE:{userId}  [currentBonusCents]
```
The funds transition from restricted promotional liability directly into withdrawable bettor liability.

#### Expiration / Forfeiture
If the bonus reaches `expiresAt` before rollover requirements are fulfilled:
```
DR LIABILITY:USER_BONUS:{userId}      [forfeitAmountCents]
CR EXPENSE:MARKETING_BONUS            [forfeitAmountCents]
```
The liability is derecognized, and the promotional expense is reversed.

### 3.3 Free Bet Settlement Rule
Standard sports wagering free bet mechanics dictate that **only net profit is paid out**, and the stake is retained:
$$\text{Gross Profit} = \text{Stake} \times (\text{Odds} - 1.0)$$
$$\text{Tax Withheld (20\% KRA WHT)} = \text{Gross Profit} \times 0.20$$
$$\text{Net Bettor Payout} = \text{Gross Profit} - \text{Tax Withheld}$$
If the bet loses, gross winnings and payout are 0.
