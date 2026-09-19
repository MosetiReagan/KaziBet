import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from './bet-placement-service.js';
import { InsufficientFundsError, KaziBetError } from '@kazibet/shared';

describe('BetPlacementService Suite', () => {
  const tenantId = 'tenant-bet-test';
  const userId = 'user-bettor-1';

  async function setupEnvironment() {
    const db = new InMemoryDatabase();
    const ctx = db.getContext();
    const oddsEngine = new OddsEngine(() => db.getContext());
    const service = new BetPlacementService(db, oddsEngine);

    // Seed tenant
    await ctx.tenants.create({
      id: tenantId,
      code: 'bet-test',
      name: 'Bet Test Sports',
      domain: 'bet-test.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Seed user
    await ctx.users.create(tenantId, {
      id: userId,
      tenantId,
      email: 'bettor@test.com',
      passwordHash: 'hash',
      status: 'ACTIVE',
      kycTier: 1,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Seed wallet with 1,000.00 KES (100,000 cents)
    await ctx.wallets.create(tenantId, {
      id: 'wallet-1',
      tenantId,
      userId,
      currency: 'KES',
      availableCents: 100000n,
      heldCents: 0n,
      bonusCents: 0n,
      version: 1n,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Seed markets inside tenant context
    const { m1, s1, m2, s2 } = await TenantContextHolder.run(
      {
        tenantId,
        code: 'bet-test',
        domain: 'bet-test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Seed event 1 & market 1
        const res1 = await oddsEngine.createMarketWithSelections({
          tenantId,
          eventId: 'event-1',
          marketType: '1X2',
          name: 'Match 1 Winner',
          selections: [
            { name: 'Home', odds: 2.0 },
            { name: 'Away', odds: 3.5 }
          ]
        });

        // Seed event 2 & market 2
        const res2 = await oddsEngine.createMarketWithSelections({
          tenantId,
          eventId: 'event-2',
          marketType: '1X2',
          name: 'Match 2 Winner',
          selections: [
            { name: 'Home', odds: 1.5 },
            { name: 'Away', odds: 5.0 }
          ]
        });

        return { m1: res1.market, s1: res1.selections, m2: res2.market, s2: res2.selections };
      }
    );

    return { db, ctx, oddsEngine, service, m1, s1, m2, s2 };
  }

  test('places single bet and reserves wallet hold successfully', async () => {
    const { service, s1, m1, ctx } = await setupEnvironment();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'bet-test',
        domain: 'bet-test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const homeSel = s1[0]!;
        const stake = 20000n; // 200.00 KES

        const result = await service.placeBet({
          tenantId,
          userId,
          type: 'SINGLE',
          stakeCents: stake,
          idempotencyKey: 'idem-single-1',
          legs: [{
            selectionId: homeSel.id,
            marketId: m1.id,
            eventId: 'event-1',
            odds: homeSel.currentOdds
          }]
        });

        assert.ok(result.betSlip.id);
        assert.equal(result.bet.odds, 2.0);
        assert.equal(result.bet.potentialPayoutCents, 40000n); // 200 * 2 = 400 KES
        assert.equal(result.remainingAvailableCents, 80000n); // 1000 - 200 = 800 KES

        // Verify wallet state in DB
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 80000n);
        assert.equal(wallet?.heldCents, 20000n);

        // Verify outbox event emitted
        const events = await ctx.outboxEvents.findMany(tenantId, { eventName: 'BetPlaced' });
        assert.equal(events.length, 1);
      }
    );
  });

  test('guarantees idempotency: repeated request returns existing bet without double-deduction', async () => {
    const { service, s1, m1, ctx } = await setupEnvironment();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'bet-test',
        domain: 'bet-test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const homeSel = s1[0]!;
        const req = {
          tenantId,
          userId,
          type: 'SINGLE' as const,
          stakeCents: 10000n, // 100 KES
          idempotencyKey: 'idem-repeat-test',
          legs: [{
            selectionId: homeSel.id,
            marketId: m1.id,
            eventId: 'event-1',
            odds: homeSel.currentOdds
          }]
        };

        const res1 = await service.placeBet(req);
        const res2 = await service.placeBet(req);

        // Both calls return identical bet slip ID
        assert.equal(res1.betSlip.id, res2.betSlip.id);

        // Check wallet was deducted only ONCE
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 90000n); // 1000 - 100 = 900 KES, NOT 800 KES!
      }
    );
  });

  test('rejects bet when available funds are insufficient', async () => {
    const { service, s1, m1 } = await setupEnvironment();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'bet-test',
        domain: 'bet-test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const homeSel = s1[0]!;
        await assert.rejects(
          async () =>
            await service.placeBet({
              tenantId,
              userId,
              type: 'SINGLE',
              stakeCents: 500000n, // 5,000 KES (wallet only has 1,000 KES)
              idempotencyKey: 'idem-overdraft',
              legs: [{
                selectionId: homeSel.id,
                marketId: m1.id,
                eventId: 'event-1',
                odds: homeSel.currentOdds
              }]
            }),
          InsufficientFundsError
        );
      }
    );
  });

  test('rejects accumulator with correlated selections from same event', async () => {
    const { service, s1, m1 } = await setupEnvironment();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'bet-test',
        domain: 'bet-test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Pick Home and Away from same event-1
        await assert.rejects(
          async () =>
            await service.placeBet({
              tenantId,
              userId,
              type: 'ACCUMULATOR',
              stakeCents: 5000n,
              idempotencyKey: 'idem-correlated',
              legs: [
                { selectionId: s1[0]!.id, marketId: m1.id, eventId: 'event-1', odds: s1[0]!.currentOdds },
                { selectionId: s1[1]!.id, marketId: m1.id, eventId: 'event-1', odds: s1[1]!.currentOdds }
              ]
            }),
          /Correlated market error/
        );
      }
    );
  });
});
