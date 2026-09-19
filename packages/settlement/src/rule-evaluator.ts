import { SelectionStatus } from '@kazibet/shared';

export interface EventScoreResult {
  homeScore: number;
  awayScore: number;
  status: string; // FINISHED, CANCELLED, POSTPONED
}

export class SettlementRuleEvaluator {
  public static evaluateMarket(
    marketType: string,
    parameters: Record<string, unknown>,
    selections: { id: string; name: string }[],
    result: EventScoreResult
  ): Map<string, SelectionStatus> {
    const outcomeMap = new Map<string, SelectionStatus>();

    if (result.status === 'CANCELLED' || result.status === 'POSTPONED') {
      for (const sel of selections) {
        outcomeMap.set(sel.id, 'VOID');
      }
      return outcomeMap;
    }

    const { homeScore, awayScore } = result;

    switch (marketType.toUpperCase()) {
      case '1X2': {
        let winningName = 'Draw';
        if (homeScore > awayScore) winningName = 'Home';
        else if (awayScore > homeScore) winningName = 'Away';

        for (const sel of selections) {
          const isWinner =
            sel.name.toLowerCase() === winningName.toLowerCase() ||
            (winningName === 'Home' && !sel.name.toLowerCase().includes('draw') && !sel.name.toLowerCase().includes('away')) ||
            (winningName === 'Away' && !sel.name.toLowerCase().includes('draw') && !sel.name.toLowerCase().includes('home'));
          outcomeMap.set(sel.id, isWinner ? 'WON' : 'LOST');
        }
        break;
      }

      case 'OVER_UNDER': {
        const line = Number(parameters['line'] ?? 2.5);
        const totalGoals = homeScore + awayScore;
        for (const sel of selections) {
          if (sel.name.toLowerCase().includes('over')) {
            outcomeMap.set(sel.id, totalGoals > line ? 'WON' : 'LOST');
          } else {
            outcomeMap.set(sel.id, totalGoals < line ? 'WON' : 'LOST');
          }
        }
        break;
      }

      case 'BOTH_TEAMS_TO_SCORE': {
        const btts = homeScore > 0 && awayScore > 0;
        for (const sel of selections) {
          if (sel.name.toLowerCase() === 'yes') {
            outcomeMap.set(sel.id, btts ? 'WON' : 'LOST');
          } else {
            outcomeMap.set(sel.id, !btts ? 'WON' : 'LOST');
          }
        }
        break;
      }

      default: {
        for (const sel of selections) {
          outcomeMap.set(sel.id, 'VOID');
        }
      }
    }

    return outcomeMap;
  }
}
