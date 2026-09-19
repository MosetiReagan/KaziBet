import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { RiskEngine } from './risk-engine.js';

describe('RiskEngine Anomaly Detection', () => {
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
});
