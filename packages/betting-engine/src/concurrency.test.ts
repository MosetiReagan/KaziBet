import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder, TenantContext } from '@kazibet/tenant';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from './bet-placement-service.js';

describe('Bet Placement Concurrency & Overspend Protection Suite', () => {
  test('fires 50 parallel bets at a wallet with funds for 10 and exactly 10 succeed', async () => {
    const db = new InMemoryDatabase();
    const oddsEngine = new OddsEngine(() => db.getContext());
    const bettingService = new BetPlacementService(db, oddsEngine);

    const tenantId = 'tenant_concurrency_test';
    const tenantCtx: TenantContext = {
      tenantId,
      code: 'concurrency-tenant',
      domain: 'concurrency.kazibet.com',
      currency: 'KES',
      capabilityStatus: 'SANDBOX'
    };

    await TenantContextHolder.run(tenantCtx, async () => {
      // 1. Setup Tenant & User
      await db.getContext().tenants.create({
        id: tenantId,
        code: 'concurrency-tenant',
        name: 'Concurrency Sports',
        domain: 'concurrency.kazibet.com',
        defaultCurrency: 'KES',
        capabilityStatus: 'SANDBOX',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const user = await db.getContext().users.create(tenantId, {
        id: 'user_concurrency_1',
        tenantId,
        passwordHash: 'hashed',
        status: 'ACTIVE',
        kycTier: 1,
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // 2. Fund wallet with exactly 10,000 cents (funds for 10 bets of 1,000 cents each)
      const wallet = await db.getContext().wallets.create(tenantId, {
        id: 'wallet_concurrency_1',
        tenantId,
        userId: user.id,
        currency: 'KES',
        availableCents: 10000n,
        heldCents: 0n,
        bonusCents: 0n,
        version: 1n,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // 3. Create Event & Market
      const event = await db.getContext().events.create(tenantId, {
        id: 'event_concurrency_1',
        tenantId,
        competitionId: 'comp_1',
        homeTeamId: 'team_1',
        awayTeamId: 'team_2',
        scheduledStart: new Date(Date.now() + 3600000),
        status: 'SCHEDULED',
        homeScore: 0,
        awayScore: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const { market, selections } = await oddsEngine.createMarketWithSelections({
        tenantId,
        eventId: event.id,
        marketType: '1X2',
        name: 'Full Time Result',
        selections: [
          { name: 'Team 1', odds: 2.0 },
          { name: 'Draw', odds: 3.0 },
          { name: 'Team 2', odds: 4.0 }
        ]
      });

      const targetSelection = selections[0]!;

      // 4. Launch 50 parallel bet placement requests concurrently
      const betPromises = Array.from({ length: 50 }, (_, i) =>
        bettingService.placeBet({
          tenantId,
          userId: user.id,
          type: 'SINGLE',
          stakeCents: 1000n, // 10 bets * 1,000 cents = 10,000 cents
          idempotencyKey: `concurrent-bet-key-${i}`,
          legs: [
            {
              selectionId: targetSelection.id,
              marketId: market.id,
              eventId: event.id,
              odds: 2.0
            }
          ]
        })
      );

      const results = await Promise.allSettled(betPromises);

      const succeeded = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      // Acceptance Criteria: exactly 10 succeed and 40 fail due to insufficient funds!
      assert.equal(succeeded.length, 10, `Expected exactly 10 successful bets, got ${succeeded.length}`);
      assert.equal(failed.length, 40, `Expected exactly 40 rejected bets, got ${failed.length}`);

      // Verify wallet balance invariant
      const updatedWallet = await db.getContext().wallets.findById(tenantId, wallet.id);
      assert.equal(updatedWallet?.availableCents, 0n, 'Available cents must be zero after 10 bets');
      assert.equal(updatedWallet?.heldCents, 10000n, 'Held cents must equal exactly 10,000 cents');

      // Verify bets count in database
      const createdBets = await db.getContext().bets.findMany(tenantId, { userId: user.id });
      assert.equal(createdBets.length, 10, 'Total placed bets recorded in DB must be exactly 10');
    });
  });
});
