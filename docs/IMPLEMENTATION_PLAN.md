# KaziBet — Comprehensive Implementation Plan

This implementation plan guides the end-to-end development of KaziBet across 7 distinct vertical slices. Each feature corresponds to an atomic Git commit with verified tests, typing, and architectural integrity.

---

## 1. Roadmap & Vertical Slices

### Phase 1: Foundation, Multi-Tenancy & Identity
- **Commit 1.1**: Monorepo scaffolding (pnpm workspaces, TypeScript configuration, root toolchain, linting & formatting).
- **Commit 1.2**: Database schema design (Prisma ORM schema with PostgreSQL, core migrations, models for Tenant, User, Role, Permission, AuditLog).
- **Commit 1.3**: Shared Core Libraries (`@kazibet/shared`, `@kazibet/config`, `@kazibet/database`).
- **Commit 1.4**: Tenant isolation engine (`@kazibet/tenant`), tenant context resolver, Row-Level Security helpers.
- **Commit 1.5**: Identity, Authentication & Granular RBAC (`@kazibet/identity`, JWT/sessions, password hashing, MFA, account lifecycle).
- **Commit 1.6**: Core API application scaffold (`apps/api`), tenant middleware, auth middleware, health/readiness endpoints.
- **Commit 1.7**: Foundation tests & verification suite (tenant isolation tests, auth unit & integration tests).

### Phase 2: Sports Domain, Odds Engine & Bet Slip
- **Commit 2.1**: Sports Domain Models & Provider Abstraction (`@kazibet/sports`, normalized sports/competitions/events/teams).
- **Commit 2.2**: Sports Data Simulator & Fixture Engine (`services/simulator`, mock sports events, lifecycle transitions).
- **Commit 2.3**: Market & Odds Subsystem (`@kazibet/odds`, 1X2, Over/Under, Handicap, version tracking, suspension reason).
- **Commit 2.4**: Bet Slip Engine (`@kazibet/betting-engine`, Single, Accumulator, System bets, validation rules).
- **Commit 2.5**: Bet Placement API & Idempotent Execution Pipeline (pessimistic locking, validation pipeline, outbox integration).
- **Commit 2.6**: Sports & Betting verification tests (odds freshness checks, accumulator calculation tests, idempotency tests).

### Phase 3: Wallet, Double-Entry Ledger & Payments
- **Commit 3.1**: Double-Entry Financial Ledger Engine (`@kazibet/ledger`, balanced journals, accounts, immutable entries, balance snapshots).
- **Commit 3.2**: Wallet Operations Service (holds, releases, debit/credit orchestrator, non-negative balance guarantees).
- **Commit 3.3**: Payment Provider Abstraction (`@kazibet/payments`, M-Pesa STK Push adapter, Airtel Money adapter, Card 3DS adapter).
- **Commit 3.4**: Deposit & Withdrawal Orchestration (webhook signing, replay protection, verification).
- **Commit 3.5**: Financial Reconciliation Subsystem (ledger vs provider vs gateway discrepancy detector).
- **Commit 3.6**: Financial & Ledger verification suite (concurrency race condition tests, zero-sum journal tests, reconciliation tests).

### Phase 4: Deterministic Settlement, Risk & Compliance
- **Commit 4.1**: Deterministic Settlement Engine (`@kazibet/settlement`, win/loss/void/half-win rules, tax withholding calculation).
- **Commit 4.2**: Cashout Engine (real-time cashout valuation, ledger-backed execution).
- **Commit 4.3**: Responsible Gaming Framework (`@kazibet/compliance`, deposit/stake/loss limits, cooling-off, self-exclusion).
- **Commit 4.4**: KYC / AML Framework (`@kazibet/compliance`, provider interface, mock verification, PEP/sanction screening).
- **Commit 4.5**: Risk & Anomaly Rules Engine (`@kazibet/risk`, deposit spike signals, rapid bet velocity, automated review decisions).
- **Commit 4.6**: Settlement & Compliance verification tests (rule edge-cases, self-exclusion blocking, compensating adjustments).

### Phase 5: Administration, White-Label CMS & Real-time Subsystem
- **Commit 5.1**: Real-Time Event & WebSocket Gateway (`apps/realtime`, odds broadcasting, user wallet events, bet updates).
- **Commit 5.2**: White-label Brand & CMS Engine (tenant theming, banners, dynamic sports configuration, legal pages).
- **Commit 5.3**: Notification Engine (`@kazibet/notifications`, SMS, Email, Webhook dispatching).
- **Commit 5.4**: Promotion & Bonus Engine (wagering requirements, bonus wallet isolation).
- **Commit 5.5**: Admin API & Operator Management Endpoints (maker/checker workflows, market suspensions, audit search).
- **Commit 5.6**: Operator Analytics Engine (GGR/NGR aggregation, active user metrics, bet turnover).

### Phase 6: KaziBet AI & MCP Operations Copilot
- **Commit 6.1**: Model Context Protocol (MCP) Server for KaziBet (`apps/ai/mcp`).
- **Commit 6.2**: AI Risk & Fraud Investigator (automated case summaries, signal explanation, human-in-the-loop review).
- **Commit 6.3**: AI Operations Copilot API (`apps/ai`, natural language operator queries with strict RBAC enforcement).

### Phase 7: Sportsbook Web Experience & Admin Portal
- **Commit 7.1**: Shared UI Design System (`packages/ui`, betting slip component, odds buttons, responsive layouts).
- **Commit 7.2**: Public Sportsbook Web Application (`apps/web`, dynamic tenant branding, live event board, bet slip, wallet).
- **Commit 7.3**: Operator Admin Dashboard (`apps/admin`, risk dashboard, reconciliation viewer, KYC manager, live event trader).

### Phase 8: DevOps, Observability, CLI & Sandbox Deployment
- **Commit 8.1**: KaziBet Unified CLI (`packages/cli`, `kazibet` commands for tenant provisioning, seeding, doctor, backup).
- **Commit 8.2**: Production & Sandbox Containerization (Dockerfiles, multi-stage builds, `docker-compose.yml` one-command sandbox).
- **Commit 8.3**: Kubernetes Manifests & Helm Charts (`infrastructure/kubernetes`).
- **Commit 8.4**: Cloud Infrastructure as Code (`infrastructure/terraform`).
- **Commit 8.5**: Observability Suite (Prometheus metrics, OpenTelemetry tracing, Grafana dashboards, health probes).
- **Commit 8.6**: Disaster Recovery, Backup Verification & Fault Injection Scripts.
- **Commit 8.7**: Complete Documentation Package & Architecture Verification.

---

## 2. Quality Gates & Definition of Done

Each feature slice must meet:
1. **Compilation & Strict Typing**: `tsc --noEmit` cleanly across all packages.
2. **Automated Testing**: Unit and integration tests passing.
3. **Data Integrity**: Double-entry ledger invariant $\sum \text{Debits} == \sum \text{Credits}$ mathematically verified.
4. **Security**: Tenant boundary validation; all endpoints require explicit tenant context and RBAC check.
5. **Atomic Commit**: Clean, conventional commit message describing the feature.
