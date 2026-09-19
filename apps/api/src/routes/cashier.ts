import { Router } from '../router.js';
import { PaymentService } from '@kazibet/payments';
import { IDatabase } from '@kazibet/database';
import { KaziBetError, generateId } from '@kazibet/shared';

export function registerCashierRoutes(
  router: Router,
  paymentService: PaymentService,
  db: IDatabase
): void {
  // GET /api/v1/cashier/balance
  router.get('/api/v1/cashier/balance', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const ctx = db.getContext();
    const wallet = await ctx.wallets.findFirst(req.tenant.tenantId, {
      userId: req.user.userId,
      currency: req.tenant.currency
    });

    const availableCents = wallet ? wallet.availableCents.toString() : '0';
    const heldCents = wallet ? wallet.heldCents.toString() : '0';
    const bonusCents = wallet ? wallet.bonusCents.toString() : '0';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        currency: req.tenant.currency,
        availableCents,
        heldCents,
        bonusCents
      })
    );
  });

  // POST /api/v1/cashier/deposit
  router.post('/api/v1/cashier/deposit', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const { amountCents, phoneNumber, providerName = 'MPESA_DARAJA' } = req.body as {
      amountCents: string | number;
      phoneNumber: string;
      providerName?: string;
    };

    if (!amountCents || BigInt(amountCents) <= 0n) {
      throw new KaziBetError('VALIDATION_FAILED', 'Positive deposit amountCents is required.');
    }
    if (!phoneNumber) {
      throw new KaziBetError('VALIDATION_FAILED', 'Phone number is required for M-Pesa deposit.');
    }

    const idempotencyKey =
      (req.headers['idempotency-key'] as string) ||
      (req.body?.['idempotencyKey'] as string) ||
      `dep-${generateId()}`;

    const result = await paymentService.initiateDeposit({
      tenantId: req.tenant.tenantId,
      userId: req.user.userId,
      providerName,
      amountCents: BigInt(amountCents),
      currency: req.tenant.currency,
      phoneNumber,
      idempotencyKey
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        paymentId: result.payment.id,
        providerTxId: result.payment.providerTxId,
        status: result.payment.status,
        amountCents: result.payment.amountCents.toString(),
        instructions: result.instructions || 'Please approve the M-Pesa prompt on your phone.'
      })
    );
  });

  // GET /api/v1/cashier/deposit/status/:paymentId
  router.get('/api/v1/cashier/deposit/status/:paymentId', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const paymentId = req.params?.['paymentId'];
    if (!paymentId) {
      throw new KaziBetError('VALIDATION_FAILED', 'paymentId is required.');
    }

    const ctx = db.getContext();
    const payment = await ctx.payments.findById(req.tenant.tenantId, paymentId);
    if (!payment || payment.userId !== req.user.userId) {
      throw new KaziBetError('NOT_FOUND', 'Payment transaction not found.');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        paymentId: payment.id,
        status: payment.status,
        amountCents: payment.amountCents.toString(),
        currency: payment.currency,
        updatedAt: payment.updatedAt
      })
    );
  });

  // POST /api/v1/cashier/withdraw
  router.post('/api/v1/cashier/withdraw', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const { amountCents, destinationAccount, providerName = 'MPESA_DARAJA' } = req.body as {
      amountCents: string | number;
      destinationAccount: string;
      providerName?: string;
    };

    if (!amountCents || BigInt(amountCents) <= 0n) {
      throw new KaziBetError('VALIDATION_FAILED', 'Positive withdrawal amountCents is required.');
    }
    if (!destinationAccount) {
      throw new KaziBetError('VALIDATION_FAILED', 'destinationAccount phone number is required.');
    }

    const idempotencyKey =
      (req.headers['idempotency-key'] as string) ||
      (req.body?.['idempotencyKey'] as string) ||
      `wth-${generateId()}`;

    const payment = await paymentService.initiateWithdrawal({
      tenantId: req.tenant.tenantId,
      userId: req.user.userId,
      providerName,
      amountCents: BigInt(amountCents),
      currency: req.tenant.currency,
      destinationAccount,
      idempotencyKey
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        paymentId: payment.id,
        status: payment.status,
        amountCents: payment.amountCents.toString(),
        currency: payment.currency
      })
    );
  });
}
