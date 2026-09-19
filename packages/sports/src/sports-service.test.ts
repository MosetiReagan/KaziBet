import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { SportsService } from './sports-service.js';

describe('Sports Service & Event Lifecycle', () => {
  const tenantId = 'tenant-sports-test';

  test('creates, updates score, and finishes event cleanly', async () => {
    const db = new InMemoryDatabase();
    const service = new SportsService(() => db.getContext());

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'sports-test',
        domain: 'sports.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const event = await service.createEvent({
          tenantId,
          competitionId: 'comp-epl',
          homeTeamId: 'team-arsenal',
          awayTeamId: 'team-chelsea',
          scheduledStart: new Date(Date.now() + 3600000)
        });

        assert.equal(event.status, 'SCHEDULED');
        assert.equal(event.homeScore, 0);

        // Update score to 1 - 0
        const liveEvent = await service.updateScore(tenantId, event.id, 1, 0, '1st Half');
        assert.equal(liveEvent.status, 'LIVE');
        assert.equal(liveEvent.homeScore, 1);
        assert.equal(liveEvent.awayScore, 0);

        // Finish event
        const finished = await service.finishEvent(tenantId, event.id);
        assert.equal(finished.status, 'FINISHED');
      }
    );
  });

  test('ingests external fixture event properly', async () => {
    const db = new InMemoryDatabase();
    const service = new SportsService(() => db.getContext());

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'sports-test',
        domain: 'sports.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const event = await service.ingestExternalEvent(tenantId, {
          providerId: 'ext-fixture-999',
          sport: 'football',
          competitionName: 'Kenya Premier League',
          homeTeamName: 'Gor Mahia',
          awayTeamName: 'AFC Leopards',
          startTime: new Date().toISOString(),
          status: 'SCHEDULED'
        });

        assert.ok(event.id);
        assert.equal(event.status, 'SCHEDULED');
      }
    );
  });
});
