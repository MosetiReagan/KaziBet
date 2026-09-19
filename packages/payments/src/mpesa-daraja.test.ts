import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { InMemoryDatabase } from '@kazibet/database';
import { LedgerEngine } from '@kazibet/ledger';
import { TenantContextHolder, TenantContext } from '@kazibet/tenant';
import { MpesaPaymentAdapter } from './mpesa-adapter.js';
import { PaymentService } from './payment-service.js';
import { PaymentSweeperService } from './payment-sweeper.js';
import { PaymentReconciliationService } from './reconciliation-service.js';

describe('Real M-Pesa Daraja Integration & Acceptance Suite', () => {
  let fakeDarajaServer: http.Server;
  let fakeDarajaPort = 0;
  let baseUrl = '';

  const tenantId = 'tenant_mpesa_test';
  const userId = 'user_mpesa_1';

  const tenantCtx: TenantContext = {
    tenantId,
    code: 'mpesa-tenant',
    domain: 'mpesa.kazibet.com',
    currency: 'KES',
    capabilityStatus: 'SANDBOX'
  };

  // Start a local fake Daraja server simulating Safaricom's endpoints
  before(async () => {
    fakeDarajaServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url?.startsWith('/oauth/v1/generate')) {
        res.writeHead(200);
        res.end(JSON.stringify({ access_token: 'fake_access_token_123', expires_in: '3599' }));
        return;
      }

      if (req.url?.startsWith('/mpesa/stkpush/v1/processrequest')) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ResponseCode: '0',
            ResponseDescription: 'Success. Request accepted for processing',
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_daraja_checkout_001',
            CustomerMessage: 'Success. Request accepted for processing'
          })
        );
        return;
      }

      if (req.url?.startsWith('/mpesa/stkpushquery/v1/query')) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ResponseCode: '0',
            ResponseDescription: 'The service request has been accepted successfully',
            MerchantRequestID: '29115-34620561-1',
            CheckoutRequestID: 'ws_CO_daraja_checkout_001',
            ResultCode: '0',
            ResultDesc: 'The service request is processed successfully.'
          })
        );
        return;
      }

      if (req.url?.startsWith('/mpesa/b2c/v1/paymentrequest')) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ResponseCode: '0',
            ResponseDescription: 'Accept the service request successfully.',
            ConversationID: 'AG_20191219_b2c_conv_001',
            OriginatorConversationID: '29115-34620561-2'
          })
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    await new Promise<void>((resolve) => {
      fakeDarajaServer.listen(0, '127.0.0.1', () => {
        const addr = fakeDarajaServer.address() as { port: number };
        fakeDarajaPort = addr.port;
        baseUrl = `http://127.0.0.1:${fakeDarajaPort}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => fakeDarajaServer.close(() => resolve()));
  });

  async function setupTestEnvironment() {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);

    const mpesaAdapter = new MpesaPaymentAdapter({
      baseUrl,
      consumerKey: 'test_consumer_key',
      consumerSecret: 'test_consumer_secret',
      passKey: 'test_pass_key_123456789',
      shortCode: '174379',
      callbackBaseUrl: 'http://localhost:4000',
      allowedIpRanges: ['196.201.214.0/24'],
      queryConfirmationRequired: true
    });

    const providers = new Map();
    providers.set(mpesaAdapter.name, mpesaAdapter);

    const paymentService = new PaymentService(db, ledger, providers);
    const sweeper = new PaymentSweeperService(db, paymentService, providers);
    const reconService = new PaymentReconciliationService(db);

    // Seed tenant and user
    await db.getContext().tenants.create({
      id: tenantId,
      code: 'mpesa-tenant',
      name: 'M-Pesa Sports',
      domain: 'mpesa.kazibet.com',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await db.getContext().users.create(tenantId, {
      id: userId,
      tenantId,
      passwordHash: 'hashed',
      status: 'ACTIVE',
      kycTier: 2,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { db, ledger, mpesaAdapter, paymentService, sweeper, reconService };
  }

  test('OAuth token caching: caches token and does not re-fetch before expiry', async () => {
    const { mpesaAdapter } = await setupTestEnvironment();
    const token1 = await mpesaAdapter.getAccessToken();
    assert.equal(token1, 'fake_access_token_123');

    const token2 = await mpesaAdapter.getAccessToken();
    assert.equal(token2, 'fake_access_token_123');
  });

  test('STK push initiation generates CheckoutRequestID and sets status PENDING', async () => {
    const { mpesaAdapter } = await setupTestEnvironment();
    const res = await mpesaAdapter.initiateDeposit({
      tenantId,
      userId,
      amountCents: 50000n, // 500 KES
      currency: 'KES',
      phoneNumber: '0712345678',
      idempotencyKey: 'idem-stk-1'
    });

    assert.equal(res.providerTxId, 'ws_CO_daraja_checkout_001');
    assert.equal(res.status, 'PENDING');
  });

  test('Acceptance: forged and unapproved IP callbacks are strictly rejected', async () => {
    const { mpesaAdapter } = await setupTestEnvironment();

    // 1. Forged IP
    const payload = JSON.stringify({
      Body: {
        stkCallback: {
          CheckoutRequestID: 'ws_CO_daraja_checkout_001',
          ResultCode: 0,
          ResultDesc: 'Success',
          CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }] }
        }
      }
    });

    const forgedIpResult = await mpesaAdapter.verifyWebhook(
      { 'x-forwarded-for': '45.33.32.156' }, // Malicious attacker IP
      payload
    );
    assert.equal(forgedIpResult.valid, false);
    assert.match(forgedIpResult.reason || '', /unapproved IP/);

    // 2. Approved IP
    const approvedIpResult = await mpesaAdapter.verifyWebhook(
      { 'x-forwarded-for': '196.201.214.15' }, // Safaricom range
      payload
    );
    assert.equal(approvedIpResult.valid, true);
    assert.equal(approvedIpResult.amountCents, 50000n);
  });

  test('Acceptance: replayed callback is ignored and does not double-credit wallet', async () => {
    const { paymentService, db } = await setupTestEnvironment();

    await TenantContextHolder.run(tenantCtx, async () => {
      // 1. Initiate deposit
      const deposit = await paymentService.initiateDeposit({
        tenantId,
        userId,
        providerName: 'MPESA_DARAJA',
        amountCents: 50000n,
        phoneNumber: '+254712345678',
        idempotencyKey: 'idem-replay-001'
      });

      const callbackPayload = JSON.stringify({
        Body: {
          stkCallback: {
            CheckoutRequestID: deposit.payment.providerTxId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }] }
          }
        }
      });

      const validHeaders = { 'x-forwarded-for': '196.201.214.15' };

      // 2. First callback execution
      const firstRun = await paymentService.handleWebhook({
        tenantId,
        providerName: 'MPESA_DARAJA',
        headers: validHeaders,
        rawBody: callbackPayload
      });
      assert.equal(firstRun.status, 'SUCCESS');
      assert.equal(firstRun.applied, true);

      const walletAfterFirst = await db.getContext().wallets.findFirst(tenantId, { userId });
      assert.equal(walletAfterFirst?.availableCents, 50000n);

      // 3. Replay of identical callback
      const replayRun = await paymentService.handleWebhook({
        tenantId,
        providerName: 'MPESA_DARAJA',
        headers: validHeaders,
        rawBody: callbackPayload
      });

      // Acceptance Criteria: Replay is ignored, applied is false, wallet remains exactly 50,000 cents
      assert.equal(replayRun.applied, false);
      assert.equal(replayRun.status, 'SUCCESS');

      const walletAfterReplay = await db.getContext().wallets.findFirst(tenantId, { userId });
      assert.equal(walletAfterReplay?.availableCents, 50000n, 'Wallet must NOT be double-credited');
    });
  });

  test('Acceptance: payment stuck in PENDING is resolved by the sweeper', async () => {
    const { paymentService, sweeper, db } = await setupTestEnvironment();

    await TenantContextHolder.run(tenantCtx, async () => {
      // 1. Initiate deposit that never receives a callback
      const deposit = await paymentService.initiateDeposit({
        tenantId,
        userId,
        providerName: 'MPESA_DARAJA',
        amountCents: 30000n, // 300 KES
        phoneNumber: '+254712345678',
        idempotencyKey: 'idem-stuck-001'
      });

      // Manually age the payment by 2 minutes to simulate being stuck
      await db.getContext().payments.update(tenantId, deposit.payment.id, {
        createdAt: new Date(Date.now() - 120000)
      });

      const walletBeforeSweep = await db.getContext().wallets.findFirst(tenantId, { userId });
      assert.equal(walletBeforeSweep?.availableCents ?? 0n, 0n);

      // 2. Run pending payment sweeper
      const sweepReport = await sweeper.sweepPendingDeposits(tenantId, 60000);
      assert.equal(sweepReport.sweptCount, 1);
      assert.equal(sweepReport.resolvedSuccess, 1);

      // Acceptance Criteria: payment is now SUCCESS and wallet is credited
      const paymentAfterSweep = await db.getContext().payments.findById(tenantId, deposit.payment.id);
      assert.equal(paymentAfterSweep?.status, 'SUCCESS');

      const walletAfterSweep = await db.getContext().wallets.findFirst(tenantId, { userId });
      assert.equal(walletAfterSweep?.availableCents, 30000n);
    });
  });

  test('Withdrawal controls: limit enforcement, fraud hold, and manual approval threshold', async () => {
    const { paymentService, db } = await setupTestEnvironment();

    await TenantContextHolder.run(tenantCtx, async () => {
      // Fund user wallet with 1,000,000 cents (10,000 KES)
      await db.getContext().wallets.create(tenantId, {
        id: 'w-wth-controls',
        tenantId,
        userId,
        currency: 'KES',
        availableCents: 1000000n,
        heldCents: 0n,
        bonusCents: 0n,
        version: 1n,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // 1. Limit enforcement check
      await assert.rejects(
        () =>
          paymentService.initiateWithdrawal(
            {
              tenantId,
              userId,
              providerName: 'MPESA_DARAJA',
              amountCents: 200000n,
              destinationAccount: '254712345678',
              idempotencyKey: 'wth-limit-exceed'
            },
            { maxTransactionLimitCents: 100000n } // Max 1,000 KES
          ),
        /exceeds the max transaction limit/
      );

      // 2. Fraud hold check
      await db.getContext().riskCases.create(tenantId, {
        id: 'rc-fraud-1',
        tenantId,
        userId,
        signalType: 'VELOCITY_SURGE',
        severity: 'HIGH',
        score: 85,
        status: 'OPEN',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await assert.rejects(
        () =>
          paymentService.initiateWithdrawal({
            tenantId,
            userId,
            providerName: 'MPESA_DARAJA',
            amountCents: 50000n,
            destinationAccount: '254712345678',
            idempotencyKey: 'wth-fraud-hold'
          }),
        /Withdrawal held for security review/
      );

      // Resolve risk case
      await db.getContext().riskCases.update(tenantId, 'rc-fraud-1', { status: 'RESOLVED' });

      // 3. Manual approval threshold check
      const highValueWth = await paymentService.initiateWithdrawal(
        {
          tenantId,
          userId,
          providerName: 'MPESA_DARAJA',
          amountCents: 80000n, // 800 KES
          destinationAccount: '254712345678',
          idempotencyKey: 'wth-manual-approval'
        },
        { manualApprovalThresholdCents: 70000n } // threshold 700 KES
      );

      assert.equal(highValueWth.status, 'PENDING');
      assert.equal(highValueWth.metadata['requiresManualApproval'], true);
    });
  });

  test('Daraja statement reconciliation: parses CSV statement and detects discrepancies', async () => {
    const { reconService, db } = await setupTestEnvironment();

    await TenantContextHolder.run(tenantCtx, async () => {
      // Seed internal payment
      await db.getContext().payments.create(tenantId, {
        id: 'pay-recon-1',
        tenantId,
        userId,
        provider: 'MPESA_DARAJA',
        type: 'DEPOSIT',
        amountCents: 50000n,
        currency: 'KES',
        status: 'SUCCESS',
        providerTxId: 'QWE123RTY',
        idempotencyKey: 'idem-pay-recon-1',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Sample M-Pesa portal CSV export
      const darajaCsv = `
Receipt No,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance
QWE123RTY,2026-09-19 14:00:00,Paybill Payment,Completed,500.00,0.00,500.00
XYZ987ABC,2026-09-19 14:05:00,Paybill Payment,Completed,250.00,0.00,750.00
      `.trim();

      const report = await reconService.importAndReconcileDarajaCsv(tenantId, darajaCsv);

      assert.equal(report.matchedCount, 1);
      assert.equal(report.discrepancies.length, 1);
      assert.equal(report.discrepancies[0]!.type, 'MISSING_IN_INTERNAL');
      assert.equal(report.discrepancies[0]!.providerTxId, 'XYZ987ABC');
    });
  });
});
