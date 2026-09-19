# KaziBet — Financial Ledger & Accounting Design

KaziBet implements a double-entry ledger as its authoritative financial source of truth. User balances are derived materialized views guaranteed by strict accounting invariants.

---

## 1. Accounting Equation & Invariants

At all times, across every transaction in the system:

$$\sum \text{Debit Amounts} = \sum \text{Credit Amounts}$$

$$\text{Assets} = \text{Liabilities} + \text{Equity} + (\text{Revenue} - \text{Expenses})$$

### Invariant Rules
1. **Zero-Sum Transactions**: Every `LedgerTransaction` must have at least two entries and balance to zero:
   $$\sum_{e \in \text{entries}} (e.\text{direction} == \text{'DR'} ? e.\text{amount} : -e.\text{amount}) = 0$$
2. **Immutability**: Once committed, `ledger_transactions` and `ledger_entries` cannot be updated or deleted. Reversals or adjustments must be made via compensating transactions.
3. **Pessimistic Locking**: Prior to posting entries against a user's wallet accounts, row locks are acquired in order of account ID to eliminate deadlocks.
4. **Non-Negative Cash Invariant**: Liability accounts representing user available funds can never have a debit balance (overdraft is rejected at the database level).

---

## 2. Standard Transaction Posting Patterns

### 2.1 Deposit (e.g. 1,000 KES via M-Pesa)
```text
DEBIT:  ASSET:PAYMENT_CLEARING:MPESA          1,000 KES
CREDIT: LIABILITY:USER_AVAILABLE:<user_id>   1,000 KES
```

### 2.2 Bet Placement (Stake Hold: 200 KES)
```text
DEBIT:  LIABILITY:USER_AVAILABLE:<user_id>     200 KES
CREDIT: LIABILITY:USER_HOLD:<user_id>          200 KES
```

### 2.3 Bet Loss (200 KES)
```text
DEBIT:  LIABILITY:USER_HOLD:<user_id>          200 KES
CREDIT: REVENUE:GGR:SPORTS_BETTING             200 KES
```

### 2.4 Bet Win (Stake 200 KES at Odds 3.50 -> Return 700 KES; Withholding Tax 20% on 500 KES Net = 100 KES)
```text
DEBIT:  LIABILITY:USER_HOLD:<user_id>          200 KES
DEBIT:  EXPENSE:GAMING_PAYOUT                  500 KES
CREDIT: LIABILITY:USER_AVAILABLE:<user_id>     600 KES
CREDIT: LIABILITY:TAX_WITHHOLDING:KRA          100 KES
```
*Total DR = 700 KES, Total CR = 700 KES.*

### 2.5 Bet Void (Stake Returned: 200 KES)
```text
DEBIT:  LIABILITY:USER_HOLD:<user_id>          200 KES
CREDIT: LIABILITY:USER_AVAILABLE:<user_id>     200 KES
```

### 2.6 Withdrawal (e.g. 500 KES to Mobile Money)
```text
DEBIT:  LIABILITY:USER_AVAILABLE:<user_id>     500 KES
CREDIT: ASSET:PAYMENT_CLEARING:MPESA           500 KES
```

---

## 3. Reconciliation Subsystem

The reconciliation worker periodically runs three-way verification:
1. **Ledger Consistency**: Sum of entries matches wallet materialized balances.
2. **Provider Settlement**: Sum of internal payment records matches external provider clearing statements.
3. **Bank Statement Reconciliation**: External clearing account balances match real bank/mobile money treasury balances.

Discrepancies generate a `ReconciliationAnomaly` record that triggers an immediate risk alert and blocks automated withdrawals until resolved by a Finance Manager.
