import {
  generateId,
  TenantId,
  Currency,
  LedgerDirection,
  LedgerAccountType,
  LedgerUnbalancedError,
  KaziBetError
} from '@kazibet/shared';
import {
  DatabaseTransactionContext,
  InMemoryDatabase,
  LedgerAccountEntity,
  LedgerTransactionEntity,
  LedgerEntryEntity
} from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';

export interface JournalLineInput {
  accountId: string;
  direction: LedgerDirection;
  amountCents: bigint;
  currency: Currency;
}

export interface PostJournalParams {
  tenantId: TenantId;
  idempotencyKey: string;
  referenceType: string;
  referenceId: string;
  description?: string;
  lines: JournalLineInput[];
}

export class LedgerEngine {
  constructor(private readonly db: InMemoryDatabase) {}

  public async getOrCreateAccount(params: {
    tenantId: TenantId;
    code: string;
    type: LedgerAccountType;
    currency: Currency;
    walletId?: string;
  }): Promise<LedgerAccountEntity> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.db.getContext();

    const existing = await ctx.ledgerAccounts.findFirst(params.tenantId, {
      code: params.code,
      currency: params.currency,
      walletId: params.walletId
    });

    if (existing) return existing;

    const account: LedgerAccountEntity = {
      id: generateId(),
      tenantId: params.tenantId,
      code: params.code,
      type: params.type,
      currency: params.currency,
      walletId: params.walletId,
      createdAt: new Date()
    };

    return await ctx.ledgerAccounts.create(params.tenantId, account);
  }

  public async postJournal(params: PostJournalParams): Promise<LedgerTransactionEntity> {
    TenantContextHolder.assertTenant(params.tenantId);

    if (params.lines.length < 2) {
      throw new KaziBetError('VALIDATION_FAILED', 'A journal entry must contain at least two balancing legs.');
    }

    // 1. Calculate Debit and Credit sums
    let debitSum = 0n;
    let creditSum = 0n;

    for (const line of params.lines) {
      if (line.amountCents <= 0n) {
        throw new KaziBetError('VALIDATION_FAILED', 'Ledger entry amounts must be strictly positive.');
      }
      if (line.direction === 'DR') {
        debitSum += line.amountCents;
      } else {
        creditSum += line.amountCents;
      }
    }

    // 2. Strict Invariant Check: DR == CR
    if (debitSum !== creditSum) {
      throw new LedgerUnbalancedError(debitSum, creditSum);
    }

    // 3. Atomically persist transaction and entries
    return await this.db.transaction(async (tx) => {
      // Idempotency check
      const existingTx = await tx.ledgerTransactions.findFirst(params.tenantId, {
        idempotencyKey: params.idempotencyKey
      });
      if (existingTx) {
        return existingTx;
      }

      const txId = generateId();
      const transaction: LedgerTransactionEntity = {
        id: txId,
        tenantId: params.tenantId,
        idempotencyKey: params.idempotencyKey,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        description: params.description,
        postedAt: new Date()
      };

      await tx.ledgerTransactions.create(params.tenantId, transaction);

      for (const line of params.lines) {
        const entry: LedgerEntryEntity = {
          id: generateId(),
          tenantId: params.tenantId,
          transactionId: txId,
          accountId: line.accountId,
          direction: line.direction,
          amountCents: line.amountCents,
          currency: line.currency,
          createdAt: new Date()
        };
        await tx.ledgerEntries.create(params.tenantId, entry);
      }

      return transaction;
    });
  }

  /**
   * Computes the balance of an account directly from the immutable ledger entries.
   */
  public async getDerivedAccountBalance(tenantId: TenantId, accountId: string): Promise<bigint> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();
    const account = await ctx.ledgerAccounts.findById(tenantId, accountId);
    if (!account) {
      throw new KaziBetError('NOT_FOUND', `Ledger account ${accountId} not found.`);
    }

    const entries = await ctx.ledgerEntries.findMany(tenantId, { accountId });
    let debitSum = 0n;
    let creditSum = 0n;

    for (const e of entries) {
      if (e.direction === 'DR') debitSum += e.amountCents;
      else creditSum += e.amountCents;
    }

    // Assets & Expenses increase with Debits; Liabilities, Revenue, Equity increase with Credits
    if (account.type === 'ASSET' || account.type === 'EXPENSE') {
      return debitSum - creditSum;
    } else {
      return creditSum - debitSum;
    }
  }

  /**
   * Performs an automated system-wide invariant audit across all ledger transactions for a tenant.
   */
  public async auditSystemBalance(tenantId: TenantId): Promise<{ balanced: boolean; totalDebits: bigint; totalCredits: bigint }> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();
    const allEntries = await ctx.ledgerEntries.findMany(tenantId);

    let totalDebits = 0n;
    let totalCredits = 0n;

    for (const entry of allEntries) {
      if (entry.direction === 'DR') totalDebits += entry.amountCents;
      else totalCredits += entry.amountCents;
    }

    return {
      balanced: totalDebits === totalCredits,
      totalDebits,
      totalCredits
    };
  }
}
