import { TenantId, Money } from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';

export interface OperatorFinancialMetrics {
  totalTurnoverCents: bigint;
  totalPayoutsCents: bigint;
  ggrCents: bigint; // Gross Gaming Revenue = Turnover - Payouts
  ngrCents: bigint; // Net Gaming Revenue (estimated after 20% withholding/excise tax)
  marginPercentage: number;
  totalBetsCount: number;
  activeBettorsCount: number;
}

export class AnalyticsAggregator {
  constructor(private readonly db: InMemoryDatabase) {}

  public async computeFinancialMetrics(tenantId: TenantId): Promise<OperatorFinancialMetrics> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();

    const bets = await ctx.bets.findMany(tenantId);
    let totalTurnoverCents = 0n;
    let totalPayoutsCents = 0n;
    const activeUserSet = new Set<string>();

    for (const b of bets) {
      totalTurnoverCents += b.stakeCents;
      if (b.status === 'WON' || b.status === 'CASHED_OUT') {
        totalPayoutsCents += b.payoutCents;
      }
      activeUserSet.add(b.userId);
    }

    const ggrCents = totalTurnoverCents - totalPayoutsCents;
    // Estimated NGR: GGR - 15% estimated operational taxes
    const ngrCents = (ggrCents * 85n) / 100n;

    const marginPercentage = totalTurnoverCents > 0n
      ? Number((Number(ggrCents) / Number(totalTurnoverCents)) * 100).toFixed(2)
      : '0.00';

    return {
      totalTurnoverCents,
      totalPayoutsCents,
      ggrCents,
      ngrCents,
      marginPercentage: parseFloat(marginPercentage),
      totalBetsCount: bets.length,
      activeBettorsCount: activeUserSet.size
    };
  }
}
