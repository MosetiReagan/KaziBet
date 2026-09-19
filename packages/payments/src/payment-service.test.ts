import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine } from '@kazibet/ledger';
import { PaymentService } from './payment-service.js';
import { MockPaymentProvider } from './mock-provider.js';
import { PaymentReconciliationService } from './reconciliation-service.js';
import { InsufficientFundsError } from '@kazibet/shared';

describe('Payment & Reconciliation Suite', () => {
  const tenantId = 'tenant-pay-test';
  const userId = 'user-pay-1';

  async function setup() {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);
    const mockProvider = new MockPaymentProvider('secret-key-123');
    const providers = new Map([['MOCK_SANDBOX', mockProvider]]);
    const paymentService = new PaymentService(db, ledger, providers);
    const reconService = new PaymentReconciliationService(db);

    return { db, ledger, mockProvider, paymentService, reconService };
  }

  test('initiates deposit, handles webhook with ledger posting, and prevents replay', async () => {
    const { db, mockProvider, paymentService } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'pay-test',
        domain: 'pay.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const depositAmount = 50000n; // 500 KES

        // 1. Initiate Deposit
        const init = await paymentService.initiateDeposit({
          tenantId,
          userId,
          providerName: 'MOCK_SANDBOX',
          amountCents: depositAmount,
          idempotencyKey: 'dep-test-1'
        });

        assert.equal(init.payment.status, 'PENDING');
        assert.ok(init.payment.providerTxId);

        // 2. Simulate Webhook callback
        const payload = mockProvider.generateSimulatedWebhookPayload({
          providerTxId: init.payment.providerTxId!,
          amountCents: depositAmount,
          currency: 'KES',
          status: 'SUCCESS'
        });

        const res1 = await paymentService.handleWebhook({
          tenantId,
          providerName: 'MOCK_SANDBOX',
          headers: payload.headers,
          rawBody: payload.body
        });

        assert.equal(res1.status, 'SUCCESS');
        assert.equal(res1.applied, true);

        // Verify wallet credited
        const wallet = await db.getContext().wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 50000n);

        // 3. Webhook Replay: Repeat identical webhook
        const res2 = await paymentService.handleWebhook({
          tenantId,
          providerName: 'MOCK_SANDBOX',
          headers: payload.headers,
          rawBody: payload.body
        });

        assert.equal(res2.applied, false); // Not applied again!
        // Wallet balance remains 50000n, NOT 100000n!
        const walletAfter = await db.getContext().wallets.findFirst(tenantId, { userId });
        assert.equal(walletAfter?.availableCents, 50000n);
      }
    );
  });

  test('withdraws funds and prevents overdraft', async () => {
    const { db, paymentService } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'pay-test',
        domain: 'pay.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Seed wallet with 300 KES
        await db.getContext().wallets.create(tenantId, {
          id: 'w-1',
          tenantId,
          userId,
          currency: 'KES',
          availableCents: 30000n,
          heldCents: 0n,
          bonusCents: 0n,
          version: 1n,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Withdraw 200 KES
        const wth = await paymentService.initiateWithdrawal({
          tenantId,
          userId,
          providerName: 'MOCK_SANDBOX',
          amountCents: 20000n,
          destinationAccount: '+254712345678',
          idempotencyKey: 'wth-test-1'
        });

        assert.equal(wth.status, 'SUCCESS');
        const wallet = await db.getContext().wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 10000n);

        // Try to withdraw 500 KES (exceeds remaining 100 KES)
        await assert.rejects(
          async () =>
            await paymentService.initiateWithdrawal({
              tenantId,
              userId,
              providerName: 'MOCK_SANDBOX',
              amountCents: 50000n,
              destinationAccount: '+254712345678',
              idempotencyKey: 'wth-test-2'
            }),
          InsufficientFundsError
        );
      }
    );
  });

  test('reconciliation detects discrepancies accurately', async () => {
    const { db, reconService } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'pay-test',
        domain: 'pay.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Internal record: 100 KES (10,000 cents)
        await db.getContext().payments.create(tenantId, {
          id: 'pay-rec-1',
          tenantId,
          userId,
          provider: 'MOCK_SANDBOX',
          type: 'DEPOSIT',
          amountCents: 10000n,
          currency: 'KES',
          status: 'SUCCESS',
          providerTxId: 'tx-match-1',
          idempotencyKey: 'rec-idem-1',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // External statement with mismatched amount
        const statement = [
          {
            providerTxId: 'tx-match-1',
            amountCents: 9000n, // External statement says 90 KES
            currency: 'KES',
            status: 'SUCCESS',
            timestamp: new Date().toISOString()
          },
          {
            providerTxId: 'tx-orphan-2', // Missing in internal ledger
            amountCents: 5000n,
            currency: 'KES',
            status: 'SUCCESS',
            timestamp: new Date().toISOString()
          }
        ];

        const report = await reconService.reconcile(tenantId, 'MOCK_SANDBOX', statement);

        assert.equal(report.discrepancies.length, 2);
        assert.ok(report.discrepancies.some(d => d.type === 'AMOUNT_MISMATCH'));
        assert.ok(report.discrepancies.some(d => d.type === 'MISSING_IN_INTERNAL'));
      }
    );
  });
});
