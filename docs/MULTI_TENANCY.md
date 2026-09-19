# KaziBet — Multi-Tenancy Architecture & Isolation Strategy

KaziBet supports multi-tenant operations where multiple independent sportsbooks run on a shared or dedicated infrastructure while maintaining airtight logical and physical separation.

---

## 1. Isolation Strategy

KaziBet uses a hybrid multi-tenant isolation model:

1. **Pooled Shared Database with Row-Level Security (RLS)**:
   - Every tenant-owned table contains `tenant_id UUID NOT NULL REFERENCES tenants(id)`.
   - PostgreSQL Row Level Security (RLS) is enabled on all core tables (`ALTER TABLE bets ENABLE ROW LEVEL SECURITY`).
   - Session variable `app.current_tenant_id` is set per connection/transaction.
   - Applications operate using scoped repository patterns that programmatically inject `tenant_id` into all WHERE clauses.

2. **Redis Namespace Partitioning**:
   - All cache, rate limiting, and pub/sub channels are strictly prefixed:
     `kazibet:{tenant_id}:{subsystem}:{key}`

3. **Event Stream Partitioning**:
   - Kafka domain events include `tenantId` in the event envelope headers, allowing single-tenant consumer groups or pooled aggregators.

---

## 2. Request Lifecycle & Context Resolution

```text
Incoming HTTP Request
  │
  ├─► Host Header: e.g. "betdemo.kazibet.com" OR "X-Tenant-ID" header
  ├─► TenantResolverMiddleware:
  │      ├─ Lookup tenant by domain/code in local LRU cache
  │      ├─ If not found or inactive, reject with 404 NOT_FOUND
  │      ├─ Validate Tenant Capability State (SANDBOX, PRODUCTION_ACTIVE, etc.)
  │      └─ Attach TenantContext to request execution context (AsyncLocalStorage)
  │
  ├─► Authentication & Token Verification:
  │      └─ Assert User.tenant_id == Request.tenantContext.tenantId (reject cross-tenant tokens)
  │
  ├─► Data Access Layer (Prisma / Query Builder):
  │      └─ Injects `tenantId` into query predicates
  │
  └─► Response
```

---

## 3. Cross-Tenant Leakage Prevention

- **Token Cross-Contamination**: JWT tokens carry the `tid` claim. Any attempt to use a valid token from Tenant A against Tenant B returns `403 FORBIDDEN: TENANT_MISMATCH`.
- **Foreign Key Enforcement**: Composite unique constraints prevent users in Tenant A from referencing markets, wallets, or bets in Tenant B.
- **Automated Isolation Testing**: Continuous integration runs malicious tenant breakout test suites verifying IDOR resistance across all endpoints.
