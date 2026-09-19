import { PrismaClient, Prisma } from '@prisma/client';
export { PrismaClient, Prisma };
import { TenantIsolationError } from '@kazibet/shared';
import {
  TenantEntity,
  UserEntity,
  WalletEntity,
  WalletHoldEntity,
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
  OutboxEventEntity
} from './models.js';
import {
  DatabaseTransactionContext,
  IDatabase,
  Repository,
  TenantScopedRepository
} from './repository.js';

type PrismaTx = PrismaClient | Prisma.TransactionClient;

export class PrismaTenantScopedRepo<T extends { id: string; tenantId: string }>
  implements TenantScopedRepository<T>
{
  constructor(
    protected readonly client: PrismaTx,
    protected readonly delegate: any
  ) {}

  public async findById(tenantId: string, id: string): Promise<T | null> {
    if (!tenantId) throw new TenantIsolationError('Tenant ID is required for findById');
    const result = await this.delegate.findFirst({
      where: { id, tenantId }
    });
    return (result as T) ?? null;
  }

  public async findFirst(tenantId: string, filter: Partial<T>): Promise<T | null> {
    if (!tenantId) throw new TenantIsolationError('Tenant ID is required for findFirst');
    const result = await this.delegate.findFirst({
      where: { ...filter, tenantId }
    });
    return (result as T) ?? null;
  }

  public async findMany(tenantId: string, filter?: Partial<T>): Promise<T[]> {
    if (!tenantId) throw new TenantIsolationError('Tenant ID is required for findMany');
    const results = await this.delegate.findMany({
      where: { ...(filter || {}), tenantId }
    });
    return results as T[];
  }

  public async create(tenantId: string, entity: T): Promise<T> {
    if (!tenantId || entity.tenantId !== tenantId) {
      throw new TenantIsolationError('Cross-tenant entity creation rejected');
    }
    const result = await this.delegate.create({
      data: entity
    });
    return result as T;
  }

  public async update(tenantId: string, id: string, updates: Partial<T>): Promise<T> {
    if (!tenantId) throw new TenantIsolationError('Tenant ID is required for update');
    const updated = await this.delegate.update({
      where: { id, tenantId },
      data: updates
    });
    return updated as T;
  }

  public async delete(tenantId: string, id: string): Promise<boolean> {
    if (!tenantId) throw new TenantIsolationError('Tenant ID is required for delete');
    await this.delegate.delete({
      where: { id, tenantId }
    });
    return true;
  }
}

export class PrismaWalletRepo extends PrismaTenantScopedRepo<WalletEntity> {
  /**
   * Row-level locking for wallet when reserving stake or mutating balance in transaction.
   */
  public async findForUpdate(tenantId: string, id: string): Promise<WalletEntity | null> {
    if (!tenantId) throw new TenantIsolationError('Tenant ID is required');
    // Row-level lock via SELECT ... FOR UPDATE
    const rows: WalletEntity[] = await (this.client as any).$queryRaw`
      SELECT * FROM "wallets" WHERE "id" = ${id}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE
    `;
    return rows[0] || null;
  }
}

export class PrismaGlobalRepo<T extends { id: string }> implements Repository<T> {
  constructor(protected readonly delegate: any) {}

  public async findById(id: string): Promise<T | null> {
    const result = await this.delegate.findUnique({ where: { id } });
    return (result as T) ?? null;
  }

  public async findMany(filter?: Partial<T>): Promise<T[]> {
    const results = await this.delegate.findMany({ where: filter || {} });
    return results as T[];
  }

  public async create(entity: T): Promise<T> {
    const result = await this.delegate.create({ data: entity });
    return result as T;
  }

  public async update(id: string, updates: Partial<T>): Promise<T> {
    const updated = await this.delegate.update({
      where: { id },
      data: updates
    });
    return updated as T;
  }

  public async delete(id: string): Promise<boolean> {
    await this.delegate.delete({ where: { id } });
    return true;
  }
}

export function createPrismaTransactionContext(client: PrismaTx): DatabaseTransactionContext {
  return {
    tenants: new PrismaGlobalRepo<TenantEntity>((client as any).tenant),
    users: new PrismaTenantScopedRepo<UserEntity>(client, (client as any).user),
    wallets: new PrismaWalletRepo(client, (client as any).wallet),
    walletHolds: new PrismaTenantScopedRepo<WalletHoldEntity>(client, (client as any).walletHold),
    ledgerAccounts: new PrismaTenantScopedRepo<LedgerAccountEntity>(client, (client as any).ledgerAccount),
    ledgerTransactions: new PrismaTenantScopedRepo<LedgerTransactionEntity>(client, (client as any).ledgerTransaction),
    ledgerEntries: new PrismaTenantScopedRepo<LedgerEntryEntity>(client, (client as any).ledgerEntry),
    events: new PrismaTenantScopedRepo<EventEntity>(client, (client as any).event),
    markets: new PrismaTenantScopedRepo<MarketEntity>(client, (client as any).market),
    selections: new PrismaGlobalRepo<SelectionEntity>((client as any).selection),
    betSlips: new PrismaTenantScopedRepo<BetSlipEntity>(client, (client as any).betSlip),
    bets: new PrismaTenantScopedRepo<BetEntity>(client, (client as any).bet),
    betLegs: new PrismaGlobalRepo<BetLegEntity>((client as any).betLeg),
    payments: new PrismaTenantScopedRepo<PaymentEntity>(client, (client as any).payment),
    riskCases: new PrismaTenantScopedRepo<RiskCaseEntity>(client, (client as any).riskCase),
    auditLogs: new PrismaTenantScopedRepo<AuditLogEntity>(client, (client as any).auditLog),
    outboxEvents: new PrismaTenantScopedRepo<OutboxEventEntity>(client, (client as any).outboxEvent)
  };
}

export class PrismaDatabase implements IDatabase {
  constructor(private readonly prisma: PrismaClient) {}

  public getContext(): DatabaseTransactionContext {
    return createPrismaTransactionContext(this.prisma);
  }

  public async transaction<T>(fn: (ctx: DatabaseTransactionContext) => Promise<T>): Promise<T> {
    return await this.prisma.$transaction(
      async (tx) => {
        const ctx = createPrismaTransactionContext(tx);
        return await fn(ctx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 10000
      }
    );
  }

  public async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
