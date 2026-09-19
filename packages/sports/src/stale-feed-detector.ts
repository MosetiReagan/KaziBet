import { TenantId, MarketId } from '@kazibet/shared';
import { DatabaseTransactionContext } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { RealtimeBroadcaster } from './provider-interface.js';

export interface StaleFeedDetectorConfig {
  inPlayThresholdMs?: number;    // Default: 60,000 ms (60 seconds)
  preMatchThresholdMs?: number;  // Default: 900,000 ms (15 minutes)
}

export interface StaleCheckResult {
  tenantId: TenantId;
  checkedMarketsCount: number;
  suspendedMarketsCount: number;
  suspendedMarketIds: MarketId[];
  timestamp: Date;
}

export class StaleFeedDetector {
  private readonly inPlayThresholdMs: number;
  private readonly preMatchThresholdMs: number;

  constructor(
    private readonly getContext: () => DatabaseTransactionContext,
    private readonly broadcaster?: RealtimeBroadcaster,
    config: StaleFeedDetectorConfig = {}
  ) {
    this.inPlayThresholdMs = config.inPlayThresholdMs ?? 60_000;
    this.preMatchThresholdMs = config.preMatchThresholdMs ?? 900_000;
  }

  /**
   * Scans all active markets for a tenant and automatically suspends markets
   * whose events haven't received feed updates within the configured stale interval.
   */
  public async checkAndSuspendStaleMarkets(
    tenantId: TenantId,
    now: Date = new Date()
  ): Promise<StaleCheckResult> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();

    // 1. Get all active markets
    const activeMarkets = await ctx.markets.findMany(tenantId, { status: 'ACTIVE' });
    const suspendedMarketIds: MarketId[] = [];

    for (const market of activeMarkets) {
      const event = await ctx.events.findById(tenantId, market.eventId);
      if (!event) continue;

      // Determine stale threshold depending on whether event is in-play or pre-match
      const isInPlay = event.status === 'LIVE';
      const isPreMatch = event.status === 'SCHEDULED';
      if (!isInPlay && !isPreMatch) continue;

      const thresholdMs = isInPlay ? this.inPlayThresholdMs : this.preMatchThresholdMs;
      const lastUpdateMs = new Date(market.updatedAt).getTime();
      const elapsedMs = now.getTime() - lastUpdateMs;

      if (elapsedMs > thresholdMs) {
        // Suspend market due to stale feed
        await ctx.markets.update(tenantId, market.id, {
          status: 'SUSPENDED',
          suspensionReason: 'FEED_UNAVAILABLE',
          updatedAt: now
        });

        suspendedMarketIds.push(market.id);

        // Broadcast suspension if realtime broadcaster is provided
        if (this.broadcaster) {
          try {
            this.broadcaster.broadcast({
              tenantId,
              channel: `odds:${event.id}`,
              event: 'MARKET_SUSPENDED',
              data: {
                marketId: market.id,
                eventId: event.id,
                reason: 'FEED_UNAVAILABLE',
                staleElapsedMs: elapsedMs,
                thresholdMs
              },
              timestamp: now.toISOString()
            });
          } catch {
            // Ignore broadcast failure
          }
        }
      }
    }

    return {
      tenantId,
      checkedMarketsCount: activeMarkets.length,
      suspendedMarketsCount: suspendedMarketIds.length,
      suspendedMarketIds,
      timestamp: now
    };
  }
}
