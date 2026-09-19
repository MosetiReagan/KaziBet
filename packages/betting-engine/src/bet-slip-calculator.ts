import { Money } from '@kazibet/shared';

export interface SlipLegInput {
  selectionId: string;
  marketId: string;
  eventId: string;
  odds: number;
}

export class BetSlipCalculator {
  /**
   * Calculates accumulator combined odds:
   * Total Odds = Product of all individual leg odds, rounded to 4 decimal places.
   */
  public static calculateAccumulatorOdds(legs: { odds: number }[]): number {
    if (legs.length === 0) return 1.0;
    let totalOdds = 1.0;
    for (const leg of legs) {
      totalOdds *= leg.odds;
    }
    return Number(totalOdds.toFixed(4));
  }

  /**
   * Calculates potential payout:
   * Potential Payout = Stake * Total Odds
   */
  public static calculatePayout(stake: Money, totalOdds: number, maxPayout?: Money): Money {
    const calculated = stake.multiplyByDecimal(totalOdds);
    if (maxPayout && calculated.isGreaterThan(maxPayout)) {
      return maxPayout;
    }
    return calculated;
  }

  /**
   * Asserts no conflicting selections in the same bet slip.
   * e.g., Multiple selections from the same event are forbidden in standard accumulators.
   */
  public static validateCorrelatedSelections(legs: SlipLegInput[]): void {
    const eventIds = new Set<string>();
    for (const leg of legs) {
      if (eventIds.has(leg.eventId)) {
        throw new Error(`Correlated market error: multiple selections from event ${leg.eventId} cannot be combined in an accumulator.`);
      }
      eventIds.add(leg.eventId);
    }
  }
}
