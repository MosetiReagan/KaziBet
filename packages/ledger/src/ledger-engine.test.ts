import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine } from './ledger-engine.js';
import { STANDARD_ACCOUNTS } from './account-codes.js';
import { LedgerUnbalancedError } from '@kazibet/shared';

describe('LedgerEngine Double-Entry Accounting', () => {
  const tenantId = 'tenant-ledger-test';

  test('posts balanced deposit journal and derives account balance accurately', async () => {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'ledger-test',
        domain: 'ledger.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Create Clearing Asset account and User Liability account
        const clearingDef = STANDARD_ACCOUNTS.PAYMENT_CLEARING('MPESA');
        const userAvailDef = STANDARD_ACCOUNTS.USER_AVAILABLE('user-alice');

        const clearingAcc = await ledger.getOrCreateAccount({
          tenantId,
          code: clearingDef.code,
          type: clearingDef.type,
          currency: 'KES'
        });

        const userAvailAcc = await ledger.getOrCreateAccount({
          tenantId,
          code: userAvailDef.code,
          type: userAvailDef.type,
          currency: 'KES'
        });

        // Deposit: 5,000 KES (500,000 cents)
        // DR Clearing Asset: 500,000
        // CR User Available Liability: 500,000
        const depositAmount = 500000n;
        const tx = await ledger.postJournal({
          tenantId,
          idempotencyKey: 'dep-tx-001',
          referenceType: 'DEPOSIT',
          referenceId: 'mpesa-ref-12345',
          description: 'M-Pesa deposit for user Alice',
          lines: [
            { accountId: clearingAcc.id, direction: 'DR', amountCents: depositAmount, currency: 'KES' },
            { accountId: userAvailAcc.id, direction: 'CR', amountCents: depositAmount, currency: 'KES' }
          ]
        });

        assert.ok(tx.id);

        // Derive balances
        const clearingBal = await ledger.getDerivedAccountBalance(tenantId, clearingAcc.id);
        const userBal = await ledger.getDerivedAccountBalance(tenantId, userAvailAcc.id);

        assert.equal(clearingBal, 500000n);
        assert.equal(userBal, 500000n);

        // System-wide audit
        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
        assert.equal(audit.totalDebits, 500000n);
        assert.equal(audit.totalCredits, 500000n);
      }
    );
  });

  test('strictly rejects unbalanced journal entries', async () => {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'ledger-test',
        domain: 'ledger.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const acc1 = await ledger.getOrCreateAccount({
          tenantId,
          code: 'AC-1',
          type: 'ASSET',
          currency: 'KES'
        });
        const acc2 = await ledger.getOrCreateAccount({
          tenantId,
          code: 'AC-2',
          type: 'LIABILITY',
          currency: 'KES'
        });

        // DR 100 vs CR 90 -> Unbalanced!
        await assert.rejects(
          async () =>
            await ledger.postJournal({
              tenantId,
              idempotencyKey: 'unbalanced-tx-1',
              referenceType: 'TEST',
              referenceId: 'ref-1',
              lines: [
                { accountId: acc1.id, direction: 'DR', amountCents: 100n, currency: 'KES' },
                { accountId: acc2.id, direction: 'CR', amountCents: 90n, currency: 'KES' }
              ]
            }),
          LedgerUnbalancedError
        );
      }
    );
  });
});
