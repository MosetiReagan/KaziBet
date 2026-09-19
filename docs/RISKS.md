# KaziBet — Architectural Risks & Threat Mitigations

---

## 1. Comprehensive Risk Matrix

| Risk ID | Category | Risk Description | Severity | Probability | Architectural Mitigation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **RSK-01** | Financial | Race condition in concurrent bet placement causing double-spending of wallet balance. | **CRITICAL** | High | Pessimistic locking (`SELECT FOR UPDATE`) on wallet + Redis distributed lock + PostgreSQL non-negative check constraint. |
| **RSK-02** | Compliance | Sandbox environment leaking or executing real payment transactions. | **CRITICAL** | Low | Provider adapter capability check blocks any live external payment gateway invocation unless `tenant.capability_status === 'PRODUCTION_ACTIVE'`. |
| **RSK-03** | Security | Cross-tenant data breach via Insecure Direct Object Reference (IDOR). | **CRITICAL** | Med | Tenant context resolution injected into AsyncLocalStorage + PostgreSQL RLS policies + composite unique constraints. |
| **RSK-04** | Operational | Duplicate or out-of-order settlement resulting in double payouts. | **HIGH** | Med | Strict state machine on Bet entity (`PLACED` -> `SETTLED`) with unique constraint on `(bet_id, settlement_version)` and immutable ledger journal. |
| **RSK-05** | Integrity | Stale or manipulated odds accepted on live in-play bets. | **HIGH** | Med | Optimistic locking on selection odds version (`odds_version`) + maximum latency threshold (e.g. 2,000ms max acceptance window) + slippage limits. |
| **RSK-06** | Systemic | Message broker outage or worker crash during settlement causing lost payouts. | **HIGH** | Med | Transactional outbox pattern with persistent event storage in PostgreSQL ensuring reliable resume on worker recovery. |
| **RSK-07** | AI Governance | Autonomous AI agent performing unapproved payout or account closure. | **HIGH** | Low | AI system operates strictly as read-only investigator/copilot; high-risk actions require human-in-the-loop maker-checker approval. |
| **RSK-08** | Regulatory | Non-compliance with jurisdiction tax rules (e.g. Kenya 20% withholding tax on winnings). | **HIGH** | Low | Jurisdiction tax engine calculates and debits withholding tax into dedicated ledger liability account at settlement time before crediting user available balance. |
