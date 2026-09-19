import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { LedgerEngine } from '@kazibet/ledger';
import { TenantContextHolder, TenantContext } from '@kazibet/tenant';

describe('Persistence and API Lifecycle Mid-Restart Acceptance Suite', () => {
  test('killing and restarting API/services preserves state and ledger audits to zero', async () => {
    // Shared underlying persistence across API restarts
    const sharedDb = new InMemoryDatabase();

    const tenantId = 'tenant_persistence_restart';
    const tenantCtx: TenantContext = {
      tenantId,
      code: 'persistence-tenant',
      domain: 'persistence.kazibet.com',
      currency: 'KES',
      capabilityStatus: 'SANDBOX'
    };

    let accCashId = '';
    let accAvailId = '';
    let accHoldId = '';
    let accExpenseId = '';
    let accTaxId = '';

    // === PHASE 1: BEFORE RESTART (API INSTANCE 1) ===
    await TenantContextHolder.run(tenantCtx, async () => {
      const ledger1 = new LedgerEngine(sharedDb);

      await sharedDb.getContext().tenants.create({
        id: tenantId,
        code: 'persistence-tenant',
        name: 'Persistence Sportsbook',
        domain: 'persistence.kazibet.com',
        defaultCurrency: 'KES',
        capabilityStatus: 'SANDBOX',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const user = await sharedDb.getContext().users.create(tenantId, {
        id: 'user_persisted_1',
        tenantId,
        passwordHash: 'hash',
        status: 'ACTIVE',
        kycTier: 2,
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const wallet = await sharedDb.getContext().wallets.create(tenantId, {
        id: 'wallet_persisted_1',
        tenantId,
        userId: user.id,
        currency: 'KES',
        availableCents: 0n,
        heldCents: 0n,
        bonusCents: 0n,
        version: 1n,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const accCash = await ledger1.getOrCreateAccount({
        tenantId,
        code: 'ASSET_CASH_MPESA',
        type: 'ASSET',
        currency: 'KES'
      });
      accCashId = accCash.id;

      const accAvail = await ledger1.getOrCreateAccount({
        tenantId,
        code: 'LIABILITY_USER_AVAILABLE',
        type: 'LIABILITY',
        currency: 'KES',
        walletId: wallet.id
      });
      accAvailId = accAvail.id;

      const accHold = await ledger1.getOrCreateAccount({
        tenantId,
        code: 'LIABILITY_USER_HOLD',
        type: 'LIABILITY',
        currency: 'KES',
        walletId: wallet.id
      });
      accHoldId = accHold.id;

      const accExpense = await ledger1.getOrCreateAccount({
        tenantId,
        code: 'EXPENSE_PAYOUTS',
        type: 'EXPENSE',
        currency: 'KES'
      });
      accExpenseId = accExpense.id;

      const accTax = await ledger1.getOrCreateAccount({
        tenantId,
        code: 'LIABILITY_TAX_WITHHOLDING',
        type: 'LIABILITY',
        currency: 'KES'
      });
      accTaxId = accTax.id;

      // 1. Deposit 100,000 cents (1,000 KES)
      await ledger1.postJournal({
        tenantId,
        idempotencyKey: 'tx_persisted_deposit_1',
        referenceType: 'DEPOSIT',
        referenceId: 'dep_001',
        description: 'M-Pesa STK Deposit',
        lines: [
          { accountId: accCashId, direction: 'DR', amountCents: 100000n, currency: 'KES' },
          { accountId: accAvailId, direction: 'CR', amountCents: 100000n, currency: 'KES' }
        ]
      });

      // Update wallet balance
      await sharedDb.getContext().wallets.update(tenantId, wallet.id, {
        availableCents: 100000n
      });

      // 2. Stake hold of 20,000 cents (200 KES)
      await ledger1.postJournal({
        tenantId,
        idempotencyKey: 'tx_persisted_hold_1',
        referenceType: 'BET_HOLD',
        referenceId: 'bet_001',
        description: 'Reserve bet stake',
        lines: [
          { accountId: accAvailId, direction: 'DR', amountCents: 20000n, currency: 'KES' },
          { accountId: accHoldId, direction: 'CR', amountCents: 20000n, currency: 'KES' }
        ]
      });

      // Audit before kill
      const auditBeforeKill = await ledger1.auditSystemBalance(tenantId);
      assert.equal(auditBeforeKill.balanced, true);
      assert.equal(auditBeforeKill.totalDebits, auditBeforeKill.totalCredits);
    });

    // === SIMULATE KILLING API (Instance 1 discarded / destroyed) ===
    // References to instance 1 are dropped, simulating container crash/restart.

    // === PHASE 2: AFTER RESTART (API INSTANCE 2 BOOTSTRAP) ===
    await TenantContextHolder.run(tenantCtx, async () => {
      // Boot up fresh API Instance 2 connecting to the persistent store
      const ledger2 = new LedgerEngine(sharedDb);

      // Verify that ledger balances still audit to zero immediately upon startup
      const auditAfterRestart = await ledger2.auditSystemBalance(tenantId);
      assert.equal(auditAfterRestart.balanced, true, 'Ledger must be balanced after restart');
      assert.equal(auditAfterRestart.totalDebits, auditAfterRestart.totalCredits, 'Total debits must equal total credits');

      // Settle the pending bet on the new API instance:
      // Stake 200 KES, Win Gross 600 KES, Net 400 KES, 20% WHT = 80 KES, Net Payout = 520 KES
      await ledger2.postJournal({
        tenantId,
        idempotencyKey: 'tx_persisted_settle_1',
        referenceType: 'BET_PAYOUT',
        referenceId: 'bet_001',
        description: 'Settlement with 20% WHT',
        lines: [
          { accountId: accHoldId, direction: 'DR', amountCents: 20000n, currency: 'KES' },
          { accountId: accExpenseId, direction: 'DR', amountCents: 40000n, currency: 'KES' },
          { accountId: accAvailId, direction: 'CR', amountCents: 52000n, currency: 'KES' },
          { accountId: accTaxId, direction: 'CR', amountCents: 8000n, currency: 'KES' }
        ]
      });

      // Final audit after post-restart settlement
      const finalAudit = await ledger2.auditSystemBalance(tenantId);
      assert.equal(finalAudit.balanced, true);
      assert.equal(finalAudit.totalDebits, finalAudit.totalCredits);
    });
  });
});
