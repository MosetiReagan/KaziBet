import {
  generateId,
  TenantId,
  EventId,
  BetStatus,
  KaziBetError,
  createDomainEvent
} from '@kazibet/shared';
import { InMemoryDatabase, BetEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine, STANDARD_ACCOUNTS } from '@kazibet/ledger';
import { SettlementRuleEvaluator, EventScoreResult, SelectionOutcome } from './rule-evaluator.js';
import { TaxCalculator } from './tax-calculator.js';

export interface SettleEventOptions {
  tenantId: TenantId;
  eventId: EventId;
  result: EventScoreResult;
  taxPercentage?: number; // e.g. 20.0
  taxBeneficiary?: string; // e.g. 'KRA'
}

export interface ResettleEventOptions {
  tenantId: TenantId;
  eventId: EventId;
  correctedResult: EventScoreResult;
  operatorId: string;
  reason: string;
  correctionWindowSeconds?: number; // default: 7200 (2 hours)
  force?: boolean;
  allowNegativeBalance?: boolean;
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
      const marketOutcomes = new Map<string, SelectionOutcome>();

      for (const market of markets) {
        const selections = await tx.selections.findMany({ marketId: market.id });
        const outcomes = SettlementRuleEvaluator.evaluateMarketWithOutcomes(
          market.marketType,
          market.parameters,
          selections,
          options.result
        );

        for (const sel of selections) {
          const outcome = outcomes.get(sel.id) || { status: 'LOST', deadHeatFactor: 1.0 };
          marketOutcomes.set(sel.id, outcome);
          await tx.selections.update(sel.id, { status: outcome.status, updatedAt: new Date() });
        }

        await tx.markets.update(options.tenantId, market.id, {
          status: 'SETTLED',
          updatedAt: new Date()
        });

        // Update bet legs referencing these selections
        const allLegs = await tx.betLegs.findMany();
        for (const leg of allLegs) {
          if (leg.eventId === options.eventId) {
            const outcome = marketOutcomes.get(leg.selectionId) || { status: 'LOST', deadHeatFactor: 1.0 };
            const legStatus = outcome.status as 'WON' | 'LOST' | 'HALF_WON' | 'HALF_LOST' | 'VOID';
            await tx.betLegs.update(leg.id, { status: legStatus });
          }
        }
      }

      // Mark event as finished / settled
      await tx.events.update(options.tenantId, options.eventId, {
        status: options.result.status === 'CANCELLED' || options.result.status === 'POSTPONED' ? 'CANCELLED' : 'FINISHED',
        homeScore: options.result.homeScore,
        awayScore: options.result.awayScore,
        updatedAt: new Date()
      });

      // 2. Resolve placed bets
      const activeBets = await tx.bets.findMany(options.tenantId, { status: 'PLACED' });
      let settledBetsCount = 0;

      for (const bet of activeBets) {
        const legs = await tx.betLegs.findMany({ betId: bet.id });
        const allLegsSettled = legs.every((l) => l.status !== 'PENDING');

        if (!allLegsSettled) continue; // Waiting on other events in accumulator

        // Evaluate overall bet outcome
        const hasLoss = legs.some((l) => l.status === 'LOST');
        const hasHalfLoss = legs.some((l) => l.status === 'HALF_LOST');
        const hasHalfWin = legs.some((l) => l.status === 'HALF_WON');
        const allWon = legs.every((l) => l.status === 'WON');
        const allVoid = legs.every((l) => l.status === 'VOID');

        let finalStatus: BetStatus = 'LOST';
        if (hasLoss) {
          finalStatus = 'LOST';
        } else if (hasHalfLoss) {
          finalStatus = 'HALF_LOST';
        } else if (hasHalfWin) {
          finalStatus = 'HALF_WON';
        } else if (allWon) {
          finalStatus = 'WON';
        } else if (allVoid) {
          finalStatus = 'VOIDED';
        }

        // Ledger Accounts Setup
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

        const ggrAcc = await this.ledger.getOrCreateAccount({
          tenantId: options.tenantId,
          code: STANDARD_ACCOUNTS.GGR_REVENUE.code,
          type: STANDARD_ACCOUNTS.GGR_REVENUE.type,
          currency: 'KES'
        });

        let payoutCents = 0n;

        // Check for dead heat factor on legs
        let minDeadHeatFactor = 1.0;
        for (const leg of legs) {
          const outcome = marketOutcomes.get(leg.selectionId);
          if (outcome && outcome.deadHeatFactor < minDeadHeatFactor) {
            minDeadHeatFactor = outcome.deadHeatFactor;
          }
        }

        if (finalStatus === 'WON') {
          if (minDeadHeatFactor < 1.0) {
            // Dead Heat Settlement:
            // Effective stake = stake * deadHeatFactor
            const effectiveStakeCents = (bet.stakeCents * BigInt(Math.round(minDeadHeatFactor * 10000))) / 10000n;
            const lostStakeCents = bet.stakeCents - effectiveStakeCents;
            const grossReturnCents = (effectiveStakeCents * BigInt(Math.round(bet.odds * 10000))) / 10000n;
            const payoutExpenseCents = grossReturnCents > effectiveStakeCents ? grossReturnCents - effectiveStakeCents : 0n;
            const taxRes = TaxCalculator.calculateWithholdingTax(effectiveStakeCents, grossReturnCents, taxRate);
            payoutCents = taxRes.netUserPayoutCents;

            const lines: { accountId: string; direction: 'DR' | 'CR'; amountCents: bigint; currency: 'KES' }[] = [
              { accountId: holdAcc.id, direction: 'DR', amountCents: bet.stakeCents, currency: 'KES' }
            ];

            if (payoutExpenseCents > 0n) {
              lines.push({ accountId: payoutExpenseAcc.id, direction: 'DR', amountCents: payoutExpenseCents, currency: 'KES' });
            }
            if (payoutCents > 0n) {
              lines.push({ accountId: availAcc.id, direction: 'CR', amountCents: payoutCents, currency: 'KES' });
            }
            if (taxRes.taxWithheldCents > 0n) {
              lines.push({ accountId: taxLiabilityAcc.id, direction: 'CR', amountCents: taxRes.taxWithheldCents, currency: 'KES' });
            }
            if (lostStakeCents > 0n) {
              lines.push({ accountId: ggrAcc.id, direction: 'CR', amountCents: lostStakeCents, currency: 'KES' });
            }

            await this.ledger.postJournal({
              tenantId: options.tenantId,
              idempotencyKey: `journal-settle-deadheat-${bet.id}`,
              referenceType: 'BET_WIN',
              referenceId: bet.id,
              description: `Dead heat winnings payout for bet ${bet.id} (factor: ${minDeadHeatFactor})`,
              lines
            });
          } else {
            // Full Win
            const taxRes = TaxCalculator.calculateWithholdingTax(bet.stakeCents, bet.potentialPayoutCents, taxRate);
            payoutCents = taxRes.netUserPayoutCents;
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
          }

          // Credit Wallet
          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              availableCents: wallet.availableCents + payoutCents,
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        } else if (finalStatus === 'HALF_WON') {
          // Asian Handicap Half-Win:
          // Half stake wins at full odds, other half is pushed (refunded)
          const halfStakeCents = bet.stakeCents / 2n;
          const pushStakeCents = bet.stakeCents - halfStakeCents;
          const winReturnCents = (halfStakeCents * BigInt(Math.round(bet.odds * 10000))) / 10000n;
          const totalGrossPayout = winReturnCents + pushStakeCents;
          const grossWinnings = totalGrossPayout > bet.stakeCents ? totalGrossPayout - bet.stakeCents : 0n;

          const taxRes = TaxCalculator.calculateWithholdingTax(bet.stakeCents, totalGrossPayout, taxRate);
          payoutCents = taxRes.netUserPayoutCents;

          const lines: { accountId: string; direction: 'DR' | 'CR'; amountCents: bigint; currency: 'KES' }[] = [
            { accountId: holdAcc.id, direction: 'DR', amountCents: bet.stakeCents, currency: 'KES' }
          ];

          if (grossWinnings > 0n) {
            lines.push({ accountId: payoutExpenseAcc.id, direction: 'DR', amountCents: grossWinnings, currency: 'KES' });
          }
          lines.push({ accountId: availAcc.id, direction: 'CR', amountCents: payoutCents, currency: 'KES' });

          if (taxRes.taxWithheldCents > 0n) {
            lines.push({ accountId: taxLiabilityAcc.id, direction: 'CR', amountCents: taxRes.taxWithheldCents, currency: 'KES' });
          }

          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `journal-settle-halfwin-${bet.id}`,
            referenceType: 'BET_WIN',
            referenceId: bet.id,
            description: `Asian handicap half-win payout for bet ${bet.id}`,
            lines
          });

          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              availableCents: wallet.availableCents + payoutCents,
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        } else if (finalStatus === 'HALF_LOST') {
          // Asian Handicap Half-Loss:
          // Half stake is lost to GGR, other half refunded to user
          const lostStakeCents = bet.stakeCents / 2n;
          const refundStakeCents = bet.stakeCents - lostStakeCents;
          payoutCents = refundStakeCents;

          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `journal-settle-halfloss-${bet.id}`,
            referenceType: 'BET_LOSS',
            referenceId: bet.id,
            description: `Asian handicap half-loss for bet ${bet.id}`,
            lines: [
              { accountId: holdAcc.id, direction: 'DR', amountCents: bet.stakeCents, currency: 'KES' },
              { accountId: availAcc.id, direction: 'CR', amountCents: refundStakeCents, currency: 'KES' },
              { accountId: ggrAcc.id, direction: 'CR', amountCents: lostStakeCents, currency: 'KES' }
            ]
          });

          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              availableCents: wallet.availableCents + refundStakeCents,
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        } else if (finalStatus === 'LOST') {
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

          const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
          if (wallet) {
            await tx.wallets.update(options.tenantId, wallet.id, {
              heldCents: wallet.heldCents >= bet.stakeCents ? wallet.heldCents - bet.stakeCents : 0n,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }
        } else if (finalStatus === 'VOIDED') {
          payoutCents = bet.stakeCents;
          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `journal-settle-void-${bet.id}`,
            referenceType: 'BET_VOID',
            referenceId: bet.id,
            description: `Stake refunded for voided/abandoned bet ${bet.id}`,
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
            status: ['WON', 'HALF_WON'].includes(finalStatus) ? 'COMMITTED' : 'RELEASED',
            updatedAt: new Date()
          });
        }

        // Outbox event
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

  /**
   * Result Corrections & Resettlement:
   * Reverses previous settlement journals (never mutates past ledger records),
   * applies the corrected result, and posts new settlement journals.
   */
  public async resettleEventMarkets(options: ResettleEventOptions): Promise<{ resettledBetsCount: number }> {
    TenantContextHolder.assertTenant(options.tenantId);
    const windowSeconds = options.correctionWindowSeconds ?? 7200; // 2 hours

    return await this.db.transaction(async (tx) => {
      const event = await tx.events.findById(options.tenantId, options.eventId);
      if (!event) {
        throw new KaziBetError('NOT_FOUND', `Event ${options.eventId} not found.`);
      }

      // Check correction window unless forced
      const now = Date.now();
      const lastUpdate = new Date(event.updatedAt).getTime();
      if (!options.force && now - lastUpdate > windowSeconds * 1000) {
        throw new KaziBetError(
          'VALIDATION_FAILED',
          `Correction window of ${windowSeconds}s has expired for event ${options.eventId}.`
        );
      }

      // 1. Find all bet legs for this event
      const legs = await tx.betLegs.findMany();
      const eventLegs = legs.filter((l) => l.eventId === options.eventId);
      const betIds = Array.from(new Set(eventLegs.map((l) => l.betId)));

      let resettledBetsCount = 0;

      // 2. Revert previous settlements and post reversing journals
      for (const betId of betIds) {
        const bet = await tx.bets.findById(options.tenantId, betId);
        if (!bet || bet.status === 'PLACED') continue;

        // Find existing settlement transactions for this bet
        const allTransactions = await tx.ledgerTransactions.findMany(options.tenantId);
        const betTransactions = allTransactions.filter(
          (t) => t.referenceId === bet.id && t.referenceType.startsWith('BET_') && t.referenceType !== 'BET_RESETTLEMENT_REVERSAL'
        );

        for (const transaction of betTransactions) {
          const entries = await tx.ledgerEntries.findMany(options.tenantId, { transactionId: transaction.id });

          // Reverse lines: flip DR to CR and CR to DR
          const reversingLines = entries.map((entry) => ({
            accountId: entry.accountId,
            direction: entry.direction === 'DR' ? ('CR' as const) : ('DR' as const),
            amountCents: entry.amountCents,
            currency: entry.currency
          }));

          await this.ledger.postJournal({
            tenantId: options.tenantId,
            idempotencyKey: `reversal-${transaction.id}-${generateId().slice(0, 6)}`,
            referenceType: 'BET_RESETTLEMENT_REVERSAL',
            referenceId: bet.id,
            description: `Resettlement reversal for transaction ${transaction.id} on event ${options.eventId} (${options.reason})`,
            lines: reversingLines
          });
        }

        // Revert wallet balance to pre-settlement state (restore stake hold, remove previous payout)
        const wallet = await tx.wallets.findFirst(options.tenantId, { userId: bet.userId });
        if (wallet) {
          const prevPayout = bet.payoutCents || 0n;
          const newAvail = wallet.availableCents - prevPayout;
          const newHeld = wallet.heldCents + bet.stakeCents;

          await tx.wallets.update(options.tenantId, wallet.id, {
            availableCents: newAvail,
            heldCents: newHeld,
            version: wallet.version + 1n,
            updatedAt: new Date()
          });

          // Check for negative balance (operator risk flag)
          if (newAvail < 0n) {
            await tx.riskCases.create(options.tenantId, {
              id: generateId(),
              tenantId: options.tenantId,
              userId: bet.userId,
              signalType: 'NEGATIVE_BALANCE_AFTER_RESETTLEMENT',
              severity: 'HIGH',
              score: 90,
              status: 'OPEN',
              metadata: {
                betId: bet.id,
                operatorId: options.operatorId,
                negativeBalanceCents: newAvail.toString(),
                reason: options.reason
              },
              createdAt: new Date(),
              updatedAt: new Date()
            });
          }
        }

        // Reset bet status to PLACED for re-settlement
        await tx.bets.update(options.tenantId, bet.id, {
          status: 'PLACED',
          payoutCents: 0n
        });

        resettledBetsCount++;
      }

      // 3. Reset event markets to ACTIVE for re-evaluation
      const markets = await tx.markets.findMany(options.tenantId, { eventId: options.eventId });
      for (const m of markets) {
        await tx.markets.update(options.tenantId, m.id, { status: 'ACTIVE' });
      }

      // 4. Create Audit Log entry
      await tx.auditLogs.create(options.tenantId, {
        id: generateId(),
        tenantId: options.tenantId,
        actorId: options.operatorId,
        actorType: 'ADMIN',
        action: 'EVENT_RESETTLED',
        resourceType: 'EVENT',
        resourceId: options.eventId,
        beforeState: { homeScore: event.homeScore, awayScore: event.awayScore, status: event.status },
        afterState: { correctedResult: options.correctedResult, reason: options.reason, operatorId: options.operatorId },
        createdAt: new Date()
      });

      // 5. Execute new settlement under corrected result
      await this.settleEventMarkets({
        tenantId: options.tenantId,
        eventId: options.eventId,
        result: options.correctedResult
      });

      return { resettledBetsCount };
    });
  }
}
