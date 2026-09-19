import {
  generateId,
  TenantId,
  UserId,
  Currency,
  KaziBetError,
  InsufficientFundsError,
  createDomainEvent
} from '@kazibet/shared';
import { DatabaseTransactionContext, IDatabase, PaymentEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine, STANDARD_ACCOUNTS } from '@kazibet/ledger';
import { PaymentProvider } from './provider-interface.js';

export interface WithdrawalOptions {
  maxTransactionLimitCents?: bigint;
  manualApprovalThresholdCents?: bigint;
}

export class PaymentService {
  constructor(
    private readonly db: IDatabase,
    private readonly ledger: LedgerEngine,
    private readonly providers: Map<string, PaymentProvider>
  ) {}

  public registerProvider(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  public async initiateDeposit(params: {
    tenantId: TenantId;
    userId: UserId;
    providerName: string;
    amountCents: bigint;
    currency?: Currency;
    phoneNumber?: string;
    idempotencyKey: string;
  }): Promise<{ payment: PaymentEntity; instructions?: string }> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.db.getContext();
    const currency = params.currency || 'KES';

    const provider = this.providers.get(params.providerName);
    if (!provider) {
      throw new KaziBetError('NOT_FOUND', `Payment provider '${params.providerName}' is not configured.`);
    }

    if (params.amountCents <= 0n) {
      throw new KaziBetError('VALIDATION_FAILED', 'Deposit amount must be positive.');
    }

    // Check idempotency
    const existing = await ctx.payments.findFirst(params.tenantId, { idempotencyKey: params.idempotencyKey });
    if (existing) {
      return { payment: existing };
    }

    const initRes = await provider.initiateDeposit({
      tenantId: params.tenantId,
      userId: params.userId,
      amountCents: params.amountCents,
      currency,
      phoneNumber: params.phoneNumber,
      idempotencyKey: params.idempotencyKey
    });

    const payment: PaymentEntity = {
      id: generateId(),
      tenantId: params.tenantId,
      userId: params.userId,
      provider: params.providerName,
      type: 'DEPOSIT',
      amountCents: params.amountCents,
      currency,
      status: initRes.status,
      providerTxId: initRes.providerTxId,
      idempotencyKey: params.idempotencyKey,
      metadata: { phoneNumber: params.phoneNumber },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const saved = await ctx.payments.create(params.tenantId, payment);
    return { payment: saved, instructions: initRes.instructions };
  }

  public async handleWebhook(params: {
    tenantId: TenantId;
    providerName: string;
    headers: Record<string, string>;
    rawBody: string;
  }): Promise<{ status: string; applied: boolean }> {
    TenantContextHolder.assertTenant(params.tenantId);
    const provider = this.providers.get(params.providerName);
    if (!provider) {
      throw new KaziBetError('NOT_FOUND', `Unknown provider ${params.providerName}`);
    }

    // 1. Verify webhook signature & parse
    const verification = await provider.verifyWebhook(params.headers, params.rawBody);
    if (!verification.valid) {
      throw new KaziBetError('UNAUTHORIZED', `Webhook verification failed: ${verification.reason || 'Invalid signature'}`, 401);
    }

    // 2. Transactionally process callback
    return await this.db.transaction(async (tx) => {
      const payment = await tx.payments.findFirst(params.tenantId, {
        providerTxId: verification.providerTxId
      });

      if (!payment) {
        throw new KaziBetError('NOT_FOUND', `Payment with providerTxId ${verification.providerTxId} not found.`);
      }

      // Replay check: already in final status
      if (payment.status === 'SUCCESS' || payment.status === 'FAILED') {
        return { status: payment.status, applied: false };
      }

      if (verification.status === 'SUCCESS') {
        // Post Double-Entry Journal Entry:
        // DR: ASSET:CLEARING:<provider>
        // CR: LIABILITY:USER_AVAILABLE:<userId>
        const clearingDef = STANDARD_ACCOUNTS.PAYMENT_CLEARING(params.providerName);
        const userAvailDef = STANDARD_ACCOUNTS.USER_AVAILABLE(payment.userId);

        const clearingAcc = await this.ledger.getOrCreateAccount({
          tenantId: params.tenantId,
          code: clearingDef.code,
          type: clearingDef.type,
          currency: payment.currency
        });

        const userAvailAcc = await this.ledger.getOrCreateAccount({
          tenantId: params.tenantId,
          code: userAvailDef.code,
          type: userAvailDef.type,
          currency: payment.currency
        });

        await this.ledger.postJournal({
          tenantId: params.tenantId,
          idempotencyKey: `journal-deposit-${payment.id}`,
          referenceType: 'DEPOSIT',
          referenceId: payment.id,
          description: `Deposit via ${params.providerName}`,
          lines: [
            { accountId: clearingAcc.id, direction: 'DR', amountCents: payment.amountCents, currency: payment.currency },
            { accountId: userAvailAcc.id, direction: 'CR', amountCents: payment.amountCents, currency: payment.currency }
          ]
        });

        // Update materialized wallet
        let wallet = await tx.wallets.findFirst(params.tenantId, { userId: payment.userId, currency: payment.currency });
        if (!wallet) {
          wallet = await tx.wallets.create(params.tenantId, {
            id: generateId(),
            tenantId: params.tenantId,
            userId: payment.userId,
            currency: payment.currency,
            availableCents: 0n,
            heldCents: 0n,
            bonusCents: 0n,
            version: 1n,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }

        await tx.wallets.update(params.tenantId, wallet.id, {
          availableCents: wallet.availableCents + payment.amountCents,
          version: wallet.version + 1n,
          updatedAt: new Date()
        });

        await tx.payments.update(params.tenantId, payment.id, {
          status: 'SUCCESS',
          updatedAt: new Date()
        });

        // Emit outbox event
        const depositEvent = createDomainEvent({
          tenantId: params.tenantId,
          name: 'DepositCompleted',
          aggregateType: 'Payment',
          aggregateId: payment.id,
          payload: {
            paymentId: payment.id,
            userId: payment.userId,
            amountCents: payment.amountCents.toString(),
            provider: params.providerName
          }
        });

        await tx.outboxEvents.create(params.tenantId, {
          id: depositEvent.id,
          tenantId: params.tenantId,
          eventName: depositEvent.name,
          aggregateType: depositEvent.aggregateType,
          aggregateId: depositEvent.aggregateId,
          payload: depositEvent.payload,
          status: 'PENDING',
          retryCount: 0,
          createdAt: new Date()
        });

        return { status: 'SUCCESS', applied: true };
      } else {
        await tx.payments.update(params.tenantId, payment.id, {
          status: 'FAILED',
          updatedAt: new Date()
        });
        return { status: 'FAILED', applied: true };
      }
    });
  }

  public async initiateWithdrawal(
    params: {
      tenantId: TenantId;
      userId: UserId;
      providerName: string;
      amountCents: bigint;
      destinationAccount: string;
      currency?: Currency;
      idempotencyKey: string;
    },
    options?: WithdrawalOptions
  ): Promise<PaymentEntity> {
    TenantContextHolder.assertTenant(params.tenantId);
    const currency = params.currency || 'KES';

    // 1. Transaction limit check
    if (options?.maxTransactionLimitCents && params.amountCents > options.maxTransactionLimitCents) {
      throw new KaziBetError(
        'RESPONSIBLE_GAMING_LIMIT_EXCEEDED',
        `Withdrawal amount of ${params.amountCents} cents exceeds the max transaction limit of ${options.maxTransactionLimitCents} cents.`,
        400
      );
    }

    return await this.db.transaction(async (tx) => {
      // 2. Idempotency check
      const existing = await tx.payments.findFirst(params.tenantId, { idempotencyKey: params.idempotencyKey });
      if (existing) return existing;

      // 3. Fraud hold check from risk cases
      const openRiskCases = await tx.riskCases.findMany(params.tenantId, { userId: params.userId, status: 'OPEN' });
      const hasFraudHold = openRiskCases.some(rc => rc.severity === 'HIGH' || rc.severity === 'CRITICAL');
      if (hasFraudHold) {
        throw new KaziBetError(
          'ACCOUNT_SUSPENDED',
          'Withdrawal held for security review due to an active elevated risk case.',
          403
        );
      }

      // 4. Check wallet available funds
      const wallet = await tx.wallets.findFirst(params.tenantId, { userId: params.userId, currency });
      if (!wallet || wallet.availableCents < params.amountCents) {
        throw new InsufficientFundsError('Insufficient available funds for withdrawal.');
      }

      // 5. Post Double-Entry Journal:
      // DR: LIABILITY:USER_AVAILABLE:<userId>
      // CR: ASSET:CLEARING:<provider>
      const clearingDef = STANDARD_ACCOUNTS.PAYMENT_CLEARING(params.providerName);
      const userAvailDef = STANDARD_ACCOUNTS.USER_AVAILABLE(params.userId);

      const clearingAcc = await this.ledger.getOrCreateAccount({
        tenantId: params.tenantId,
        code: clearingDef.code,
        type: clearingDef.type,
        currency
      });

      const userAvailAcc = await this.ledger.getOrCreateAccount({
        tenantId: params.tenantId,
        code: userAvailDef.code,
        type: userAvailDef.type,
        currency
      });

      const paymentId = generateId();

      await this.ledger.postJournal({
        tenantId: params.tenantId,
        idempotencyKey: `journal-withdrawal-${paymentId}`,
        referenceType: 'WITHDRAWAL',
        referenceId: paymentId,
        description: `Withdrawal via ${params.providerName}`,
        lines: [
          { accountId: userAvailAcc.id, direction: 'DR', amountCents: params.amountCents, currency },
          { accountId: clearingAcc.id, direction: 'CR', amountCents: params.amountCents, currency }
        ]
      });

      // 6. Update materialized wallet
      await tx.wallets.update(params.tenantId, wallet.id, {
        availableCents: wallet.availableCents - params.amountCents,
        version: wallet.version + 1n,
        updatedAt: new Date()
      });

      // 7. Manual approval threshold check
      const requiresApproval = Boolean(
        options?.manualApprovalThresholdCents && params.amountCents >= options.manualApprovalThresholdCents
      );

      const status: PaymentEntity['status'] = requiresApproval ? 'PENDING' : 'SUCCESS';

      // 8. Create Payment entity
      const payment: PaymentEntity = {
        id: paymentId,
        tenantId: params.tenantId,
        userId: params.userId,
        provider: params.providerName,
        type: 'WITHDRAWAL',
        amountCents: params.amountCents,
        currency,
        status,
        providerTxId: `wth-tx-${generateId().slice(0, 8)}`,
        idempotencyKey: params.idempotencyKey,
        metadata: {
          destinationAccount: params.destinationAccount,
          requiresManualApproval: requiresApproval
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      return await tx.payments.create(params.tenantId, payment);
    });
  }
}
