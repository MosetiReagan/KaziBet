import {
  TenantId,
  EventId,
  generateId,
  KaziBetError
} from '@kazibet/shared';
import {
  DatabaseTransactionContext,
  EventEntity,
  MarketEntity,
  SelectionEntity
} from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import {
  FeedProvider,
  FeedHealthStatus,
  RealtimeBroadcaster,
  FeedOdds,
  FeedResult
} from './provider-interface.js';
import { SportsService } from './sports-service.js';
import { StaleFeedDetector, StaleFeedDetectorConfig, StaleCheckResult } from './stale-feed-detector.js';

export class FeedIngestionService {
  private readonly staleDetector: StaleFeedDetector;

  constructor(
    private readonly getContext: () => DatabaseTransactionContext,
    private readonly sportsService: SportsService,
    private readonly feedProvider: FeedProvider,
    private readonly broadcaster?: RealtimeBroadcaster,
    staleConfig?: StaleFeedDetectorConfig
  ) {
    this.staleDetector = new StaleFeedDetector(
      this.getContext,
      this.broadcaster,
      staleConfig
    );
  }

  public getProviderHealth(): FeedHealthStatus {
    return this.feedProvider.getHealth();
  }

  /**
   * Sync fixtures from the feed provider into the sports catalog and database.
   */
  public async syncFixtures(tenantId: TenantId, sport?: string): Promise<EventEntity[]> {
    TenantContextHolder.assertTenant(tenantId);
    const fixtures = await this.feedProvider.getFixtures(sport);
    const events: EventEntity[] = [];

    for (const fix of fixtures) {
      const event = await this.sportsService.ingestExternalEvent(tenantId, {
        providerId: fix.id,
        sport: fix.sport,
        competitionName: fix.competition,
        homeTeamName: fix.homeTeam,
        awayTeamName: fix.awayTeam,
        startTime: fix.scheduledStart,
        status: fix.status
      });
      events.push(event);
    }

    return events;
  }

  /**
   * Sync odds for a given fixture and broadcast real-time changes.
   * If a market was previously suspended due to stale feed, fresh odds resume it.
   */
  public async syncOdds(
    tenantId: TenantId,
    eventId: EventId,
    providerFixtureId: string
  ): Promise<MarketEntity[]> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const feedOddsList: FeedOdds[] = await this.feedProvider.getOdds(providerFixtureId);
    const syncedMarkets: MarketEntity[] = [];

    for (const feedOdds of feedOddsList) {
      // 1. Find or create market
      const existingMarkets = await ctx.markets.findMany(tenantId, {
        eventId,
        marketType: feedOdds.marketType
      });

      let market = existingMarkets[0];
      const now = new Date();

      if (!market) {
        const marketId = generateId();
        market = await ctx.markets.create(tenantId, {
          id: marketId,
          tenantId,
          eventId,
          marketType: feedOdds.marketType,
          name: feedOdds.name,
          status: 'ACTIVE',
          parameters: {},
          createdAt: now,
          updatedAt: now
        });

        // Create selections
        for (const sel of feedOdds.selections) {
          await ctx.selections.create({
            id: generateId(),
            marketId: market.id,
            name: sel.name,
            currentOdds: Number(sel.price.toFixed(4)),
            probability: sel.probability,
            version: 1,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now
          });
        }
      } else {
        // Market exists: update selections and resume if it was suspended for stale feed
        const existingSelections = await ctx.selections.findMany({ marketId: market.id });

        for (const sel of feedOdds.selections) {
          const matchSel = existingSelections.find((s) => s.name === sel.name);
          const safePrice = Number(sel.price.toFixed(4));

          if (matchSel) {
            if (Math.abs(matchSel.currentOdds - safePrice) > 0.0001) {
              await ctx.selections.update(matchSel.id, {
                currentOdds: safePrice,
                version: matchSel.version + 1,
                updatedAt: now
              });
            }
          } else {
            await ctx.selections.create({
              id: generateId(),
              marketId: market.id,
              name: sel.name,
              currentOdds: safePrice,
              probability: sel.probability,
              version: 1,
              status: 'ACTIVE',
              createdAt: now,
              updatedAt: now
            });
          }
        }

        // Resume if suspended specifically for stale feed
        const updates: Partial<MarketEntity> = { updatedAt: now };
        if (market.status === 'SUSPENDED' && market.suspensionReason === 'FEED_UNAVAILABLE') {
          updates.status = 'ACTIVE';
          updates.suspensionReason = undefined;
        }

        market = await ctx.markets.update(tenantId, market.id, updates);
      }

      syncedMarkets.push(market);

      // 2. Broadcast realtime odds update through RealtimeHub
      if (this.broadcaster) {
        try {
          const currentSelections = await ctx.selections.findMany({ marketId: market.id });
          this.broadcaster.broadcast({
            tenantId,
            channel: `odds:${eventId}`,
            event: 'ODDS_UPDATED',
            data: {
              eventId,
              marketId: market.id,
              marketType: market.marketType,
              status: market.status,
              selections: currentSelections.map((s) => ({
                id: s.id,
                name: s.name,
                odds: s.currentOdds,
                version: s.version
              }))
            },
            timestamp: now.toISOString()
          });
        } catch {
          // Ignore realtime dispatch errors
        }
      }
    }

    return syncedMarkets;
  }

  /**
   * Sync live scores for an event and broadcast updates.
   */
  public async syncLiveScores(
    tenantId: TenantId,
    eventId: EventId,
    providerFixtureId: string
  ): Promise<EventEntity | null> {
    TenantContextHolder.assertTenant(tenantId);
    const score = await this.feedProvider.getLiveScore(providerFixtureId);
    if (!score) return null;

    const updated = await this.sportsService.updateScore(
      tenantId,
      eventId,
      score.homeScore,
      score.awayScore,
      score.period
    );

    if (this.broadcaster) {
      try {
        this.broadcaster.broadcast({
          tenantId,
          channel: `events:${eventId}`,
          event: 'SCORE_UPDATED',
          data: {
            eventId,
            homeScore: score.homeScore,
            awayScore: score.awayScore,
            period: score.period,
            minute: score.minute,
            status: updated.status
          },
          timestamp: new Date().toISOString()
        });
      } catch {
        // Ignore
      }
    }

    return updated;
  }

  /**
   * Sync final match result for settlement.
   */
  public async syncSettlementResult(
    tenantId: TenantId,
    eventId: EventId,
    providerFixtureId: string
  ): Promise<FeedResult | null> {
    TenantContextHolder.assertTenant(tenantId);
    const result = await this.feedProvider.getResult(providerFixtureId);
    if (!result) return null;

    await this.sportsService.finishEvent(tenantId, eventId);
    return result;
  }

  /**
   * Perform automatic stale market detection and suspension.
   */
  public async checkStaleMarkets(tenantId: TenantId, now: Date = new Date()): Promise<StaleCheckResult> {
    return await this.staleDetector.checkAndSuspendStaleMarkets(tenantId, now);
  }
}
