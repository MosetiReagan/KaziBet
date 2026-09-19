export interface TaxCalculationResult {
  grossPayoutCents: bigint;
  stakeCents: bigint;
  netWinningsCents: bigint;
  taxWithheldCents: bigint;
  netUserPayoutCents: bigint;
}

export class TaxCalculator {
  public static calculateWithholdingTax(
    stakeCents: bigint,
    grossPayoutCents: bigint,
    taxPercentage: number
  ): TaxCalculationResult {
    if (grossPayoutCents <= stakeCents || taxPercentage <= 0) {
      return {
        grossPayoutCents,
        stakeCents,
        netWinningsCents: 0n,
        taxWithheldCents: 0n,
        netUserPayoutCents: grossPayoutCents
      };
    }

    const netWinningsCents = grossPayoutCents - stakeCents;
    // Round half up
    const taxRateScaled = BigInt(Math.round(taxPercentage * 100)); // e.g. 20.0% -> 2000
    const taxWithheldCents = (netWinningsCents * taxRateScaled + 5000n) / 10000n;
    const netUserPayoutCents = grossPayoutCents - taxWithheldCents;

    return {
      grossPayoutCents,
      stakeCents,
      netWinningsCents,
      taxWithheldCents,
      netUserPayoutCents
    };
  }
}
