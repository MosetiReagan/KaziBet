# KaziBet Kenya Localization Architecture: USSD & SMS Betting

## 1. Overview

In East Africa, feature phones and low-bandwidth channels account for a significant share of retail wagering volume. The `@kazibet/kenya` package provides carrier-grade **USSD Interactive Menus** and an **SMS Natural Betting Parser**, integrated natively with the KaziBet core ledger and bet placement engine.

---

## 2. USSD Betting Simulator (*123#)

### 2.1 Multi-Step State Machine
The USSD gateway simulates standard Africa's Talking / Safaricom USSD protocol session management:

```
                  ┌──────────────────────┐
                  │    Dial *123#        │
                  │  (Root Main Menu)    │
                  └──────────┬───────────┘
                             │
     ┌──────────────┬────────┼──────────────┬─────────────┐
     │ 1            │ 2      │ 3            │ 4           │ 5
┌────▼────┐   ┌─────▼───┐ ┌──▼──────┐   ┌───▼────┐    ┌───▼──────┐
│ Today's │   │  Place  │ │ My Bets │   │ Balance│    │ Withdraw │
│ Matches │   │   Bet   │ │ History │   │ Query  │    │  Funds   │
└─────────┘   └─────┬───┘ └─────────┘   └────────┘    └──────────┘
                    │
           ┌────────▼────────┐
           │ Enter Match#Pick│  (e.g. 101#1, 101#X, 101#2)
           └────────┬────────┘
                    │
           ┌────────▼────────┐
           │   Enter Stake   │  (e.g. 100)
           └────────┬────────┘
                    │
           ┌────────▼────────┐
           │   END Success   │  (Bet Placed, New Balance)
           └─────────────────┘
```

### 2.2 160-Character Screen Limitation
Due to telecom GSM 03.38 standard screen limits on mobile handsets, every USSD response is strictly constrained:
$$\text{length}(\text{message}) \le 160\text{ characters}$$

---

## 3. SMS Betting Parser

Inbound SMS to shortcodes (e.g., `29090`) are parsed using high-resilience regex and fuzzy team alias matching:

| Inbound Command | Syntax Pattern | Action & Ledger Effect | Outbound Reply Template ($\le 160$ chars) |
|---|---|---|---|
| **Single Bet (Team Alias)** | `BET 100 on ARS` | Resolves `ARS` to Arsenal win in Match 101. Deducts KES 100 hold. | `Bet #a1b2c3 accepted! Arsenal Win, Staked KES 100 @ 2.10. Pot. Win: KES 210. Bal: KES 900.` |
| **Multi-Leg Acca** | `BET 500 101#1 102#2` | Parses matches 101 (pick 1) and 102 (pick 2). Deducts KES 500 hold. | `Bet #d4e5f6 accepted! 2-Leg Acca, Staked KES 500 @ 5.88. Pot. Win: KES 2,940. Bal: KES 400.` |
| **Balance Query** | `BAL` or `BALANCE` | Queries user wallet balance in KES. | `KaziBet Bal: KES 400.00 (Bonus: KES 0.00). Dial *123# to bet or visit kazibet.ke` |
| **Bet Cashout** | `CANCEL <betId>` | Executes cashout via `CashoutEngine`. Credits fair value to wallet. | `Bet #a1b2c3 cashed out successfully! KES 168.00 credited to wallet. Bal: KES 568.00.` |

### 3.1 Edge Case Handling
- **Invalid Match ID**: Returns helpful rejection with match schedule shortcode.
- **Insufficient Funds**: Returns exact shortfall and M-Pesa Paybill deposit instructions.
- **Malformed SMS**: Returns quick syntax guide with examples.
