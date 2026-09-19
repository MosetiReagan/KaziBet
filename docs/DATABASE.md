# KaziBet — Database Architecture & Schema Specification

KaziBet uses PostgreSQL as its primary source of truth. The database design utilizes strict referential integrity, check constraints, row-level isolation markers, and audit triggers.

---

## 1. Schema Conventions

- **Primary Keys**: UUIDv4 (`gen_random_uuid()`) for non-sequential, globally unique distributed identifiers.
- **Monetary Values**: Stored in minor currency units as `BIGINT` (e.g., Kenyan Shilling cents: 100.00 KES = `10000`) or high-precision decimal `DECIMAL(18, 4)` to eliminate floating-point rounding errors.
- **Timestamps**: All dates stored in UTC (`TIMESTAMPTZ`), defaulting to `NOW()`.
- **Tenant Scoping**: All operational tables include a foreign key `tenant_id` indexed with compound uniqueness constraints.

---

## 2. Core Relational Entities

### 2.1 Multi-Tenancy & Identity

```sql
-- Tenant Entity
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,       -- e.g. 'kazi-sports', 'betdemo'
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    default_currency VARCHAR(3) NOT NULL DEFAULT 'KES',
    capability_status VARCHAR(32) NOT NULL DEFAULT 'SANDBOX', -- SANDBOX, PRODUCTION_PENDING, PRODUCTION_APPROVED, PRODUCTION_ACTIVE, SUSPENDED
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    phone_number VARCHAR(32),
    email VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- PENDING, ACTIVE, KYC_PENDING, KYC_VERIFIED, KYC_REJECTED, SUSPENDED, SELF_EXCLUDED, CLOSED
    kyc_tier INT NOT NULL DEFAULT 1,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_phone UNIQUE (tenant_id, phone_number),
    CONSTRAINT uq_tenant_email UNIQUE (tenant_id, email)
);

-- RBAC
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for system-wide superadmin
    name VARCHAR(64) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);
```

### 2.2 Financial Ledger & Wallets

```sql
-- Wallet Record (Cache / Materialized View of Ledger, verified by double-entry integrity)
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    currency VARCHAR(3) NOT NULL,
    available_cents BIGINT NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
    held_cents BIGINT NOT NULL DEFAULT 0 CHECK (held_cents >= 0),
    bonus_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_currency UNIQUE (tenant_id, user_id, currency)
);

-- Ledger Accounts
CREATE TABLE ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    code VARCHAR(64) NOT NULL, -- e.g. USER_AVAILABLE, USER_HOLD, PAYMENT_CLEARING, GGR_REVENUE
    type VARCHAR(32) NOT NULL, -- ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    wallet_id UUID REFERENCES wallets(id),
    currency VARCHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_account UNIQUE (tenant_id, code, currency, wallet_id)
);

-- Ledger Transactions (Journal Entries)
CREATE TABLE ledger_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(128) NOT NULL,
    reference_type VARCHAR(64) NOT NULL, -- DEPOSIT, WITHDRAWAL, BET_HOLD, BET_WIN, CASHOUT, TAX_WITHHOLDING
    reference_id VARCHAR(128) NOT NULL,
    description TEXT,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- Ledger Entries (Double-Entry lines: Debit/Credit)
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    direction VARCHAR(2) NOT NULL CHECK (direction IN ('DR', 'CR')),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wallet Holds
CREATE TABLE wallet_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    bet_id UUID NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, COMMITTED, RELEASED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.3 Sports, Markets & Odds

```sql
CREATE TABLE sports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL, -- football, basketball, tennis, cricket, rugby
    name VARCHAR(128) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE competitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id UUID NOT NULL REFERENCES sports(id),
    slug VARCHAR(128) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(64)
);

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id UUID NOT NULL REFERENCES sports(id),
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(64),
    country VARCHAR(64)
);

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    competition_id UUID NOT NULL REFERENCES competitions(id),
    home_team_id UUID NOT NULL REFERENCES teams(id),
    away_team_id UUID NOT NULL REFERENCES teams(id),
    scheduled_start TIMESTAMPTZ NOT NULL,
    actual_start TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, LIVE, SUSPENDED, FINISHED, CANCELLED, POSTPONED
    home_score INT DEFAULT 0,
    away_score INT DEFAULT 0,
    period VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    market_type VARCHAR(64) NOT NULL, -- 1X2, OVER_UNDER, BOTH_TEAMS_TO_SCORE, HANDICAP
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, SETTLED, VOIDED
    suspension_reason VARCHAR(128),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. { "line": 2.5 }
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL, -- 'Home', 'Draw', 'Away', 'Over', 'Under'
    current_odds DECIMAL(8, 4) NOT NULL CHECK (current_odds >= 1.01),
    probability DECIMAL(6, 4),
    version INT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, WON, LOST, VOID
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.4 Bets, Slips & Settlements

```sql
CREATE TABLE bet_slips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(32) NOT NULL, -- SINGLE, ACCUMULATOR, SYSTEM
    total_stake_cents BIGINT NOT NULL CHECK (total_stake_cents > 0),
    potential_payout_cents BIGINT NOT NULL CHECK (potential_payout_cents >= total_stake_cents),
    status VARCHAR(32) NOT NULL DEFAULT 'PLACED', -- PLACED, WON, LOST, VOIDED, PARTIALLY_SETTLED, CASHED_OUT
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    bet_slip_id UUID NOT NULL REFERENCES bet_slips(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    stake_cents BIGINT NOT NULL,
    odds DECIMAL(12, 4) NOT NULL,
    potential_payout_cents BIGINT NOT NULL,
    payout_cents BIGINT DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PLACED', -- PLACED, WON, LOST, VOIDED, CASHED_OUT
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bet_legs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bet_id UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    selection_id UUID NOT NULL REFERENCES selections(id),
    accepted_odds DECIMAL(8, 4) NOT NULL,
    odds_version INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' -- PENDING, WON, LOST, VOID, HALF_WON, HALF_LOST
);
```

### 2.5 Outbox & Audit

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, PUBLISHED, FAILED
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    actor_id UUID,
    actor_type VARCHAR(32) NOT NULL, -- USER, ADMIN, SYSTEM, API_KEY
    action VARCHAR(128) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128) NOT NULL,
    before_state JSONB,
    after_state JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    correlation_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
