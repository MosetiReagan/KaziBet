import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantIsolationError } from '@kazibet/shared';
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
import {
  DatabaseTransactionContext,
  IDatabase,
  Repository,
  TenantScopedRepository
} from './repository.js';

function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
  if (typeof obj === 'bigint') return obj as unknown as T;
  if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;

  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    copy[key] = deepClone(val);
  }
  return copy as T;
}

class MemoryRepo<T extends { id: string }> implements Repository<T> {
  constructor(protected store: Map<string, T>) {}

  public async findById(id: string): Promise<T | null> {
    const item = this.store.get(id);
    return item ? deepClone(item) : null;
  }

  public async findMany(filter?: Partial<T>): Promise<T[]> {
    let list = Array.from(this.store.values());
    if (filter) {
      list = list.filter(item => {
        for (const [k, v] of Object.entries(filter)) {
          if ((item as Record<string, unknown>)[k] !== v) return false;
        }
        return true;
      });
    }
    return list.map(deepClone);
  }

  public async create(entity: T): Promise<T> {
    if (this.store.has(entity.id)) {
      throw new Error(`Duplicate primary key: ${entity.id}`);
    }
    const cloned = deepClone(entity);
    this.store.set(entity.id, cloned);
    return deepClone(cloned);
  }

  public async update(id: string, updates: Partial<T>): Promise<T> {
    const item = this.store.get(id);
    if (!item) {
      throw new Error(`Entity with id ${id} not found`);
    }
    const updated = { ...item, ...deepClone(updates) };
    this.store.set(id, updated);
    return deepClone(updated);
  }

  public async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}

class TenantScopedMemoryRepo<T extends { id: string; tenantId: string }> implements TenantScopedRepository<T> {
  constructor(protected store: Map<string, T>) {}

  public async findById(tenantId: string, id: string): Promise<T | null> {
    const item = this.store.get(id);
    if (!item) return null;
    if (item.tenantId !== tenantId) {
      throw new TenantIsolationError(`Tenant ${tenantId} cannot access record owned by ${item.tenantId}`);
    }
    return deepClone(item);
  }

  public async findMany(tenantId: string, filter?: Partial<T>): Promise<T[]> {
    let list = Array.from(this.store.values()).filter(item => item.tenantId === tenantId);
    if (filter) {
      list = list.filter(item => {
        for (const [k, v] of Object.entries(filter)) {
          if ((item as Record<string, unknown>)[k] !== v) return false;
        }
        return true;
      });
    }
    return list.map(deepClone);
  }

  public async findFirst(tenantId: string, filter: Partial<T>): Promise<T | null> {
    const list = await this.findMany(tenantId, filter);
    return list[0] ?? null;
  }

  public async create(tenantId: string, entity: T): Promise<T> {
    if (entity.tenantId !== tenantId) {
      throw new TenantIsolationError(`Entity tenantId ${entity.tenantId} does not match operation tenant ${tenantId}`);
    }
    if (this.store.has(entity.id)) {
      throw new Error(`Duplicate primary key: ${entity.id}`);
    }
    const cloned = deepClone(entity);
    this.store.set(entity.id, cloned);
    return deepClone(cloned);
  }

  public async update(tenantId: string, id: string, updates: Partial<T>): Promise<T> {
    const item = this.store.get(id);
    if (!item) {
      throw new Error(`Entity with id ${id} not found`);
    }
    if (item.tenantId !== tenantId) {
      throw new TenantIsolationError(`Tenant ${tenantId} cannot modify record owned by ${item.tenantId}`);
    }
    const updated = { ...item, ...deepClone(updates) };
    this.store.set(id, updated);
    return deepClone(updated);
  }

  public async delete(tenantId: string, id: string): Promise<boolean> {
    const item = this.store.get(id);
    if (!item) return false;
    if (item.tenantId !== tenantId) {
      throw new TenantIsolationError(`Tenant ${tenantId} cannot delete record owned by ${item.tenantId}`);
    }
    return this.store.delete(id);
  }
}

export class InMemoryDatabase implements IDatabase {
  private tenantsStore = new Map<string, TenantEntity>();
  private usersStore = new Map<string, UserEntity>();
  private walletsStore = new Map<string, WalletEntity>();
  private walletHoldsStore = new Map<string, WalletHoldEntity>();
  private ledgerAccountsStore = new Map<string, LedgerAccountEntity>();
  private ledgerTransactionsStore = new Map<string, LedgerTransactionEntity>();
  private ledgerEntriesStore = new Map<string, LedgerEntryEntity>();
  private eventsStore = new Map<string, EventEntity>();
  private marketsStore = new Map<string, MarketEntity>();
  private selectionsStore = new Map<string, SelectionEntity>();
  private betSlipsStore = new Map<string, BetSlipEntity>();
  private betsStore = new Map<string, BetEntity>();
  private betLegsStore = new Map<string, BetLegEntity>();
  private paymentsStore = new Map<string, PaymentEntity>();
  private riskCasesStore = new Map<string, RiskCaseEntity>();
  private auditLogsStore = new Map<string, AuditLogEntity>();
  private outboxEventsStore = new Map<string, OutboxEventEntity>();

  private transactionQueue: Promise<unknown> = Promise.resolve();

  public getContext(): DatabaseTransactionContext {
    return {
      tenants: new MemoryRepo(this.tenantsStore),
      users: new TenantScopedMemoryRepo(this.usersStore),
      wallets: new TenantScopedMemoryRepo(this.walletsStore),
      walletHolds: new TenantScopedMemoryRepo(this.walletHoldsStore),
      ledgerAccounts: new TenantScopedMemoryRepo(this.ledgerAccountsStore),
      ledgerTransactions: new TenantScopedMemoryRepo(this.ledgerTransactionsStore),
      ledgerEntries: new TenantScopedMemoryRepo(this.ledgerEntriesStore),
      events: new TenantScopedMemoryRepo(this.eventsStore),
      markets: new TenantScopedMemoryRepo(this.marketsStore),
      selections: new MemoryRepo(this.selectionsStore),
      betSlips: new TenantScopedMemoryRepo(this.betSlipsStore),
      bets: new TenantScopedMemoryRepo(this.betsStore),
      betLegs: new MemoryRepo(this.betLegsStore),
      payments: new TenantScopedMemoryRepo(this.paymentsStore),
      riskCases: new TenantScopedMemoryRepo(this.riskCasesStore),
      auditLogs: new TenantScopedMemoryRepo(this.auditLogsStore),
      outboxEvents: new TenantScopedMemoryRepo(this.outboxEventsStore)
    };
  }

  private txStorage = new AsyncLocalStorage<DatabaseTransactionContext>();

  /**
   * Executes a transaction block with automatic rollback on error.
   * Serializes concurrent transactions to prevent race conditions during high-volume betting,
   * while allowing nested re-entrant transactions to participate without deadlocking.
   */
  public async transaction<T>(fn: (ctx: DatabaseTransactionContext) => Promise<T>): Promise<T> {
    const activeCtx = this.txStorage.getStore();
    if (activeCtx) {
      return await fn(activeCtx);
    }

    const result = new Promise<T>((resolve, reject) => {
      this.transactionQueue = this.transactionQueue.then(async () => {
        // Take snapshots of stores
        const snapshot = {
          tenants: new Map(this.tenantsStore),
          users: new Map(this.usersStore),
          wallets: new Map(this.walletsStore),
          walletHolds: new Map(this.walletHoldsStore),
          ledgerAccounts: new Map(this.ledgerAccountsStore),
          ledgerTransactions: new Map(this.ledgerTransactionsStore),
          ledgerEntries: new Map(this.ledgerEntriesStore),
          events: new Map(this.eventsStore),
          markets: new Map(this.marketsStore),
          selections: new Map(this.selectionsStore),
          betSlips: new Map(this.betSlipsStore),
          bets: new Map(this.betsStore),
          betLegs: new Map(this.betLegsStore),
          payments: new Map(this.paymentsStore),
          riskCases: new Map(this.riskCasesStore),
          auditLogs: new Map(this.auditLogsStore),
          outboxEvents: new Map(this.outboxEventsStore)
        };

        try {
          const ctx = this.getContext();
          const res = await this.txStorage.run(ctx, () => fn(ctx));
          resolve(res);
        } catch (err) {
          // Rollback
          this.tenantsStore = snapshot.tenants;
          this.usersStore = snapshot.users;
          this.walletsStore = snapshot.wallets;
          this.walletHoldsStore = snapshot.walletHolds;
          this.ledgerAccountsStore = snapshot.ledgerAccounts;
          this.ledgerTransactionsStore = snapshot.ledgerTransactions;
          this.ledgerEntriesStore = snapshot.ledgerEntries;
          this.eventsStore = snapshot.events;
          this.marketsStore = snapshot.markets;
          this.selectionsStore = snapshot.selections;
          this.betSlipsStore = snapshot.betSlips;
          this.betsStore = snapshot.bets;
          this.betLegsStore = snapshot.betLegs;
          this.paymentsStore = snapshot.payments;
          this.riskCasesStore = snapshot.riskCases;
          this.auditLogsStore = snapshot.auditLogs;
          this.outboxEventsStore = snapshot.outboxEvents;
          reject(err);
        }
      }).catch(() => {
        // Catch errors in the queue chain so subsequent transactions continue processing
      });
    });

    return await result;
  }

  public clear(): void {
    this.tenantsStore.clear();
    this.usersStore.clear();
    this.walletsStore.clear();
    this.walletHoldsStore.clear();
    this.ledgerAccountsStore.clear();
    this.ledgerTransactionsStore.clear();
    this.ledgerEntriesStore.clear();
    this.eventsStore.clear();
    this.marketsStore.clear();
    this.selectionsStore.clear();
    this.betSlipsStore.clear();
    this.betsStore.clear();
    this.betLegsStore.clear();
    this.paymentsStore.clear();
    this.riskCasesStore.clear();
    this.auditLogsStore.clear();
    this.outboxEventsStore.clear();
  }
}
