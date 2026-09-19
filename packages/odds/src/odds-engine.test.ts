import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { OddsEngine } from './odds-engine.js';
import { MarketSuspendedError, OddsChangedError } from '@kazibet/shared';

describe('Odds Engine & Market Dynamics', () => {
  const tenantId = 'tenant-odds-test';

  test('creates 1X2 market and updates odds with versioning', async () => {
    const db = new InMemoryDatabase();
    const oddsEngine = new OddsEngine(() => db.getContext());

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'odds-test',
        domain: 'odds.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const { market, selections } = await oddsEngine.createMarketWithSelections({
          tenantId,
          eventId: 'evt-101',
          marketType: '1X2',
          name: 'Match Winner',
          selections: [
            { name: 'Arsenal', odds: 1.95 },
            { name: 'Draw', odds: 3.40 },
            { name: 'Chelsea', odds: 4.10 }
          ]
        });

        assert.equal(selections.length, 3);
        const homeSel = selections[0]!;
        assert.equal(homeSel.currentOdds, 1.95);
        assert.equal(homeSel.version, 1);

        // Update home odds to 2.10
        const updated = await oddsEngine.updateSelectionOdds(tenantId, homeSel.id, 2.10, 'LATE_LINEUP_CHANGE');
        assert.equal(updated.currentOdds, 2.10);
        assert.equal(updated.version, 2);

        // Verify that betting with stale odds (1.95) throws OddsChangedError
        await assert.rejects(
          async () => await oddsEngine.verifySelectionForBetting(tenantId, homeSel.id, 1.95),
          OddsChangedError
        );

        // Verifying with new odds (2.10) succeeds
        const verified = await oddsEngine.verifySelectionForBetting(tenantId, homeSel.id, 2.10);
        assert.equal(verified.selection.currentOdds, 2.10);
      }
    );
  });

  test('suspending market blocks selection verification', async () => {
    const db = new InMemoryDatabase();
    const oddsEngine = new OddsEngine(() => db.getContext());

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'odds-test',
        domain: 'odds.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const { market, selections } = await oddsEngine.createMarketWithSelections({
          tenantId,
          eventId: 'evt-102',
          marketType: 'OVER_UNDER',
          name: 'Total Goals Over/Under 2.5',
          selections: [
            { name: 'Over 2.5', odds: 1.80 },
            { name: 'Under 2.5', odds: 2.05 }
          ]
        });

        // Suspend market due to VAR
        await oddsEngine.suspendMarket(tenantId, market.id, 'VAR_REVIEW');

        const overSel = selections[0]!;
        await assert.rejects(
          async () => await oddsEngine.verifySelectionForBetting(tenantId, overSel.id, 1.80),
          MarketSuspendedError
        );
      }
    );
  });
});
