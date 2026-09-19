import { TenantId } from '@kazibet/shared';
import { DatabaseTransactionContext, IDatabase, PaymentEntity } from '@kazibet/database';
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
  constructor(private readonly db: IDatabase) {}

  /**
   * Parse exported Safaricom M-Pesa Portal statement CSV file into statement items.
   */
  public static parseDarajaStatementCsv(csvContent: string): ExternalStatementItem[] {
    const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return [];

    const headers = lines[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const receiptIdx = headers.findIndex(h => /receipt\s*no/i.test(h));
    const statusIdx = headers.findIndex(h => /status/i.test(h));
    const paidInIdx = headers.findIndex(h => /paid\s*in/i.test(h));
    const withdrawnIdx = headers.findIndex(h => /withdrawn/i.test(h));
    const timeIdx = headers.findIndex(h => /completion\s*time|time/i.test(h));

    const items: ExternalStatementItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i]!.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      const txId = parts[receiptIdx >= 0 ? receiptIdx : 0] || '';
      if (!txId) continue;

      const rawStatus = (parts[statusIdx >= 0 ? statusIdx : 4] || '').toUpperCase();
      const status = rawStatus === 'COMPLETED' || rawStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED';

      const paidInStr = parts[paidInIdx >= 0 ? paidInIdx : 5]?.replace(/[^\d.-]/g, '') || '0';
      const withdrawnStr = parts[withdrawnIdx >= 0 ? withdrawnIdx : 6]?.replace(/[^\d.-]/g, '') || '0';
      const numAmount = Math.max(parseFloat(paidInStr) || 0, parseFloat(withdrawnStr) || 0);
      const amountCents = BigInt(Math.round(numAmount * 100));

      items.push({
        providerTxId: txId,
        amountCents,
        currency: 'KES',
        status,
        timestamp: parts[timeIdx >= 0 ? timeIdx : 1] || new Date().toISOString()
      });
    }

    return items;
  }

  public async importAndReconcileDarajaCsv(
    tenantId: TenantId,
    csvContent: string
  ): Promise<ReconciliationReport> {
    const statementItems = PaymentReconciliationService.parseDarajaStatementCsv(csvContent);
    return await this.reconcile(tenantId, 'MPESA_DARAJA', statementItems);
  }

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
