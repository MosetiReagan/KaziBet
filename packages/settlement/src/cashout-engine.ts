import {
  generateId,
  TenantId,
  BetId,
  KaziBetError,
  createDomainEvent
} from '@kazibet/shared';
import { IDatabase, BetEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine, STANDARD_ACCOUNTS } from '@kazibet/ledger';

export class CashoutEngine {
  constructor(
    private readonly db: IDatabase,
    private readonly ledger: LedgerEngine
  ) {}

  public async getCashoutQuote(tenantId: TenantId, betId: BetId): Promise<{ eligible: boolean; cashoutCents: bigint; reason?: string }> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();
    const bet = await ctx.bets.findById(tenantId, betId);

    if (!bet || bet.status !== 'PLACED') {
      return { eligible: false, cashoutCents: 0n, reason: 'Bet is not open for cashout.' };
    }

    // Deterministic sandbox quote: 80% of potential payout
    const fairValue = (bet.potentialPayoutCents * 80n) / 100n;
    return {
      eligible: true,
      cashoutCents: fairValue
    };
  }

  public async executeCashout(tenantId: TenantId, betId: BetId, acceptedCashoutCents: bigint): Promise<BetEntity> {
    TenantContextHolder.assertTenant(tenantId);

    return await this.db.transaction(async (tx) => {
      const bet = await tx.bets.findById(tenantId, betId);
      if (!bet || bet.status !== 'PLACED') {
        throw new KaziBetError('VALIDATION_FAILED', 'Bet is no longer eligible for cashout.');
      }

      const userHoldDef = STANDARD_ACCOUNTS.USER_HOLD(bet.userId);
      const userAvailDef = STANDARD_ACCOUNTS.USER_AVAILABLE(bet.userId);

      const holdAcc = await this.ledger.getOrCreateAccount({
        tenantId,
        code: userHoldDef.code,
        type: userHoldDef.type,
        currency: 'KES'
      });

      const availAcc = await this.ledger.getOrCreateAccount({
        tenantId,
        code: userAvailDef.code,
        type: userAvailDef.type,
        currency: 'KES'
      });

      // Balancing journal entries
      const lines = [
        { accountId: holdAcc.id, direction: 'DR' as const, amountCents: bet.stakeCents, currency: 'KES' as const },
        { accountId: availAcc.id, direction: 'CR' as const, amountCents: acceptedCashoutCents, currency: 'KES' as const }
      ];

      if (acceptedCashoutCents > bet.stakeCents) {
        const extra = acceptedCashoutCents - bet.stakeCents;
        const payoutExpAcc = await this.ledger.getOrCreateAccount({
          tenantId,
          code: STANDARD_ACCOUNTS.GAMING_PAYOUT.code,
          type: STANDARD_ACCOUNTS.GAMING_PAYOUT.type,
          currency: 'KES'
        });
        lines.push({ accountId: payoutExpAcc.id, direction: 'DR', amountCents: extra, currency: 'KES' });
      } else if (acceptedCashoutCents < bet.stakeCents) {
        const remainingToHouse = bet.stakeCents - acceptedCashoutCents;
        const ggrAcc = await this.ledger.getOrCreateAccount({
          tenantId,
          code: STANDARD_ACCOUNTS.GGR_REVENUE.code,
          type: STANDARD_ACCOUNTS.GGR_REVENUE.type,
          currency: 'KES'
        });
        lines.push({ accountId: ggrAcc.id, direction: 'CR', amountCents: remainingToHouse, currency: 'KES' });
      }

      await this.ledger.postJournal({
        tenantId,
        idempotencyKey: `journal-cashout-${bet.id}`,
        referenceType: 'CASHOUT',
        referenceId: bet.id,
        description: `Early cashout for bet ${bet.id}`,
        lines
      });

      // Update wallet
      const wallet = await tx.wallets.findFirst(tenantId, { userId: bet.userId });
      if (wallet) {
        await tx.wallets.update(tenantId, wallet.id, {
          availableCents: wallet.availableCents + acceptedCashoutCents,
          heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
          version: wallet.version + 1n,
          updatedAt: new Date()
        });
      }

      // Mark bet CASHED_OUT
      const updatedBet = await tx.bets.update(tenantId, bet.id, {
        status: 'CASHED_OUT',
        payoutCents: acceptedCashoutCents,
        settledAt: new Date()
      });

      return updatedBet;
    });
  }
}
