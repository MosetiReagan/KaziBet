import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FeedProvider,
  FeedFixture,
  FeedOdds,
  FeedLiveScore,
  FeedResult,
  FeedHealthStatus,
  FeedHealthStatusLevel
} from './provider-interface.js';
import { SportSlug } from '@kazibet/shared';

export interface TheOddsApiConfig {
  apiKey?: string;
  baseUrl?: string;
  mode?: 'live' | 'replay';
  fixtureDir?: string;
  timeoutMs?: number;
}

export class TheOddsApiFeedProvider implements FeedProvider {
  public readonly providerName = 'THE_ODDS_API';
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly mode: 'live' | 'replay';
  private readonly fixtureDir: string;
  private readonly timeoutMs: number;

  private lastSeen: Date | null = null;
  private latencyMs = 0;
  private errorCount = 0;
  private successCount = 0;

  constructor(config: TheOddsApiConfig = {}) {
    this.apiKey = config.apiKey || process.env.THE_ODDS_API_KEY;
    this.baseUrl = (config.baseUrl || 'https://api.the-odds-api.com/v4').replace(/\/$/, '');
    this.mode = config.mode || (this.apiKey ? 'live' : 'replay');
    this.timeoutMs = config.timeoutMs || 8000;

    // Resolve fixture directory (defaults to test/fixtures/feed or tests/fixtures/feed)
    this.fixtureDir =
      config.fixtureDir ||
      path.resolve(process.cwd(), 'test/fixtures/feed');
  }

  public getHealth(): FeedHealthStatus {
    const total = this.successCount + this.errorCount;
    let status: FeedHealthStatusLevel = 'HEALTHY';

    if (this.errorCount > 0 && total > 0) {
      const errorRate = this.errorCount / total;
      if (errorRate >= 0.5) {
        status = 'UNHEALTHY';
      } else if (errorRate >= 0.15) {
        status = 'DEGRADED';
      }
    }

    return {
      providerName: this.providerName,
      status,
      lastSeen: this.lastSeen,
      latencyMs: this.latencyMs,
      errorCount: this.errorCount,
      successCount: this.successCount
    };
  }

  private mapSportKeyToSlug(sportKey: string): SportSlug {
    if (sportKey.includes('soccer')) return 'football';
    if (sportKey.includes('basketball')) return 'basketball';
    if (sportKey.includes('tennis')) return 'tennis';
    if (sportKey.includes('cricket')) return 'cricket';
    if (sportKey.includes('rugby')) return 'rugby';
    return 'football';
  }

  private async loadFixtureFile<T>(filename: string): Promise<T> {
    const candidates = [
      this.fixtureDir,
      path.resolve(process.cwd(), 'test/fixtures/feed'),
      path.resolve(process.cwd(), 'tests/fixtures/feed'),
      path.resolve(process.cwd(), '../../test/fixtures/feed'),
      path.resolve(process.cwd(), '../../tests/fixtures/feed'),
      path.resolve(process.cwd(), '../test/fixtures/feed'),
      path.resolve(process.cwd(), '../tests/fixtures/feed')
    ];

    for (const dir of candidates) {
      const filePath = path.join(dir, filename);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
      } catch {
        // try next candidate
      }
    }

    throw new Error(`Fixture file '${filename}' not found in candidate paths: ${candidates.join(', ')}`);
  }

  public async getFixtures(sport = 'soccer_epl'): Promise<FeedFixture[]> {
    const start = Date.now();
    try {
      if (this.mode === 'replay') {
        const raw = await this.loadFixtureFile<any[]>('the-odds-api-fixtures.json');
        this.lastSeen = new Date();
        this.latencyMs = Date.now() - start;
        this.successCount++;

        return raw.map((item) => ({
          id: item.id,
          sport: this.mapSportKeyToSlug(item.sport_key || sport),
          competition: item.sport_title || 'General Competition',
          homeTeam: item.home_team,
          awayTeam: item.away_team,
          scheduledStart: item.commence_time,
          status: item.completed ? 'FINISHED' : 'SCHEDULED'
        }));
      }

      // Live mode
      if (!this.apiKey) {
        throw new Error('THE_ODDS_API_KEY is required in live mode');
      }

      const url = `${this.baseUrl}/sports/${sport}/odds/?regions=eu,uk&markets=h2h&oddsFormat=decimal&apiKey=${this.apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`The Odds API HTTP ${res.status}: ${await res.text()}`);
      }

      const raw = (await res.json()) as any[];
      this.lastSeen = new Date();
      this.latencyMs = Date.now() - start;
      this.successCount++;

      return raw.map((item) => ({
        id: item.id,
        sport: this.mapSportKeyToSlug(item.sport_key || sport),
        competition: item.sport_title || 'General Competition',
        homeTeam: item.home_team,
        awayTeam: item.away_team,
        scheduledStart: item.commence_time,
        status: item.completed ? 'FINISHED' : 'SCHEDULED'
      }));
    } catch (err) {
      this.errorCount++;
      this.latencyMs = Date.now() - start;
      throw err;
    }
  }

  public async getOdds(fixtureId: string): Promise<FeedOdds[]> {
    const start = Date.now();
    try {
      if (this.mode === 'replay') {
        const raw = await this.loadFixtureFile<any[]>('the-odds-api-odds.json');
        const match = raw.find((m) => m.id === fixtureId);
        this.lastSeen = new Date();
        this.latencyMs = Date.now() - start;
        this.successCount++;

        if (!match || !match.bookmakers || match.bookmakers.length === 0) {
          return [];
        }

        return this.parseBookmakersToFeedOdds(fixtureId, match.bookmakers);
      }

      // Live mode
      if (!this.apiKey) {
        throw new Error('THE_ODDS_API_KEY is required in live mode');
      }

      const url = `${this.baseUrl}/sports/soccer_epl/events/${fixtureId}/odds?regions=eu,uk&markets=h2h,totals&oddsFormat=decimal&apiKey=${this.apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`The Odds API HTTP ${res.status}: ${await res.text()}`);
      }

      const match = (await res.json()) as any;
      this.lastSeen = new Date();
      this.latencyMs = Date.now() - start;
      this.successCount++;

      if (!match?.bookmakers) return [];
      return this.parseBookmakersToFeedOdds(fixtureId, match.bookmakers);
    } catch (err) {
      this.errorCount++;
      this.latencyMs = Date.now() - start;
      throw err;
    }
  }

  public async getLiveScore(fixtureId: string): Promise<FeedLiveScore | null> {
    const start = Date.now();
    try {
      if (this.mode === 'replay') {
        const raw = await this.loadFixtureFile<any[]>('the-odds-api-scores.json');
        const match = raw.find((m) => m.id === fixtureId);
        this.lastSeen = new Date();
        this.latencyMs = Date.now() - start;
        this.successCount++;

        if (!match) return null;

        const homeScore = Number(match.scores?.find((s: any) => s.name === match.home_team)?.score ?? 0);
        const awayScore = Number(match.scores?.find((s: any) => s.name === match.away_team)?.score ?? 0);

        return {
          fixtureId,
          homeScore,
          awayScore,
          period: match.completed ? 'FullTime' : 'Live',
          status: match.completed ? 'FINISHED' : 'LIVE',
          lastUpdated: match.last_update || new Date().toISOString()
        };
      }

      // Live mode
      if (!this.apiKey) {
        throw new Error('THE_ODDS_API_KEY is required in live mode');
      }

      const url = `${this.baseUrl}/sports/soccer_epl/scores/?daysFrom=1&apiKey=${this.apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`The Odds API HTTP ${res.status}: ${await res.text()}`);
      }

      const list = (await res.json()) as any[];
      const match = list.find((m) => m.id === fixtureId);
      this.lastSeen = new Date();
      this.latencyMs = Date.now() - start;
      this.successCount++;

      if (!match) return null;

      const homeScore = Number(match.scores?.find((s: any) => s.name === match.home_team)?.score ?? 0);
      const awayScore = Number(match.scores?.find((s: any) => s.name === match.away_team)?.score ?? 0);

      return {
        fixtureId,
        homeScore,
        awayScore,
        period: match.completed ? 'FullTime' : 'Live',
        status: match.completed ? 'FINISHED' : 'LIVE',
        lastUpdated: match.last_update || new Date().toISOString()
      };
    } catch (err) {
      this.errorCount++;
      this.latencyMs = Date.now() - start;
      throw err;
    }
  }

  public async getResult(fixtureId: string): Promise<FeedResult | null> {
    const liveScore = await this.getLiveScore(fixtureId);
    if (!liveScore || liveScore.status !== 'FINISHED') {
      return null;
    }

    let winner: 'HOME' | 'AWAY' | 'DRAW' = 'DRAW';
    if (liveScore.homeScore > liveScore.awayScore) {
      winner = 'HOME';
    } else if (liveScore.awayScore > liveScore.homeScore) {
      winner = 'AWAY';
    }

    return {
      fixtureId,
      homeScore: liveScore.homeScore,
      awayScore: liveScore.awayScore,
      winner,
      completedAt: liveScore.lastUpdated
    };
  }

  private parseBookmakersToFeedOdds(fixtureId: string, bookmakers: any[]): FeedOdds[] {
    const results: FeedOdds[] = [];
    const primaryBookmaker = bookmakers[0];
    if (!primaryBookmaker?.markets) return results;

    for (const m of primaryBookmaker.markets) {
      if (m.key === 'h2h') {
        results.push({
          fixtureId,
          marketType: '1X2',
          name: 'Full Time Result (1X2)',
          timestamp: m.last_update || new Date().toISOString(),
          selections: m.outcomes.map((o: any) => ({
            name: o.name,
            price: Number(o.price)
          }))
        });
      } else if (m.key === 'totals') {
        results.push({
          fixtureId,
          marketType: 'TOTALS_2_5',
          name: 'Total Goals Over/Under 2.5',
          timestamp: m.last_update || new Date().toISOString(),
          selections: m.outcomes.map((o: any) => ({
            name: o.name,
            price: Number(o.price),
            point: o.point
          }))
        });
      }
    }

    return results;
  }
}
