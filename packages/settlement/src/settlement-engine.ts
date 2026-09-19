import {
  generateId,
  TenantId,
  EventId,
  BetStatus,
  createDomainEvent
} from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase, BetEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine, STANDARD_ACCOUNTS } from '@kazibet/ledger';
import { SettlementRuleEvaluator, EventScoreResult } from './rule-evaluator.js';
import { TaxCalculator } from './tax-calculator.js';

export interface SettleEventOptions {
  tenantId: TenantId;
  eventId: EventId;
  result: EventScoreResult;
  taxPercentage?: number; // e.g. 20.0
  taxBeneficiary?: string; // e.g. 'KRA'
}

export class SettlementEngine {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly ledger: LedgerEngine
  ) {}

  public async settleEventMarkets(options: SettleEventOptions): Promise<{ settledBetsCount: number }> {
    TenantContextHolder.assertTenant(options.tenantId);
    const taxRate = options.taxPercentage ?? 20.0;
    const beneficiary = options.taxBeneficiary || 'KRA';

    return await this.db.transaction(async (tx) => {
      // 1. Load markets for event
      const markets = await tx.markets.findMany(options.tenantId, { eventId: options.eventId });
      const settledLegIds = new Set<string>();

      for (const market of markets) {
        const selections = await tx.selections.findMany({ marketId: market.id });
        const outcomes = SettlementRuleEvaluator.evaluateMarket(
          market.marketType,
          market.parameters,
          selections,
          options.result
        );

        for (const sel of selections) {
          const status = outcomes.get(sel.id) || 'LOST';
          await tx.selections.update(sel.id, { status, updatedAt: new Date() });
        }

        await tx.markets.update(options.tenantId, market.id, {
          status: 'SETTLED',
          updatedAt: new Date()
        });

        // Update bet legs referencing these selections
        const allLegs = await tx.betLegs.findMany();
        for (const leg of allLegs) {
          if (leg.eventId === options.eventId) {
            const outcome = (outcomes.get(leg.selectionId) || 'LOST') as 'WON' | 'LOST' | 'VOID';
            await tx.betLegs.update(leg.id, { status: outcome });
            settledLegIds.add(leg.id);
          }
        }
      }

      // 2. Resolve placed bets
      const activeBets = await tx.bets.findMany(options.tenantId, { status: 'PLACED' });
      let settledBetsCount = 0;

      for (const bet of activeBets) {
        const legs = await tx.betLegs.findMany({ betId: bet.id });
        const allLegsSettled = legs.every(l => l.status !== 'PENDING');

        if (!allLegsSettled) continue; // Waiting on other events in accumulator

        const hasLoss = legs.some(l => l.status === 'LOST');
        const allWon = legs.every(l => l.status === 'WON');
        const allVoid = legs.every(l => l.status === 'VOID');

        let finalStatus: BetStatus = 'LOST';
        if (allWon) finalStatus = 'WON';
        else if (allVoid) finalStatus = 'VOIDED';

        // Settle Hold Account & Materialized Wallet
        const userHoldDef = STANDARD_ACCOUNTS.USER_HOLD(bet.userId);
        const userAvailDef = STANDARD_ACCOUNTS.USER_AVAILABLE(bet.userId);

        const holdAcc = await this.ledger.getOrCreateAccount({
          tenantId: options.tenantId,
          code: userHoldDef.code,
          type: userHoldDef.type,
          currency: 'KES'
        });

        const availAcc = await this.ledger.getOrCreateAccount({
          tenantId: options.tenantId,
          code: userAvailDef.code,
          type: userAvailDef.type,
          currency: 'KES'
        });

        let payoutCents = 0n;

        if (finalStatus === 'WON') {
          const taxRes = TaxCalculator.calculateWithholdingTax(bet.stakeCents, bet.potentialPayoutCents, taxRate);
          payoutCents = taxRes.netUserPayoutCents;

          // Double-entry Journal for Won Bet:
          // DEBIT:  LIABILITY:USER_HOLD (stake)
          // DEBIT:  EXPENSE:GAMING_PAYOUT (gross winnings above stake)
          // CREDIT: LIABILITY:USER_AVAILABLE (stake + net winnings after tax)
          // CREDIT: LIABILITY:TAX_WITHHOLDING (tax withheld)
          const payoutExpenseAcc = await this.ledger.getOrCreateAccount({
            tenantId: options.tenantId,
            code: STANDARD_ACCOUNTS.GAMING_PAYOUT.code,
            type: STANDARD_ACCOUNTS.GAMING_PAYOUT.type,
            currency: 'KES'
          });

          const taxLiabilityAcc = await this.ledger.getOrCreateAccount({
            tenantId: options.tenantId,
            code: STANDARD_ACCOUNTS.TAX_WITHHOLDING(beneficiary).code,
            type: STANDARD_ACCOUNTS.TAX_WITHHOLDING(beneficiary).type,
            currency: 'KES'
          });

          const grossWinnings = bet.potentialPayoutCents - bet.stakeCents;

          const lines: { accountId: string; direction: 'DR' | 'CR'; amountCents: bigint; currency: 'KES' }[] = [
            { accountId: holdAcc.id, direction: 'DR', amountCents: bet.stakeCents, currency: 'KES' }
          ];

          if (grossWinnings > 0n) {
            lines.push({ accountId: payoutExpenseAcc.id, direction: 'DR', amountCents: grossWinnings, currency: 'KES' });
          }

          lines.push({ accountId: availAcc.id, direction: 'CR', amountCents: taxRes.netUserPayoutCents, currency: 'KES' });

          if (taxRes.taxWithheldCents > 0n) {
            lines.push({ accountId: taxLiabilityAcc.id, direction: 'CR', amountCents: taxRes.taxWithheldCents, currency: 'KES' });
          }

          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `journal-settle-win-${bet.id}`,
            referenceType: 'BET_WIN',
            referenceId: bet.id,
            description: `Winnings payout for bet ${bet.id}`,
            lines
          });

          // Update Wallet
          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              availableCents: wallet.availableCents + taxRes.netUserPayoutCents,
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        } else if (finalStatus === 'LOST') {
          // Double-entry Journal for Lost Bet:
          // DEBIT:  LIABILITY:USER_HOLD (stake)
          // CREDIT: REVENUE:GGR (stake -> operator revenue)
          const ggrAcc = await this.ledger.getOrCreateAccount({
            tenantId: options.tenantId,
            code: STANDARD_ACCOUNTS.GGR_REVENUE.code,
            type: STANDARD_ACCOUNTS.GGR_REVENUE.type,
            currency: 'KES'
          });

          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `journal-settle-loss-${bet.id}`,
            referenceType: 'BET_LOSS',
            referenceId: bet.id,
            description: `GGR revenue from lost bet ${bet.id}`,
            lines: [
              { accountId: holdAcc.id, direction: 'DR', amountCents: bet.stakeCents, currency: 'KES' },
              { accountId: ggrAcc.id, direction: 'CR', amountCents: bet.stakeCents, currency: 'KES' }
            ]
          });

          // Release hold from wallet
          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        } else if (finalStatus === 'VOIDED') {
          // Stake returned: DR Hold, CR Available
          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `journal-settle-void-${bet.id}`,
            referenceType: 'BET_VOID',
            referenceId: bet.id,
            description: `Stake returned for voided bet ${bet.id}`,
            lines: [
              { accountId: holdAcc.id, direction: 'DR', amountCents: bet.stakeCents, currency: 'KES' },
              { accountId: availAcc.id, direction: 'CR', amountCents: bet.stakeCents, currency: 'KES' }
            ]
          });

          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              availableCents: wallet.availableCents + bet.stakeCents,
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        }

        await tx.bets.update(options.tenantId, bet.id, {
          status: finalStatus,
          payoutCents,
          settledAt: new Date()
        });

        // Update WalletHold entity
        const hold = await tx.walletHolds.findFirst(options.tenantId, { betId: bet.id });
        if (hold) {
          await tx.walletHolds.update(options.tenantId, hold.id, {
            status: finalStatus === 'WON' ? 'COMMITTED' : 'RELEASED',
            updatedAt: new Date()
          });
        }

        // Emit domain event
        const settleEvent = createDomainEvent({
          tenantId: options.tenantId,
          name: 'BetSettled',
          aggregateType: 'Bet',
          aggregateId: bet.id,
          payload: {
            betId: bet.id,
            userId: bet.userId,
            status: finalStatus,
            stakeCents: bet.stakeCents.toString(),
            payoutCents: payoutCents.toString()
          }
        });

        await tx.outboxEvents.create(options.tenantId, {
          id: settleEvent.id,
          tenantId: options.tenantId,
          eventName: settleEvent.name,
          aggregateType: settleEvent.aggregateType,
          aggregateId: settleEvent.aggregateId,
          payload: settleEvent.payload,
          status: 'PENDING',
          retryCount: 0,
          createdAt: new Date()
        });

        settledBetsCount++;
      }

      return { settledBetsCount };
    });
  }
}
