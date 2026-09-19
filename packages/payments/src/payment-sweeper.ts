import { TenantId } from '@kazibet/shared';
import { IDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { PaymentProvider } from './provider-interface.js';
import { PaymentService } from './payment-service.js';

export interface SweepResult {
  sweptCount: number;
  resolvedSuccess: number;
  resolvedFailed: number;
  stillPending: number;
}

export class PaymentSweeperService {
  constructor(
    private readonly db: IDatabase,
    private readonly paymentService: PaymentService,
    private readonly providers: Map<string, PaymentProvider>
  ) {}

  /**
   * Sweeps payments stuck in PENDING status beyond the timeout duration.
   * Queries the provider status endpoint and updates the payment and ledger accordingly.
   */
  public async sweepPendingDeposits(tenantId: TenantId, timeoutMs = 60000): Promise<SweepResult> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();
    const threshold = new Date(Date.now() - timeoutMs);

    const pendingPayments = await ctx.payments.findMany(tenantId, {
      type: 'DEPOSIT',
      status: 'PENDING'
    });

    const stuckPayments = pendingPayments.filter(p => new Date(p.createdAt) <= threshold);

    let resolvedSuccess = 0;
    let resolvedFailed = 0;
    let stillPending = 0;

    for (const payment of stuckPayments) {
      if (!payment.providerTxId) {
        stillPending++;
        continue;
      }

      const provider = this.providers.get(payment.provider);
      if (!provider || !provider.queryPaymentStatus) {
        stillPending++;
        continue;
      }

      try {
        const queryResult = await provider.queryPaymentStatus(payment.providerTxId);

        if (queryResult.status === 'SUCCESS') {
          // Confirm success via provider query and resolve through handleWebhook
          const payload = JSON.stringify({
            Body: {
              stkCallback: {
                CheckoutRequestID: payment.providerTxId,
                ResultCode: 0,
                ResultDesc: 'Resolved via automatic sweeper query',
                CallbackMetadata: {
                  Item: [
                    {
                      Name: 'Amount',
                      Value: Number(payment.amountCents / 100n)
                    }
                  ]
                }
              }
            }
          });

          await this.paymentService.handleWebhook({
            tenantId,
            providerName: payment.provider,
            headers: { 'x-sweeper': 'true' },
            rawBody: payload
          });

          resolvedSuccess++;
        } else if (queryResult.status === 'FAILED') {
          await this.db.transaction(async (tx) => {
            await tx.payments.update(tenantId, payment.id, {
              status: 'FAILED',
              updatedAt: new Date()
            });
          });
          resolvedFailed++;
        } else {
          stillPending++;
        }
      } catch {
        stillPending++;
      }
    }

    return {
      sweptCount: stuckPayments.length,
      resolvedSuccess,
      resolvedFailed,
      stillPending
    };
  }
}
