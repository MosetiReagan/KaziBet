import {
  generateId,
  TenantId,
  UserId,
  Money,
  KaziBetError,
  InsufficientFundsError,
  createDomainEvent,
  BetType
} from '@kazibet/shared';
import {
  DatabaseTransactionContext,
  InMemoryDatabase,
  BetSlipEntity,
  BetEntity,
  WalletEntity
} from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { OddsEngine } from '@kazibet/odds';
import { BetSlipCalculator, SlipLegInput } from './bet-slip-calculator.js';

export interface PlaceBetSlipRequest {
  tenantId: TenantId;
  userId: UserId;
  type: BetType;
  stakeCents: bigint;
  legs: SlipLegInput[];
  idempotencyKey: string;
}

export interface BetPlacementResult {
  betSlip: BetSlipEntity;
  bet: BetEntity;
  remainingAvailableCents: bigint;
}

export class BetPlacementService {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly oddsEngine: OddsEngine
  ) {}

  public async placeBet(request: PlaceBetSlipRequest): Promise<BetPlacementResult> {
    TenantContextHolder.assertTenant(request.tenantId);

    // 1. Validate stake
    if (request.stakeCents <= 0n) {
      throw new KaziBetError('VALIDATION_FAILED', 'Stake must be strictly positive.');
    }
    if (request.legs.length === 0) {
      throw new KaziBetError('VALIDATION_FAILED', 'Bet slip must contain at least one selection.');
    }
    if (request.type === 'ACCUMULATOR' && request.legs.length < 2) {
      throw new KaziBetError('VALIDATION_FAILED', 'Accumulator bets require at least two legs.');
    }

    // 2. Correlated selections check
    if (request.type === 'ACCUMULATOR') {
      try {
        BetSlipCalculator.validateCorrelatedSelections(request.legs);
      } catch (err) {
        throw new KaziBetError('VALIDATION_FAILED', err instanceof Error ? err.message : 'Correlated selection error');
      }
    }

    // 3. Execute in atomic transaction
    return await this.db.transaction(async (tx) => {
      // 3.1 Idempotency check
      const existingSlip = await tx.betSlips.findFirst(request.tenantId, {
        idempotencyKey: request.idempotencyKey
      });

      if (existingSlip) {
        const existingBet = (await tx.bets.findMany(request.tenantId, {
          betSlipId: existingSlip.id
        }))[0];
        const wallet = await tx.wallets.findFirst(request.tenantId, {
          userId: request.userId
        });
        return {
          betSlip: existingSlip,
          bet: existingBet!,
          remainingAvailableCents: wallet?.availableCents ?? 0n
        };
      }

      // 3.2 User check
      const user = await tx.users.findById(request.tenantId, request.userId);
      if (!user) {
        throw new KaziBetError('NOT_FOUND', `User ${request.userId} not found.`);
      }
      if (user.status === 'SELF_EXCLUDED') {
        throw new KaziBetError('SELF_EXCLUDED', 'Wager rejected: account is currently self-excluded.', 403);
      }
      if (user.status !== 'ACTIVE' && user.status !== 'KYC_VERIFIED') {
        throw new KaziBetError('ACCOUNT_SUSPENDED', `Wager rejected: account status is ${user.status}.`, 403);
      }

      // 3.3 Verify selections & odds freshness
      for (const leg of request.legs) {
        await this.oddsEngine.verifySelectionForBetting(
          request.tenantId,
          leg.selectionId,
          leg.odds
        );
      }

      // 3.4 Calculate odds and potential payout
      const totalOdds = request.type === 'SINGLE'
        ? request.legs[0]!.odds
        : BetSlipCalculator.calculateAccumulatorOdds(request.legs);

      const stakeMoney = new Money(request.stakeCents, 'KES');
      const potentialPayout = BetSlipCalculator.calculatePayout(stakeMoney, totalOdds);

      // 3.5 Check wallet balance
      let wallet = await tx.wallets.findFirst(request.tenantId, {
        userId: request.userId,
        currency: 'KES'
      });

      if (!wallet) {
        // Create initial wallet if needed
        wallet = await tx.wallets.create(request.tenantId, {
          id: generateId(),
          tenantId: request.tenantId,
          userId: request.userId,
          currency: 'KES',
          availableCents: 0n,
          heldCents: 0n,
          bonusCents: 0n,
          version: 1n,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      if (wallet.availableCents < request.stakeCents) {
        throw new InsufficientFundsError(
          `Insufficient funds: Available ${wallet.availableCents} cents, Required ${request.stakeCents} cents.`
        );
      }

      // 3.6 Reserve funds (Hold)
      const updatedWallet = await tx.wallets.update(request.tenantId, wallet.id, {
        availableCents: wallet.availableCents - request.stakeCents,
        heldCents: wallet.heldCents + request.stakeCents,
        version: wallet.version + 1n,
        updatedAt: new Date()
      });

      // 3.7 Create BetSlip, Bet, BetLegs
      const betSlipId = generateId();
      const betId = generateId();

      const betSlip: BetSlipEntity = {
        id: betSlipId,
        tenantId: request.tenantId,
        userId: request.userId,
        type: request.type,
        totalStakeCents: request.stakeCents,
        potentialPayoutCents: potentialPayout.amountCents,
        status: 'PLACED',
        idempotencyKey: request.idempotencyKey,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await tx.betSlips.create(request.tenantId, betSlip);

      const bet: BetEntity = {
        id: betId,
        tenantId: request.tenantId,
        betSlipId,
        userId: request.userId,
        stakeCents: request.stakeCents,
        odds: totalOdds,
        potentialPayoutCents: potentialPayout.amountCents,
        payoutCents: 0n,
        status: 'PLACED',
        createdAt: new Date()
      };
      await tx.bets.create(request.tenantId, bet);

      // Create legs
      for (const leg of request.legs) {
        await tx.betLegs.create({
          id: generateId(),
          betId,
          eventId: leg.eventId,
          marketId: leg.marketId,
          selectionId: leg.selectionId,
          acceptedOdds: leg.odds,
          oddsVersion: 1,
          status: 'PENDING'
        });
      }

      // Create WalletHold record
      await tx.walletHolds.create(request.tenantId, {
        id: generateId(),
        tenantId: request.tenantId,
        walletId: wallet.id,
        betId,
        amountCents: request.stakeCents,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // 3.8 Insert Outbox Event
      const event = createDomainEvent({
        tenantId: request.tenantId,
        name: 'BetPlaced',
        aggregateType: 'BetSlip',
        aggregateId: betSlipId,
        payload: {
          betSlipId,
          betId,
          userId: request.userId,
          stakeCents: request.stakeCents.toString(),
          potentialPayoutCents: potentialPayout.amountCents.toString(),
          odds: totalOdds,
          legsCount: request.legs.length
        }
      });

      await tx.outboxEvents.create(request.tenantId, {
        id: event.id,
        tenantId: request.tenantId,
        eventName: event.name,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date()
      });

      return {
        betSlip,
        bet,
        remainingAvailableCents: updatedWallet.availableCents
      };
    });
  }
}
