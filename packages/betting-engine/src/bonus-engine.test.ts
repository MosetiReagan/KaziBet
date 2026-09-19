import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { LedgerEngine } from '@kazibet/ledger';
import { TenantContextHolder } from '@kazibet/tenant';
import { BonusEngine } from './bonus-engine.js';

describe('BonusEngine Suite', () => {
  const tenantId = 'tenant-bonus-test';
  const userId = 'user-bonus-1';

  async function setup() {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);
    const bonusEngine = new BonusEngine(db, ledger);
    const ctx = db.getContext();

    // Create tenant
    await ctx.tenants.create({
      id: tenantId,
      code: 'bonus-test',
      name: 'Bonus Sports',
      domain: 'bonus.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Create user
    await ctx.users.create(tenantId, {
      id: userId,
      tenantId,
      phoneNumber: '+254711000999',
      passwordHash: 'hashed_password',
      status: 'ACTIVE',
      kycTier: 1,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Create initial wallet
    await ctx.wallets.create(tenantId, {
      id: 'w-bonus-1',
      tenantId,
      userId,
      currency: 'KES',
      availableCents: 50000n, // 500 KES
      heldCents: 0n,
      bonusCents: 0n,
      version: 1n,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { db, ledger, bonusEngine, ctx };
  }

  test('Deposit Match Bonus: grants bonus balance and posts balanced ledger entry', async () => {
    const { bonusEngine, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'bonus-test', domain: 'bonus.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        // Deposit 1,000 KES (100,000 cents) with 100% match, 3x wagering requirement, min odds 1.50
        const userBonus = await bonusEngine.grantDepositMatchBonus({
          tenantId,
          userId,
          depositCents: 100000n,
          matchPercentage: 100,
          wagerRequirementMultiplier: 3,
          minOdds: 1.50,
          validityDays: 30
        });

        assert.equal(userBonus.initialBonusCents, 100000n);
        assert.equal(userBonus.requiredWagerCents, 300000n); // 3x turnover = 300,000 cents
        assert.equal(userBonus.status, 'ACTIVE');

        // Check wallet
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.bonusCents, 100000n);
        assert.equal(wallet?.availableCents, 50000n);

        // Check ledger balance invariant
        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
        assert.equal(audit.totalDebits, audit.totalCredits);
      }
    );
  });

  test('Rollover tracking: wagers at eligible odds accumulate towards rollover and convert bonus to cash', async () => {
    const { bonusEngine, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'bonus-test', domain: 'bonus.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        // Grant 200 KES (20,000 cents) bonus, 3x turnover (60,000 cents required), min odds 1.50
        await bonusEngine.grantDepositMatchBonus({
          tenantId,
          userId,
          depositCents: 20000n,
          matchPercentage: 100,
          wagerRequirementMultiplier: 3,
          minOdds: 1.50
        });

        // 1. Wager at odds 1.30 (below min odds 1.50) -> NOT counted
        const res1 = await bonusEngine.recordWagerForBonus({
          tenantId,
          userId,
          stakeCents: 30000n,
          odds: 1.30
        });
        assert.equal(res1.eligible, false);
        assert.equal(res1.rolledOver, false);
        assert.equal(res1.remainingWagerCents, 60000n);

        // 2. Wager at odds 1.80 for 400 KES (40,000 cents) -> counted (20,000 cents remaining)
        const res2 = await bonusEngine.recordWagerForBonus({
          tenantId,
          userId,
          stakeCents: 40000n,
          odds: 1.80
        });
        assert.equal(res2.eligible, true);
        assert.equal(res2.rolledOver, false);
        assert.equal(res2.remainingWagerCents, 20000n);

        // 3. Wager at odds 2.00 for 250 KES (25,000 cents) -> fulfills turnover requirement!
        const res3 = await bonusEngine.recordWagerForBonus({
          tenantId,
          userId,
          stakeCents: 25000n,
          odds: 2.00
        });
        assert.equal(res3.eligible, true);
        assert.equal(res3.rolledOver, true);
        assert.equal(res3.remainingWagerCents, 0n);

        // Check wallet: bonus should have moved to available cash!
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.bonusCents, 0n);
        // Initial available 50,000 + 20,000 converted bonus = 70,000 cents
        assert.equal(wallet?.availableCents, 70000n);

        // Critical ledger invariant check: balanced DR == CR
        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
        assert.equal(audit.totalDebits, audit.totalCredits);
      }
    );
  });

  test('Bonus expiration: forfeits unfulfilled bonus and reverses ledger liability', async () => {
    const { bonusEngine, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'bonus-test', domain: 'bonus.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        // Grant bonus that expires immediately
        const bonus = await bonusEngine.grantDepositMatchBonus({
          tenantId,
          userId,
          depositCents: 10000n,
          matchPercentage: 100,
          wagerRequirementMultiplier: 3,
          validityDays: 0 // expires immediately
        });

        // Set expiresAt in past
        bonus.expiresAt = new Date(Date.now() - 10000);

        const expired = await bonusEngine.checkExpiration(tenantId, userId);
        assert.equal(expired.length, 1);
        assert.equal(expired[0]?.status, 'EXPIRED');

        // Wallet bonus balance cleared
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.bonusCents, 0n);

        // Ledger remains strictly balanced
        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
        assert.equal(audit.totalDebits, audit.totalCredits);
      }
    );
  });

  test('Free bet settlement: stake is not returned in payout and 20% WHT applies to net winnings', () => {
    // 1. Free bet of 100 KES (10,000 cents) at odds 3.50
    // Net profit = 10,000 * (3.50 - 1.0) = 25,000 cents
    // 20% WHT tax = 5,000 cents
    // Net user payout = 20,000 cents
    const res = BonusEngine.settleFreeBet(10000n, 3.50, 0.20);
    assert.equal(res.grossWinningsCents, 25000n);
    assert.equal(res.taxWithheldCents, 5000n);
    assert.equal(res.netUserPayoutCents, 20000n);

    // 2. Free bet that loses or odds <= 1.0 -> 0 payout
    const lossRes = BonusEngine.settleFreeBet(10000n, 1.0, 0.20);
    assert.equal(lossRes.grossWinningsCents, 0n);
    assert.equal(lossRes.taxWithheldCents, 0n);
    assert.equal(lossRes.netUserPayoutCents, 0n);
  });
});
