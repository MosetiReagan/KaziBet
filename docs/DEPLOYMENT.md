# KaziBet — Deployment & Infrastructure Topology

---

## 1. Topologies

KaziBet supports two standard deployment models:

### 1.1 One-Command Local Sandbox
A completely self-contained local stack for development, demonstration, and partner integrations:
- `docker-compose up -d` boots PostgreSQL, Redis, Redpanda, API gateway, Mock Payment simulator, Match Simulator, and Sportsbook Web UI.
- Pre-seeded with Kenya jurisdiction (`KES`), demo tenant (`kazi-sports`), dummy events, active markets, simulated STK push, and pre-funded test wallets.

### 1.2 Enterprise Kubernetes (Production)
A resilient cloud deployment:
- **Stateless Services**: Horizontal Pod Autoscaling (HPA) for `apps/api`, `apps/web`, `apps/admin`, `apps/realtime`, and `apps/ai`.
- **Workers**: Dedicated consumer pods for Settlement, Ledger, and Outbox dispatch.
- **Database**: Managed PostgreSQL (AWS Aurora, Google Cloud SQL) with read replicas and automated point-in-time recovery (PITR).
- **Cache / Locks**: Clustered Redis (AWS ElastiCache / GCP Memorystore).
- **Message Bus**: Managed Redpanda / Apache Kafka cluster.

---

## 2. Capability State Verification Gate

Before transitioning a tenant to `PRODUCTION_ACTIVE`, the system runs an automated audit:

```bash
kazibet compliance verify --tenant <tenant-id>
```

Validates:
1. Valid business registration and gaming license documentation recorded.
2. Production KYC/AML provider credentials configured and verified with ping probe.
3. Production Payment Gateway webhook endpoints secured with TLS and active shared secrets.
4. Jurisdiction tax rates and withholding rules configured with active effective date.
5. Responsible gaming limits (daily loss ceilings, self-exclusion endpoints) configured.
6. Zero use of default development encryption keys or placeholder passwords.
