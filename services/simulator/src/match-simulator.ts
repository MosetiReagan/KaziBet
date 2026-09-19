import { TenantId, EventId, generateId } from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase, EventEntity } from '@kazibet/database';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { TenantContextHolder } from '@kazibet/tenant';

export interface SeededMatch {
  event: EventEntity;
  marketId: string;
  selections: { homeId: string; drawId: string; awayId: string };
}

export class MatchSimulator {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly sportsService: SportsService,
    private readonly oddsEngine: OddsEngine
  ) {}

  public async seedDefaultFixtures(tenantId: TenantId): Promise<SeededMatch[]> {
    const seededMatches: SeededMatch[] = [];

    const fixtures = [
      {
        comp: 'Kenya Premier League',
        home: 'Gor Mahia',
        away: 'AFC Leopards',
        homeOdds: 1.85,
        drawOdds: 3.20,
        awayOdds: 4.50
      },
      {
        comp: 'English Premier League',
        home: 'Arsenal',
        away: 'Chelsea',
        homeOdds: 2.10,
        drawOdds: 3.40,
        awayOdds: 3.60
      },
      {
        comp: 'UEFA Champions League',
        home: 'Real Madrid',
        away: 'Bayern Munich',
        homeOdds: 2.25,
        drawOdds: 3.50,
        awayOdds: 3.10
      }
    ];

    for (const f of fixtures) {
      const event = await this.sportsService.ingestExternalEvent(tenantId, {
        providerId: `sim-${generateId().slice(0, 8)}`,
        sport: 'football',
        competitionName: f.comp,
        homeTeamName: f.home,
        awayTeamName: f.away,
        startTime: new Date().toISOString(),
        status: 'SCHEDULED'
      });

      const { market, selections } = await this.oddsEngine.createMarketWithSelections({
        tenantId,
        eventId: event.id,
        marketType: '1X2',
        name: 'Full Time Result (1X2)',
        selections: [
          { name: f.home, odds: f.homeOdds },
          { name: 'Draw', odds: f.drawOdds },
          { name: 'Away', odds: f.awayOdds }
        ]
      });

      seededMatches.push({
        event,
        marketId: market.id,
        selections: {
          homeId: selections[0]!.id,
          drawId: selections[1]!.id,
          awayId: selections[2]!.id
        }
      });
    }

    return seededMatches;
  }

  public async simulateGoalEvent(
    tenantId: TenantId,
    eventId: EventId,
    scoringTeam: 'HOME' | 'AWAY',
    marketId: string,
    homeSelId: string,
    awaySelId: string
  ): Promise<EventEntity> {
    const ctx = this.db.getContext();
    const event = await ctx.events.findById(tenantId, eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    // 1. Suspend market temporarily for goal / VAR check
    await this.oddsEngine.suspendMarket(tenantId, marketId, 'GOAL_SCORED');

    // 2. Increment score
    const newHome = scoringTeam === 'HOME' ? event.homeScore + 1 : event.homeScore;
    const newAway = scoringTeam === 'AWAY' ? event.awayScore + 1 : event.awayScore;
    const updatedEvent = await this.sportsService.updateScore(tenantId, eventId, newHome, newAway, 'Live');

    // 3. Shift live odds
    if (scoringTeam === 'HOME') {
      await this.oddsEngine.updateSelectionOdds(tenantId, homeSelId, 1.25, 'GOAL_CONCEDED_BY_AWAY');
      await this.oddsEngine.updateSelectionOdds(tenantId, awaySelId, 8.50, 'AWAY_TRAILED');
    } else {
      await this.oddsEngine.updateSelectionOdds(tenantId, homeSelId, 5.00, 'HOME_TRAILED');
      await this.oddsEngine.updateSelectionOdds(tenantId, awaySelId, 1.45, 'GOAL_SCORED_BY_AWAY');
    }

    // 4. Resume market
    await this.oddsEngine.resumeMarket(tenantId, marketId);

    return updatedEvent;
  }
}
