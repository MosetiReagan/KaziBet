import { SelectionStatus } from '@kazibet/shared';

export interface EventScoreResult {
  homeScore: number;
  awayScore: number;
  status: string; // FINISHED, CANCELLED, POSTPONED, ABANDONED
  winningSelectionNames?: string[]; // Optional for dead-heat outrights
  deadHeatPlaces?: number;          // e.g. 1
}

export interface SelectionOutcome {
  status: SelectionStatus;
  deadHeatFactor: number; // 1.0 means no dead heat. 0.5 means 2-way tie, etc.
}

export class SettlementRuleEvaluator {
  /**
   * Helper to parse handicap value from selection name if not in parameters.
   * e.g. "Arsenal (-0.25)" -> -0.25, "Chelsea (+0.25)" -> 0.25
   */
  public static parseHandicapFromName(name: string): number | null {
    const match = name.match(/([+-]?\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]!) : null;
  }

  public static evaluateMarketWithOutcomes(
    marketType: string,
    parameters: Record<string, unknown>,
    selections: { id: string; name: string }[],
    result: EventScoreResult
  ): Map<string, SelectionOutcome> {
    const outcomeMap = new Map<string, SelectionOutcome>();

    const upperStatus = result.status.toUpperCase();
    if (upperStatus === 'CANCELLED' || upperStatus === 'POSTPONED' || upperStatus === 'ABANDONED') {
      for (const sel of selections) {
        outcomeMap.set(sel.id, { status: 'VOID', deadHeatFactor: 1.0 });
      }
      return outcomeMap;
    }

    const { homeScore, awayScore } = result;
    const type = marketType.toUpperCase();

    switch (type) {
      case '1X2': {
        let winningName = 'Draw';
        if (homeScore > awayScore) winningName = 'Home';
        else if (awayScore > homeScore) winningName = 'Away';

        for (const sel of selections) {
          const isWinner =
            sel.name.toLowerCase() === winningName.toLowerCase() ||
            (winningName === 'Home' && !sel.name.toLowerCase().includes('draw') && !sel.name.toLowerCase().includes('away')) ||
            (winningName === 'Away' && !sel.name.toLowerCase().includes('draw') && !sel.name.toLowerCase().includes('home'));
          outcomeMap.set(sel.id, { status: isWinner ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
        }
        break;
      }

      case 'DOUBLE_CHANCE': {
        const isHomeWin = homeScore > awayScore;
        const isDraw = homeScore === awayScore;
        const isAwayWin = awayScore > homeScore;

        for (const sel of selections) {
          const n = sel.name.toUpperCase().replace(/\s+/g, '');
          let won = false;
          if (n === '1X' || n.includes('HOMEORDRAW') || (n.includes('HOME') && n.includes('DRAW'))) {
            won = isHomeWin || isDraw;
          } else if (n === 'X2' || n.includes('DRAWORAWAY') || (n.includes('AWAY') && n.includes('DRAW'))) {
            won = isAwayWin || isDraw;
          } else if (n === '12' || n.includes('HOMEORAWAY') || (n.includes('HOME') && n.includes('AWAY'))) {
            won = isHomeWin || isAwayWin;
          }
          outcomeMap.set(sel.id, { status: won ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
        }
        break;
      }

      case 'DRAW_NO_BET':
      case 'DNB': {
        const isDraw = homeScore === awayScore;
        const isHomeWin = homeScore > awayScore;

        for (const sel of selections) {
          if (isDraw) {
            outcomeMap.set(sel.id, { status: 'VOID', deadHeatFactor: 1.0 });
          } else {
            const isHomeSel = sel.name.toLowerCase().includes('home') || sel.name.toLowerCase() === '1';
            const won = isHomeSel ? isHomeWin : !isHomeWin;
            outcomeMap.set(sel.id, { status: won ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
          }
        }
        break;
      }

      case 'OVER_UNDER': {
        const line = Number(parameters['line'] ?? 2.5);
        const totalGoals = homeScore + awayScore;
        for (const sel of selections) {
          if (sel.name.toLowerCase().includes('over')) {
            outcomeMap.set(sel.id, { status: totalGoals > line ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
          } else {
            outcomeMap.set(sel.id, { status: totalGoals < line ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
          }
        }
        break;
      }

      case 'BOTH_TEAMS_TO_SCORE': {
        const btts = homeScore > 0 && awayScore > 0;
        for (const sel of selections) {
          if (sel.name.toLowerCase() === 'yes') {
            outcomeMap.set(sel.id, { status: btts ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
          } else {
            outcomeMap.set(sel.id, { status: !btts ? 'WON' : 'LOST', deadHeatFactor: 1.0 });
          }
        }
        break;
      }

      case 'ASIAN_HANDICAP':
      case 'AH': {
        // Goal difference from home perspective: D = homeScore - awayScore
        const diff = homeScore - awayScore;

        for (const sel of selections) {
          // Determine handicap: from parameters or selection name
          let handicap = typeof parameters['handicap'] === 'number' ? (parameters['handicap'] as number) : 0;
          const parsed = this.parseHandicapFromName(sel.name);
          if (parsed !== null) {
            handicap = parsed;
          } else if (sel.name.toLowerCase().includes('away')) {
            handicap = -handicap;
          }

          // If selection is Away and handicap wasn't explicitly signed from name, flip perspective
          const isAway = sel.name.toLowerCase().includes('away') && parsed === null;
          const effectiveDiff = isAway ? (-diff + handicap) : (diff + handicap);

          // Precision rounding to avoid floating point anomalies (e.g. 0.2500000000000001)
          const E = Math.round(effectiveDiff * 100) / 100;

          let status: SelectionStatus = 'LOST';
          if (E > 0.25) {
            status = 'WON';
          } else if (E === 0.25) {
            status = 'HALF_WON';
          } else if (E === 0) {
            status = 'VOID'; // Push
          } else if (E === -0.25) {
            status = 'HALF_LOST';
          } else {
            status = 'LOST';
          }

          outcomeMap.set(sel.id, { status, deadHeatFactor: 1.0 });
        }
        break;
      }

      case 'DEAD_HEAT':
      case 'OUTRIGHT': {
        // Evaluate dead heat when multiple selections tie
        const winningNames = result.winningSelectionNames || (parameters['winningSelectionNames'] as string[]) || [];
        const places = result.deadHeatPlaces || Number(parameters['deadHeatPlaces'] ?? 1);

        const winnersCount = winningNames.length;
        const deadHeatFactor = winnersCount > places ? places / winnersCount : 1.0;

        for (const sel of selections) {
          const isWinner = winningNames.some((w) => w.toLowerCase() === sel.name.toLowerCase());
          outcomeMap.set(sel.id, {
            status: isWinner ? 'WON' : 'LOST',
            deadHeatFactor: isWinner ? deadHeatFactor : 1.0
          });
        }
        break;
      }

      default: {
        for (const sel of selections) {
          outcomeMap.set(sel.id, { status: 'VOID', deadHeatFactor: 1.0 });
        }
      }
    }

    return outcomeMap;
  }

  public static evaluateMarket(
    marketType: string,
    parameters: Record<string, unknown>,
    selections: { id: string; name: string }[],
    result: EventScoreResult
  ): Map<string, SelectionStatus> {
    const outcomes = this.evaluateMarketWithOutcomes(marketType, parameters, selections, result);
    const simpleMap = new Map<string, SelectionStatus>();
    for (const [key, val] of outcomes) {
      simpleMap.set(key, val.status);
    }
    return simpleMap;
  }
}
