/**
 * Bet calculation engine for KaziBet Web Bettor UI.
 * Enforces bigint cents for financial precision and Kenya 20% Withholding Tax (WHT).
 */

export interface BetSlipLeg {
  selectionId: string;
  marketId: string;
  eventId: string;
  name: string;
  odds: number;
  isSuspended?: boolean;
}

export interface BetSlipCalculation {
  totalOdds: number;
  stakeCents: bigint;
  grossPayoutCents: bigint;
  netWinningsCents: bigint;
  whtCents: bigint;
  netPayoutCents: bigint;
  isPlaceable: boolean;
  validationError?: string;
}

export class BetCalculator {
  public static readonly WHT_RATE = 0.20; // 20% Kenya Withholding Tax on net winnings

  /**
   * Parse a KES decimal number or string into bigint cents.
   * e.g. "100.50" -> 10050n
   */
  public static parseKesToCents(kes: number | string): bigint {
    const num = typeof kes === 'string' ? parseFloat(kes) : kes;
    if (isNaN(num) || num <= 0) return 0n;
    return BigInt(Math.round(num * 100));
  }

  /**
   * Format bigint cents into standard KES display string.
   * e.g. 10050n -> "KES 100.50"
   */
  public static formatCentsToKes(cents: bigint): string {
    const isNegative = cents < 0n;
    const absCents = isNegative ? -cents : cents;
    const shillings = absCents / 100n;
    const remainder = absCents % 100n;
    const formatted = `${shillings.toLocaleString('en-US')}.${remainder.toString().padStart(2, '0')}`;
    return isNegative ? `-KES ${formatted}` : `KES ${formatted}`;
  }

  /**
   * Calculate cumulative odds for a set of legs.
   */
  public static computeCumulativeOdds(legs: BetSlipLeg[]): number {
    if (legs.length === 0) return 1.0;
    const product = legs.reduce((acc, leg) => acc * leg.odds, 1.0);
    return Number(product.toFixed(4));
  }

  /**
   * Compute bet slip financials:
   * - Gross Payout = stake * odds
   * - Net Winnings = max(0, gross - stake)
   * - WHT (20%) = round(netWinnings * 0.20)
   * - Net User Payout = gross - WHT
   */
  public static calculate(
    legs: BetSlipLeg[],
    stakeCents: bigint,
    userAvailableCents?: bigint
  ): BetSlipCalculation {
    if (legs.length === 0) {
      return {
        totalOdds: 1.0,
        stakeCents: 0n,
        grossPayoutCents: 0n,
        netWinningsCents: 0n,
        whtCents: 0n,
        netPayoutCents: 0n,
        isPlaceable: false,
        validationError: 'Please add at least one selection to your bet slip.'
      };
    }

    const anySuspended = legs.some((l) => l.isSuspended);
    if (anySuspended) {
      const totalOdds = this.computeCumulativeOdds(legs);
      return {
        totalOdds,
        stakeCents,
        grossPayoutCents: 0n,
        netWinningsCents: 0n,
        whtCents: 0n,
        netPayoutCents: 0n,
        isPlaceable: false,
        validationError: 'One or more selections are currently suspended.'
      };
    }

    if (stakeCents <= 0n) {
      const totalOdds = this.computeCumulativeOdds(legs);
      return {
        totalOdds,
        stakeCents,
        grossPayoutCents: 0n,
        netWinningsCents: 0n,
        whtCents: 0n,
        netPayoutCents: 0n,
        isPlaceable: false,
        validationError: 'Stake must be greater than zero.'
      };
    }

    if (userAvailableCents !== undefined && userAvailableCents < stakeCents) {
      const totalOdds = this.computeCumulativeOdds(legs);
      return {
        totalOdds,
        stakeCents,
        grossPayoutCents: 0n,
        netWinningsCents: 0n,
        whtCents: 0n,
        netPayoutCents: 0n,
        isPlaceable: false,
        validationError: 'Insufficient available wallet balance.'
      };
    }

    const totalOdds = this.computeCumulativeOdds(legs);
    const oddsScaled = BigInt(Math.round(totalOdds * 10000));
    const grossPayoutCents = (stakeCents * oddsScaled) / 10000n;

    let netWinningsCents = 0n;
    let whtCents = 0n;

    if (grossPayoutCents > stakeCents) {
      netWinningsCents = grossPayoutCents - stakeCents;
      // 20% WHT: (netWinnings * 2000 + 5000) / 10000
      whtCents = (netWinningsCents * 2000n + 5000n) / 10000n;
    }

    const netPayoutCents = grossPayoutCents - whtCents;

    return {
      totalOdds,
      stakeCents,
      grossPayoutCents,
      netWinningsCents,
      whtCents,
      netPayoutCents,
      isPlaceable: true
    };
  }
}
