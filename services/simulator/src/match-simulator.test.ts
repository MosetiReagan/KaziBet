import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { TenantContextHolder } from '@kazibet/tenant';
import { MatchSimulator } from './match-simulator.js';

describe('MatchSimulator Suite', () => {
  const tenantId = 'tenant-sim-test';

  test('seeds fixtures and simulates goal event with odds adjustments', async () => {
    const db = new InMemoryDatabase();
    const sports = new SportsService(() => db.getContext());
    const odds = new OddsEngine(() => db.getContext());
    const sim = new MatchSimulator(db, sports, odds);

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'sim-test',
        domain: 'sim.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const matches = await sim.seedDefaultFixtures(tenantId);
        assert.equal(matches.length, 3);

        const firstMatch = matches[0]!;
        assert.equal(firstMatch.event.homeScore, 0);

        // Simulate goal scored by Home team
        const updated = await sim.simulateGoalEvent(
          tenantId,
          firstMatch.event.id,
          'HOME',
          firstMatch.marketId,
          firstMatch.selections.homeId,
          firstMatch.selections.awayId
        );

        assert.equal(updated.homeScore, 1);
        assert.equal(updated.awayScore, 0);

        // Verify live home odds shifted downwards (e.g. 1.25)
        const homeSel = await db.getContext().selections.findById(firstMatch.selections.homeId);
        assert.equal(homeSel?.currentOdds, 1.25);
      }
    );
  });
});
