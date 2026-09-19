import { EventStatus, SportSlug, TenantId } from '@kazibet/shared';

export interface ExternalEventPayload {
  providerId: string;
  sport: SportSlug;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  startTime: string; // ISO 8601
  status: EventStatus;
  score?: {
    home: number;
    away: number;
    period?: string;
  };
}

export interface SportsDataProvider {
  readonly providerName: string;
  getSports(): Promise<SportSlug[]>;
  fetchUpcomingEvents(sport?: SportSlug): Promise<ExternalEventPayload[]>;
  fetchLiveEvents(): Promise<ExternalEventPayload[]>;
  fetchEventDetails(providerId: string): Promise<ExternalEventPayload | null>;
}

// ---------------------------------------------------------------------------
// Real Odds & Results Feed Provider Abstractions (Phase 3)
// ---------------------------------------------------------------------------

export interface FeedFixture {
  id: string;
  sport: SportSlug;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string; // ISO 8601
  status: EventStatus;
}

export interface FeedSelectionOdds {
  name: string;
  price: number;
  probability?: number;
  point?: number;
}

export interface FeedOdds {
  fixtureId: string;
  marketType: string; // '1X2', 'TOTALS_2_5', etc.
  name: string;
  selections: FeedSelectionOdds[];
  timestamp: string; // ISO 8601
}

export interface FeedLiveScore {
  fixtureId: string;
  homeScore: number;
  awayScore: number;
  period?: string;
  minute?: number;
  status: EventStatus;
  lastUpdated: string; // ISO 8601
}

export interface FeedResult {
  fixtureId: string;
  homeScore: number;
  awayScore: number;
  winner: 'HOME' | 'AWAY' | 'DRAW' | 'CANCELLED';
  completedAt: string; // ISO 8601
}

export type FeedHealthStatusLevel = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface FeedHealthStatus {
  providerName: string;
  status: FeedHealthStatusLevel;
  lastSeen: Date | null;
  latencyMs: number;
  errorCount: number;
  successCount: number;
}

export interface FeedProvider {
  readonly providerName: string;
  getFixtures(sport?: string): Promise<FeedFixture[]>;
  getOdds(fixtureId: string): Promise<FeedOdds[]>;
  getLiveScore(fixtureId: string): Promise<FeedLiveScore | null>;
  getResult(fixtureId: string): Promise<FeedResult | null>;
  getHealth(): FeedHealthStatus;
}

export interface RealtimeBroadcaster {
  broadcast(message: {
    tenantId: TenantId;
    channel: string;
    event: string;
    data: Record<string, unknown>;
    timestamp: string;
  }): void;
}
