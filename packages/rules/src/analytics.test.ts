import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { AnalyticsAggregator } from './analytics-aggregator.js';
import { CmsThemeResolver } from './cms-theme.js';

describe('Analytics & White-Label CMS Suite', () => {
  const tenantId = 'tenant-analytics-test';

  test('computes turnover, GGR, NGR, and active bettor metrics correctly', async () => {
    const db = new InMemoryDatabase();
    const analytics = new AnalyticsAggregator(db);
    const ctx = db.getContext();

    await ctx.tenants.create({
      id: tenantId,
      code: 'analytics-test',
      name: 'Analytics Test Book',
      domain: 'analytics.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'analytics-test',
        domain: 'analytics.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Bet 1: Lost 100 KES (Turnover: 10,000, Payout: 0)
        await ctx.bets.create(tenantId, {
          id: 'b-1',
          tenantId,
          betSlipId: 's-1',
          userId: 'u-1',
          stakeCents: 10000n,
          odds: 2.0,
          potentialPayoutCents: 20000n,
          payoutCents: 0n,
          status: 'LOST',
          createdAt: new Date()
        });

        // Bet 2: Won 150 KES from 50 KES stake (Turnover: 5,000, Payout: 15,000)
        await ctx.bets.create(tenantId, {
          id: 'b-2',
          tenantId,
          betSlipId: 's-2',
          userId: 'u-2',
          stakeCents: 5000n,
          odds: 3.0,
          potentialPayoutCents: 15000n,
          payoutCents: 15000n,
          status: 'WON',
          createdAt: new Date()
        });

        // Total Turnover = 15,000 cents (150 KES)
        // Total Payouts = 15,000 cents (150 KES)
        // GGR = 0 cents
        const metrics = await analytics.computeFinancialMetrics(tenantId);
        assert.equal(metrics.totalTurnoverCents, 15000n);
        assert.equal(metrics.totalPayoutsCents, 15000n);
        assert.equal(metrics.ggrCents, 0n);
        assert.equal(metrics.totalBetsCount, 2);
        assert.equal(metrics.activeBettorsCount, 2);
      }
    );
  });

  test('CmsThemeResolver defaults to modern sportsbook styling', () => {
    const theme = CmsThemeResolver.resolveTheme();
    assert.equal(theme.siteTitle, 'KaziBet Sportsbook');
    assert.equal(theme.primaryColor, '#006600');
    assert.ok(theme.heroBanner.ctaText);
  });
});
