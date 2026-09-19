import { TenantId } from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase, PaymentEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';

export interface ExternalStatementItem {
  providerTxId: string;
  amountCents: bigint;
  currency: string;
  status: string;
  timestamp: string;
}

export interface ReconciliationDiscrepancy {
  providerTxId: string;
  type: 'MISSING_IN_INTERNAL' | 'MISSING_IN_PROVIDER' | 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH';
  internalRecord?: PaymentEntity;
  providerRecord?: ExternalStatementItem;
  description: string;
}

export interface ReconciliationReport {
  tenantId: TenantId;
  provider: string;
  generatedAt: Date;
  totalInternalTransactions: number;
  totalProviderTransactions: number;
  matchedCount: number;
  discrepancies: ReconciliationDiscrepancy[];
}

export class PaymentReconciliationService {
  constructor(private readonly db: InMemoryDatabase) {}

  public async reconcile(
    tenantId: TenantId,
    provider: string,
    statement: ExternalStatementItem[]
  ): Promise<ReconciliationReport> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();

    const internalPayments = await ctx.payments.findMany(tenantId, { provider });
    const internalMap = new Map<string, PaymentEntity>();
    for (const p of internalPayments) {
      if (p.providerTxId) {
        internalMap.set(p.providerTxId, p);
      }
    }

    const providerMap = new Map<string, ExternalStatementItem>();
    for (const s of statement) {
      providerMap.set(s.providerTxId, s);
    }

    const discrepancies: ReconciliationDiscrepancy[] = [];
    let matchedCount = 0;

    // Check each provider record against internal
    for (const [txId, ext] of providerMap.entries()) {
      const internal = internalMap.get(txId);
      if (!internal) {
        discrepancies.push({
          providerTxId: txId,
          type: 'MISSING_IN_INTERNAL',
          providerRecord: ext,
          description: `Transaction ${txId} exists on external statement but is missing in internal ledger.`
        });
      } else {
        // Compare amounts
        if (internal.amountCents !== ext.amountCents) {
          discrepancies.push({
            providerTxId: txId,
            type: 'AMOUNT_MISMATCH',
            internalRecord: internal,
            providerRecord: ext,
            description: `Amount mismatch: Internal has ${internal.amountCents}, Provider has ${ext.amountCents}.`
          });
        } else if (internal.status !== ext.status) {
          discrepancies.push({
            providerTxId: txId,
            type: 'STATUS_MISMATCH',
            internalRecord: internal,
            providerRecord: ext,
            description: `Status mismatch: Internal is ${internal.status}, Provider is ${ext.status}.`
          });
        } else {
          matchedCount++;
        }
      }
    }

    // Check internal records missing from provider statement
    for (const [txId, internal] of internalMap.entries()) {
      if (!providerMap.has(txId) && internal.status === 'SUCCESS') {
        discrepancies.push({
          providerTxId: txId,
          type: 'MISSING_IN_PROVIDER',
          internalRecord: internal,
          description: `Internal transaction ${txId} marked SUCCESS is not present in provider statement.`
        });
      }
    }

    return {
      tenantId,
      provider,
      generatedAt: new Date(),
      totalInternalTransactions: internalPayments.length,
      totalProviderTransactions: statement.length,
      matchedCount,
      discrepancies
    };
  }
}
