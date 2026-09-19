import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { RiskEngine } from './risk-engine.js';

describe('RiskEngine Anomaly Detection, Multi-Account & Liability Suite', () => {
  const tenantId = 'tenant-risk-test';
  const userId = 'user-risk-1';

  async function setup() {
    const db = new InMemoryDatabase();
    const riskEngine = new RiskEngine(db);
    const ctx = db.getContext();

    await ctx.tenants.create({
      id: tenantId,
      code: 'risk-test',
      name: 'Risk Test Sports',
      domain: 'risk.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { db, ctx, riskEngine };
  }

  test('normal activity returns ALLOW and zero score', async () => {
    const { riskEngine } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'risk-test',
        domain: 'risk.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const evalRes = await riskEngine.evaluateUserActivity(tenantId, userId);
        assert.equal(evalRes.compositeScore, 0);
        assert.equal(evalRes.recommendedAction, 'ALLOW');
        assert.equal(evalRes.signals.length, 0);
      }
    );
  });

  test('detects rapid betting velocity and flags risk case for review', async () => {
    const { ctx, riskEngine } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'risk-test',
        domain: 'risk.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Place 5 bets right now
        for (let i = 0; i < 5; i++) {
          await ctx.bets.create(tenantId, {
            id: `bet-rapid-${i}`,
            tenantId,
            betSlipId: `slip-${i}`,
            userId,
            stakeCents: 1000n,
            odds: 2.0,
            potentialPayoutCents: 2000n,
            payoutCents: 0n,
            status: 'PLACED',
            createdAt: new Date()
          });
        }

        const evalRes = await riskEngine.evaluateUserActivity(tenantId, userId);
        assert.ok(evalRes.compositeScore >= 0.8);
        assert.equal(evalRes.recommendedAction, 'REVIEW');
        assert.equal(evalRes.requiresManualReview, true);

        // Verify risk case stored in database
        const cases = await ctx.riskCases.findMany(tenantId, { userId });
        assert.equal(cases.length, 1);
        assert.equal(cases[0]?.signalType, 'RAPID_BET_VELOCITY');
        assert.equal(cases[0]?.status, 'OPEN');
      }
    );
  });

  test('multi-account detection: flags shared device fingerprint and payment account name', async () => {
    const { ctx, riskEngine } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'risk-test',
        domain: 'risk.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // 1. User 1 connects from mobile device A
        await riskEngine.recordUserSession({
          tenantId,
          userId: 'user-syndicate-1',
          ipAddress: '197.232.61.10',
          deviceFingerprint: 'device-fingerprint-nairobi-01',
          mpesaPhoneName: 'Kamau Waweru'
        });

        // 2. User 2 connects from SAME device fingerprint (syndicate / multi-account)
        const res2 = await riskEngine.recordUserSession({
          tenantId,
          userId: 'user-syndicate-2',
          ipAddress: '197.232.61.88', // different IP
          deviceFingerprint: 'device-fingerprint-nairobi-01', // SAME device
          mpesaPhoneName: 'Otieno James'
        });

        assert.equal(res2.recommendedAction, 'REVIEW');
        assert.equal(res2.requiresManualReview, true);
        assert.ok(res2.compositeScore >= 0.9);

        const deviceSignal = res2.signals.find(s => s.type === 'MULTI_ACCOUNT_DEVICE_SHARING');
        assert.ok(deviceSignal);
        assert.equal(deviceSignal?.severity, 'CRITICAL');

        // Check that a risk case was created for user-syndicate-2
        const cases = await ctx.riskCases.findMany(tenantId, { userId: 'user-syndicate-2' });
        assert.equal(cases.length, 1);
        assert.equal(cases[0]?.signalType, 'MULTI_ACCOUNT_DEVICE_SHARING');
        assert.deepEqual(cases[0]?.metadata?.['linkedUserIds'], ['user-syndicate-1']);

        // 3. User 3 connects with same M-Pesa registered name
        const res3 = await riskEngine.recordUserSession({
          tenantId,
          userId: 'user-syndicate-3',
          ipAddress: '102.219.210.5',
          deviceFingerprint: 'device-fingerprint-diff-99',
          mpesaPhoneName: 'Kamau Waweru' // Matches user 1
        });

        const paySignal = res3.signals.find(s => s.type === 'MULTI_ACCOUNT_PAYMENT_SHARING');
        assert.ok(paySignal);
        assert.equal(paySignal?.severity, 'HIGH');
      }
    );
  });

  test('liability tracking & exposure limits: automatically suspends market when exposure limit breached', async () => {
    const { ctx, riskEngine } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'risk-test',
        domain: 'risk.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Create event, market with exposure ceiling of KES 500 (50,000 cents)
        const event = await ctx.events.create(tenantId, {
          id: 'evt-risk-1',
          tenantId,
          competitionId: 'comp-pl',
          homeTeamId: 'team-arsenal',
          awayTeamId: 'team-chelsea',
          scheduledStart: new Date(),
          status: 'LIVE',
          homeScore: 0,
          awayScore: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const market = await ctx.markets.create(tenantId, {
          id: 'mkt-risk-1',
          tenantId,
          eventId: event.id,
          marketType: '1X2',
          name: 'Match Winner',
          status: 'ACTIVE',
          parameters: { maxExposureCents: 50000n }, // 500 KES limit
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const selHome = await ctx.selections.create({
          id: 'sel-arsenal-win',
          marketId: market.id,
          name: 'Arsenal',
          currentOdds: 3.0,
          version: 1,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // 1. First wager: stake 10,000 cents @ odds 3.0 (potential payout: 30,000, net liability: 20,000)
        // 20,000 <= 50,000 -> Allowed
        const val1 = await riskEngine.validateAndTrackExposure({
          tenantId,
          selectionId: selHome.id,
          stakeCents: 10000n,
          potentialPayoutCents: 30000n,
          maxExposureLimitCents: 50000n
        });
        assert.equal(val1.allowed, true);
        assert.equal(val1.marketSuspended, false);

        // Record bet 1 in database
        const bet1 = await ctx.bets.create(tenantId, {
          id: 'bet-exposure-1',
          tenantId,
          betSlipId: 'slip-exp-1',
          userId: 'user-exp-1',
          stakeCents: 10000n,
          odds: 3.0,
          potentialPayoutCents: 30000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });
        await ctx.betLegs.create({
          id: 'leg-exp-1',
          betId: bet1.id,
          eventId: event.id,
          marketId: market.id,
          selectionId: selHome.id,
          acceptedOdds: 3.0,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // Verify selection exposure
        const expAfterBet1 = await riskEngine.calculateSelectionExposure(tenantId, selHome.id);
        assert.equal(expAfterBet1.netLiabilityCents, 20000n);

        // 2. Second wager: stake 15,000 cents @ odds 3.0 (net liability: 30,000 cents)
        // Projected: 20,000 + 30,000 = 50,000 cents <= 50,000 limit -> Allowed
        const val2 = await riskEngine.validateAndTrackExposure({
          tenantId,
          selectionId: selHome.id,
          stakeCents: 15000n,
          potentialPayoutCents: 45000n,
          maxExposureLimitCents: 50000n
        });
        assert.equal(val2.allowed, true);
        assert.equal(val2.projectedExposureCents, 50000n);

        // Record bet 2 in database
        const bet2 = await ctx.bets.create(tenantId, {
          id: 'bet-exposure-2',
          tenantId,
          betSlipId: 'slip-exp-2',
          userId: 'user-exp-2',
          stakeCents: 15000n,
          odds: 3.0,
          potentialPayoutCents: 45000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });
        await ctx.betLegs.create({
          id: 'leg-exp-2',
          betId: bet2.id,
          eventId: event.id,
          marketId: market.id,
          selectionId: selHome.id,
          acceptedOdds: 3.0,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // 3. Third wager: stake 10,000 cents @ odds 2.0 (net liability: 10,000 cents)
        // Projected: 50,000 + 10,000 = 60,000 cents > 50,000 limit -> REJECTED & SUSPENDED!
        const val3 = await riskEngine.validateAndTrackExposure({
          tenantId,
          selectionId: selHome.id,
          stakeCents: 10000n,
          potentialPayoutCents: 20000n,
          maxExposureLimitCents: 50000n
        });

        assert.equal(val3.allowed, false);
        assert.equal(val3.marketSuspended, true);
        assert.equal(val3.projectedExposureCents, 60000n);

        // Check market in database: MUST be SUSPENDED
        const updatedMarket = await ctx.markets.findById(tenantId, market.id);
        assert.equal(updatedMarket?.status, 'SUSPENDED');
        assert.equal(updatedMarket?.suspensionReason, 'EXPOSURE_LIMIT_EXCEEDED');

        // Check trading risk case created
        const riskCases = await ctx.riskCases.findMany(tenantId, {
          signalType: 'MARKET_EXPOSURE_LIMIT_EXCEEDED'
        });
        assert.equal(riskCases.length, 1);
        assert.equal(riskCases[0]?.severity, 'HIGH');
      }
    );
  });
});
