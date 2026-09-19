import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { SportsService } from './sports-service.js';
import { TheOddsApiFeedProvider } from './the-odds-api-provider.js';
import { SimulatorFeedProvider } from './simulator-feed-adapter.js';
import { StaleFeedDetector } from './stale-feed-detector.js';
import { FeedIngestionService } from './feed-ingestion-service.js';
import { RealtimeBroadcaster } from './provider-interface.js';

describe('Phase 3: Real Odds & Results Feed Engine', () => {
  const tenantId = 'tenant-feed-test';
  const tenantCtx = {
    tenantId,
    code: 'feed-test',
    domain: 'feed.local',
    currency: 'KES' as const,
    capabilityStatus: 'SANDBOX' as const
  };

  test('Replay mode: ingests recorded fixtures and odds deterministically from files', async () => {
    const db = new InMemoryDatabase();
    const sportsService = new SportsService(() => db.getContext());

    const fixtureDir = path.resolve(process.cwd(), 'test/fixtures/feed');
    const provider = new TheOddsApiFeedProvider({
      mode: 'replay',
      fixtureDir
    });

    const ingestionService = new FeedIngestionService(
      () => db.getContext(),
      sportsService,
      provider
    );

    await TenantContextHolder.run(tenantCtx, async () => {
      // 1. Ingest fixtures
      const events = await ingestionService.syncFixtures(tenantId);
      assert.equal(events.length, 3);

      const arsenalMatch = events.find((e) => e.competitionId.includes('english-premier-league'));
      assert.ok(arsenalMatch);
      assert.equal(arsenalMatch.status, 'SCHEDULED');

      // 2. Ingest odds for Arsenal match
      const markets = await ingestionService.syncOdds(tenantId, arsenalMatch.id, 'toa-epl-001');
      assert.equal(markets.length, 2); // 1X2 and TOTALS_2_5

      const h2hMarket = markets.find((m) => m.marketType === '1X2');
      assert.ok(h2hMarket);
      assert.equal(h2hMarket.status, 'ACTIVE');

      const selections = await db.getContext().selections.findMany({ marketId: h2hMarket.id });
      assert.equal(selections.length, 3);
      const arsenalSel = selections.find((s) => s.name === 'Arsenal');
      assert.ok(arsenalSel);
      assert.equal(arsenalSel.currentOdds, 2.15);

      // 3. Provider health metrics
      const health = ingestionService.getProviderHealth();
      assert.equal(health.providerName, 'THE_ODDS_API');
      assert.equal(health.status, 'HEALTHY');
      assert.ok(health.successCount >= 2);
    });
  });

  test('Live HTTP mode: connects to API endpoint with latency and error tracking', async () => {
    // Spin up local fake The Odds API server
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const apiKey = url.searchParams.get('apiKey');

      if (apiKey !== 'valid_secret_key') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unauthorized' }));
        return;
      }

      if (url.pathname.includes('/scores')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'mock-live-1',
              sport_key: 'soccer_epl',
              sport_title: 'EPL',
              commence_time: '2026-09-20T15:00:00Z',
              completed: false,
              home_team: 'Liverpool',
              away_team: 'Manchester City',
              scores: [
                { name: 'Liverpool', score: '1' },
                { name: 'Manchester City', score: '1' }
              ],
              last_update: '2026-09-20T15:45:00Z'
            }
          ])
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'mock-live-1',
            sport_key: 'soccer_epl',
            sport_title: 'EPL',
            commence_time: '2026-09-20T15:00:00Z',
            home_team: 'Liverpool',
            away_team: 'Manchester City',
            completed: false
          }
        ])
      );
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const liveProvider = new TheOddsApiFeedProvider({
        baseUrl,
        apiKey: 'valid_secret_key',
        mode: 'live'
      });

      const fixtures = await liveProvider.getFixtures('soccer_epl');
      assert.equal(fixtures.length, 1);
      assert.equal(fixtures[0]?.homeTeam, 'Liverpool');

      const liveScore = await liveProvider.getLiveScore('mock-live-1');
      assert.ok(liveScore);
      assert.equal(liveScore.homeScore, 1);
      assert.equal(liveScore.awayScore, 1);

      const health = liveProvider.getHealth();
      assert.equal(health.status, 'HEALTHY');
      assert.equal(health.errorCount, 0);

      // Verify error tracking with invalid key
      const badProvider = new TheOddsApiFeedProvider({
        baseUrl,
        apiKey: 'bad_key',
        mode: 'live'
      });
      await assert.rejects(() => badProvider.getFixtures('soccer_epl'), /HTTP 401/);
      const badHealth = badProvider.getHealth();
      assert.equal(badHealth.errorCount, 1);
      assert.equal(badHealth.status, 'UNHEALTHY');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('Stale feed detection: automatically suspends markets when updates cease and resumes on fresh odds', async () => {
    const db = new InMemoryDatabase();
    const sportsService = new SportsService(() => db.getContext());
    const fixtureDir = path.resolve(process.cwd(), 'test/fixtures/feed');
    const provider = new TheOddsApiFeedProvider({ mode: 'replay', fixtureDir });

    const broadcastedEvents: any[] = [];
    const mockBroadcaster: RealtimeBroadcaster = {
      broadcast: (msg) => broadcastedEvents.push(msg)
    };

    const ingestionService = new FeedIngestionService(
      () => db.getContext(),
      sportsService,
      provider,
      mockBroadcaster,
      {
        inPlayThresholdMs: 60_000,    // 60 seconds for live
        preMatchThresholdMs: 900_000 // 15 minutes for pre-match
      }
    );

    await TenantContextHolder.run(tenantCtx, async () => {
      // 1. Ingest fixtures & odds
      const events = await ingestionService.syncFixtures(tenantId);
      const liveEvent = events[0]!;
      // Mark event as LIVE
      await db.getContext().events.update(tenantId, liveEvent.id, { status: 'LIVE' });

      const markets = await ingestionService.syncOdds(tenantId, liveEvent.id, 'toa-epl-001');
      const market = markets[0]!;
      assert.equal(market.status, 'ACTIVE');

      // 2. Verify realtime broadcast of odds update
      const initialOddsBroadcast = broadcastedEvents.find((e) => e.event === 'ODDS_UPDATED');
      assert.ok(initialOddsBroadcast);
      assert.equal(initialOddsBroadcast.channel, `odds:${liveEvent.id}`);

      // 3. Stale check at now: should NOT suspend (updated just now)
      const freshResult = await ingestionService.checkStaleMarkets(tenantId, new Date());
      assert.equal(freshResult.suspendedMarketsCount, 0);

      // 4. Stale check at +65 seconds (exceeds 60s in-play threshold)
      const staleTime = new Date(Date.now() + 65_000);
      const staleResult = await ingestionService.checkStaleMarkets(tenantId, staleTime);
      assert.equal(staleResult.suspendedMarketsCount, 2);
      assert.ok(staleResult.suspendedMarketIds.includes(market.id));

      // Assert market in database is SUSPENDED with reason FEED_UNAVAILABLE
      const suspendedMarket = await db.getContext().markets.findById(tenantId, market.id);
      assert.equal(suspendedMarket?.status, 'SUSPENDED');
      assert.equal(suspendedMarket?.suspensionReason, 'FEED_UNAVAILABLE');

      // Assert suspension broadcast was emitted
      const suspendBroadcast = broadcastedEvents.find((e) => e.event === 'MARKET_SUSPENDED');
      assert.ok(suspendBroadcast);
      assert.equal(suspendBroadcast.data.reason, 'FEED_UNAVAILABLE');

      // 5. Fresh odds arrive: market is automatically RESUMED to ACTIVE
      await ingestionService.syncOdds(tenantId, liveEvent.id, 'toa-epl-001');
      const resumedMarket = await db.getContext().markets.findById(tenantId, market.id);
      assert.equal(resumedMarket?.status, 'ACTIVE');
      assert.equal(resumedMarket?.suspensionReason, undefined);
    });
  });

  test('Simulator fallback: provides complete fixtures, odds, and scores when configured as provider', async () => {
    const db = new InMemoryDatabase();
    const sportsService = new SportsService(() => db.getContext());
    const simProvider = new SimulatorFeedProvider();

    const ingestionService = new FeedIngestionService(
      () => db.getContext(),
      sportsService,
      simProvider
    );

    await TenantContextHolder.run(tenantCtx, async () => {
      // 1. Sync fixtures from simulator
      const events = await ingestionService.syncFixtures(tenantId);
      assert.equal(events.length, 3);
      assert.ok(events.some((e) => e.homeTeamId.includes('gor-mahia')));

      // 2. Sync odds from simulator
      const event = events[0]!;
      const markets = await ingestionService.syncOdds(tenantId, event.id, 'sim-kpl-01');
      assert.equal(markets.length, 1);
      assert.equal(markets[0]?.status, 'ACTIVE');

      // 3. Advance simulator match and sync score
      simProvider.advanceMatch('sim-kpl-01', 2, 1, 67);
      const liveScoreEvent = await ingestionService.syncLiveScores(tenantId, event.id, 'sim-kpl-01');
      assert.ok(liveScoreEvent);
      assert.equal(liveScoreEvent.homeScore, 2);
      assert.equal(liveScoreEvent.awayScore, 1);
      assert.equal(liveScoreEvent.status, 'LIVE');

      // 4. Finish simulator match and sync result
      simProvider.advanceMatch('sim-kpl-01', 2, 1, 90, true);
      const result = await ingestionService.syncSettlementResult(tenantId, event.id, 'sim-kpl-01');
      assert.ok(result);
      assert.equal(result.winner, 'HOME');
      assert.equal(result.homeScore, 2);
    });
  });
});
