import {
  FeedProvider,
  FeedFixture,
  FeedOdds,
  FeedLiveScore,
  FeedResult,
  FeedHealthStatus
} from './provider-interface.js';

interface SimulatedMatchState {
  fixture: FeedFixture;
  odds: FeedOdds[];
  homeScore: number;
  awayScore: number;
  minute: number;
  period: string;
  completed: boolean;
}

export class SimulatorFeedProvider implements FeedProvider {
  public readonly providerName = 'SIMULATOR_FEED';
  private matches = new Map<string, SimulatedMatchState>();
  private lastSeen: Date = new Date();

  constructor() {
    this.seedDefaultMatches();
  }

  private seedDefaultMatches(): void {
    const defaults = [
      {
        id: 'sim-kpl-01',
        sport: 'football' as const,
        competition: 'Kenya Premier League',
        homeTeam: 'Gor Mahia',
        awayTeam: 'AFC Leopards',
        homeOdds: 1.85,
        drawOdds: 3.20,
        awayOdds: 4.50
      },
      {
        id: 'sim-epl-02',
        sport: 'football' as const,
        competition: 'English Premier League',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        homeOdds: 2.10,
        drawOdds: 3.40,
        awayOdds: 3.60
      },
      {
        id: 'sim-ucl-03',
        sport: 'football' as const,
        competition: 'UEFA Champions League',
        homeTeam: 'Real Madrid',
        awayTeam: 'Bayern Munich',
        homeOdds: 2.25,
        drawOdds: 3.50,
        awayOdds: 3.10
      }
    ];

    for (const m of defaults) {
      this.matches.set(m.id, {
        fixture: {
          id: m.id,
          sport: m.sport,
          competition: m.competition,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          scheduledStart: new Date(Date.now() + 1800000).toISOString(),
          status: 'SCHEDULED'
        },
        odds: [
          {
            fixtureId: m.id,
            marketType: '1X2',
            name: 'Full Time Result (1X2)',
            timestamp: new Date().toISOString(),
            selections: [
              { name: m.homeTeam, price: m.homeOdds },
              { name: 'Draw', price: m.drawOdds },
              { name: m.awayTeam, price: m.awayOdds }
            ]
          }
        ],
        homeScore: 0,
        awayScore: 0,
        minute: 0,
        period: 'PreMatch',
        completed: false
      });
    }
  }

  public getHealth(): FeedHealthStatus {
    return {
      providerName: this.providerName,
      status: 'HEALTHY',
      lastSeen: this.lastSeen,
      latencyMs: 1,
      errorCount: 0,
      successCount: 100
    };
  }

  public async getFixtures(): Promise<FeedFixture[]> {
    this.lastSeen = new Date();
    return Array.from(this.matches.values()).map((m) => m.fixture);
  }

  public async getOdds(fixtureId: string): Promise<FeedOdds[]> {
    this.lastSeen = new Date();
    const match = this.matches.get(fixtureId);
    return match ? match.odds : [];
  }

  public async getLiveScore(fixtureId: string): Promise<FeedLiveScore | null> {
    this.lastSeen = new Date();
    const match = this.matches.get(fixtureId);
    if (!match) return null;

    return {
      fixtureId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      period: match.period,
      minute: match.minute,
      status: match.completed ? 'FINISHED' : match.minute > 0 ? 'LIVE' : 'SCHEDULED',
      lastUpdated: new Date().toISOString()
    };
  }

  public async getResult(fixtureId: string): Promise<FeedResult | null> {
    this.lastSeen = new Date();
    const match = this.matches.get(fixtureId);
    if (!match || !match.completed) return null;

    let winner: 'HOME' | 'AWAY' | 'DRAW' = 'DRAW';
    if (match.homeScore > match.awayScore) winner = 'HOME';
    else if (match.awayScore > match.homeScore) winner = 'AWAY';

    return {
      fixtureId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      winner,
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Helper for testing state transitions dynamically
   */
  public advanceMatch(fixtureId: string, homeScore: number, awayScore: number, minute: number, completed = false): void {
    const match = this.matches.get(fixtureId);
    if (!match) return;

    match.homeScore = homeScore;
    match.awayScore = awayScore;
    match.minute = minute;
    match.completed = completed;
    match.period = completed ? 'FullTime' : 'Live';
    match.fixture.status = completed ? 'FINISHED' : 'LIVE';
  }
}
