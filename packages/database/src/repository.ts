import {
  TenantEntity,
  UserEntity,
  WalletEntity,
  LedgerAccountEntity,
  LedgerTransactionEntity,
  LedgerEntryEntity,
  EventEntity,
  MarketEntity,
  SelectionEntity,
  BetSlipEntity,
  BetEntity,
  BetLegEntity,
  PaymentEntity,
  RiskCaseEntity,
  AuditLogEntity,
  OutboxEventEntity,
  WalletHoldEntity
} from './models.js';

export interface DatabaseTransactionContext {
  tenants: Repository<TenantEntity>;
  users: TenantScopedRepository<UserEntity>;
  wallets: TenantScopedRepository<WalletEntity>;
  walletHolds: TenantScopedRepository<WalletHoldEntity>;
  ledgerAccounts: TenantScopedRepository<LedgerAccountEntity>;
  ledgerTransactions: TenantScopedRepository<LedgerTransactionEntity>;
  ledgerEntries: TenantScopedRepository<LedgerEntryEntity>;
  events: TenantScopedRepository<EventEntity>;
  markets: TenantScopedRepository<MarketEntity>;
  selections: Repository<SelectionEntity>;
  betSlips: TenantScopedRepository<BetSlipEntity>;
  bets: TenantScopedRepository<BetEntity>;
  betLegs: Repository<BetLegEntity>;
  payments: TenantScopedRepository<PaymentEntity>;
  riskCases: TenantScopedRepository<RiskCaseEntity>;
  auditLogs: TenantScopedRepository<AuditLogEntity>;
  outboxEvents: TenantScopedRepository<OutboxEventEntity>;
}

export interface Repository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  findMany(filter?: Partial<T>): Promise<T[]>;
  create(entity: T): Promise<T>;
  update(id: string, updates: Partial<T>): Promise<T>;
  delete(id: string): Promise<boolean>;
}

export interface TenantScopedRepository<T extends { id: string; tenantId: string }> {
  findById(tenantId: string, id: string): Promise<T | null>;
  findMany(tenantId: string, filter?: Partial<T>): Promise<T[]>;
  create(tenantId: string, entity: T): Promise<T>;
  update(tenantId: string, id: string, updates: Partial<T>): Promise<T>;
  delete(tenantId: string, id: string): Promise<boolean>;
  findFirst(tenantId: string, filter: Partial<T>): Promise<T | null>;
}
