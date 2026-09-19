import {
  generateId,
  TenantId,
  UserId,
  KaziBetError
} from '@kazibet/shared';
import { IDatabase, UserEntity } from '@kazibet/database';
import { BetPlacementService, SlipLegInput } from '@kazibet/betting-engine';
import { CashoutEngine } from '@kazibet/settlement';
import { TenantContextHolder } from '@kazibet/tenant';
import { MatchCodeMapping } from './ussd-simulator.js';

export interface InboundSms {
  phoneNumber: string;
  message: string;
  tenantId: TenantId;
}

export interface OutboundSmsReply {
  phoneNumber: string;
  message: string;
  status: 'ACCEPTED' | 'REJECTED' | 'PROCESSED';
}

export class SmsBettingParser {
  private matchMappings = new Map<string, MatchCodeMapping>();
  private teamAliases = new Map<string, string>(); // Alias uppercase -> matchCode, e.g. "ARS" -> "101"

  constructor(
    private readonly db: IDatabase,
    private readonly bettingService?: BetPlacementService,
    private readonly cashoutEngine?: CashoutEngine
  ) {}

  public registerMatch(mapping: MatchCodeMapping, aliases: string[] = []): void {
    this.matchMappings.set(mapping.code, mapping);
    for (const a of aliases) {
      this.teamAliases.set(a.trim().toUpperCase(), mapping.code);
    }
    // Also add home/away team names as aliases
    this.teamAliases.set(mapping.homeTeam.trim().toUpperCase(), mapping.code);
  }

  /**
   * Parses inbound SMS commands and executes betting / balance actions.
   * Ensures response is formatted within telecom 160-character limits.
   */
  public async handleSms(sms: InboundSms): Promise<OutboundSmsReply> {
    TenantContextHolder.assertTenant(sms.tenantId);
    const raw = sms.message.trim();
    const clean = raw.replace(/\s+/g, ' ');

    // 1. Balance Command: 'BAL' or 'BALANCE'
    if (/^(?:BAL|BALANCE)$/i.test(clean)) {
      return await this.handleBalanceQuery(sms);
    }

    // 2. Cancel / Cashout Command: 'CANCEL <betId>' or 'CASHOUT <betId>'
    const cancelMatch = clean.match(/^(?:CANCEL|CASHOUT)\s+([A-Za-z0-9-_]+)$/i);
    if (cancelMatch) {
      return await this.handleCancelBet(sms, cancelMatch[1]!);
    }

    // 3. Team Alias Bet: 'BET 100 on ARS'
    const teamBetMatch = clean.match(/^BET\s+(\d+)\s+ON\s+([A-Za-z0-9]+)$/i);
    if (teamBetMatch) {
      return await this.handleTeamBet(sms, parseInt(teamBetMatch[1]!, 10), teamBetMatch[2]!);
    }

    // 4. Code & Pick Bet (Single or Multi-Leg Acca): 'BET 500 1234#1 5678#2'
    const codeBetMatch = clean.match(/^BET\s+(\d+)\s+(.+)$/i);
    if (codeBetMatch) {
      return await this.handleCodeBet(sms, parseInt(codeBetMatch[1]!, 10), codeBetMatch[2]!);
    }

    // Malformed SMS fallback
    return {
      phoneNumber: sms.phoneNumber,
      status: 'REJECTED',
      message: this.truncateSms(
        'Invalid SMS format! Examples: "BET 100 on ARS", "BET 500 101#1 102#X", "BAL", "CANCEL <betId>".'
      )
    };
  }

  private async handleBalanceQuery(sms: InboundSms): Promise<OutboundSmsReply> {
    const user = await this.getOrCreateUserByPhone(sms.tenantId, sms.phoneNumber);
    const ctx = this.db.getContext();
    const wallet = await ctx.wallets.findFirst(sms.tenantId, { userId: user.id });

    const avail = wallet ? (Number(wallet.availableCents) / 100).toFixed(2) : '0.00';
    const bonus = wallet ? (Number(wallet.bonusCents) / 100).toFixed(2) : '0.00';

    return {
      phoneNumber: sms.phoneNumber,
      status: 'PROCESSED',
      message: this.truncateSms(
        `KaziBet Bal: KES ${avail} (Bonus: KES ${bonus}). Dial *123# to bet or visit kazibet.ke`
      )
    };
  }

  private async handleCancelBet(sms: InboundSms, betId: string): Promise<OutboundSmsReply> {
    const user = await this.getOrCreateUserByPhone(sms.tenantId, sms.phoneNumber);
    const ctx = this.db.getContext();

    const bet = await ctx.bets.findById(sms.tenantId, betId);
    if (!bet || bet.userId !== user.id) {
      return {
        phoneNumber: sms.phoneNumber,
        status: 'REJECTED',
        message: this.truncateSms(`Bet #${betId} not found or does not belong to this account.`)
      };
    }

    if (bet.status !== 'PLACED') {
      return {
        phoneNumber: sms.phoneNumber,
        status: 'REJECTED',
        message: this.truncateSms(`Bet #${betId} cannot be cancelled (status: ${bet.status}).`)
      };
    }

    if (this.cashoutEngine) {
      try {
        const quote = await this.cashoutEngine.getCashoutQuote(sms.tenantId, betId);
        if (!quote.eligible) {
          return {
            phoneNumber: sms.phoneNumber,
            status: 'REJECTED',
            message: this.truncateSms(`Cashout unavailable: ${quote.reason || 'Not eligible'}.`)
          };
        }

        await this.cashoutEngine.executeCashout(sms.tenantId, betId, quote.cashoutCents);

        const wallet = await ctx.wallets.findFirst(sms.tenantId, { userId: user.id });
        const creditedKes = (Number(quote.cashoutCents) / 100).toFixed(2);
        const balKes = wallet ? (Number(wallet.availableCents) / 100).toFixed(2) : '0.00';

        return {
          phoneNumber: sms.phoneNumber,
          status: 'PROCESSED',
          message: this.truncateSms(
            `Bet #${betId.slice(0, 6)} cashed out successfully! KES ${creditedKes} credited to wallet. Bal: KES ${balKes}.`
          )
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Cashout failed';
        return {
          phoneNumber: sms.phoneNumber,
          status: 'REJECTED',
          message: this.truncateSms(`Cancel/Cashout failed: ${msg}.`)
        };
      }
    }

    return {
      phoneNumber: sms.phoneNumber,
      status: 'PROCESSED',
      message: this.truncateSms(`Cancel request for Bet #${betId} processed.`)
    };
  }

  private async handleTeamBet(sms: InboundSms, stakeKes: number, alias: string): Promise<OutboundSmsReply> {
    const matchCode = this.teamAliases.get(alias.trim().toUpperCase());
    if (!matchCode) {
      return {
        phoneNumber: sms.phoneNumber,
        status: 'REJECTED',
        message: this.truncateSms(
          `Team '${alias}' not found in active matches. SMS MATCHES to 29090 for fixtures.`
        )
      };
    }

    const mapping = this.matchMappings.get(matchCode)!;
    return await this.placeSmsBet(sms, stakeKes, [
      {
        eventId: mapping.eventId,
        marketId: mapping.marketId,
        selectionId: mapping.homeSelectionId,
        odds: mapping.homeOdds
      }
    ], `${mapping.homeTeam} Win`);
  }

  private async handleCodeBet(sms: InboundSms, stakeKes: number, picksString: string): Promise<OutboundSmsReply> {
    const rawTokens = picksString.trim().split(/\s+/);
    const legs: SlipLegInput[] = [];

    for (const token of rawTokens) {
      if (!token.includes('#')) {
        return {
          phoneNumber: sms.phoneNumber,
          status: 'REJECTED',
          message: this.truncateSms(`Invalid pick token '${token}'. Format must be <MatchId>#<Pick> (e.g. 101#1).`)
        };
      }

      const [mCode, pick] = token.toUpperCase().split('#');
      const mapping = this.matchMappings.get(mCode!);

      if (!mapping) {
        return {
          phoneNumber: sms.phoneNumber,
          status: 'REJECTED',
          message: this.truncateSms(`Match code '${mCode}' not found. SMS MATCHES to 29090 for active games.`)
        };
      }

      let selectionId = mapping.homeSelectionId;
      let odds = mapping.homeOdds;

      if (pick === 'X') {
        selectionId = mapping.drawSelectionId;
        odds = mapping.drawOdds;
      } else if (pick === '2') {
        selectionId = mapping.awaySelectionId;
        odds = mapping.awayOdds;
      } else if (pick !== '1') {
        return {
          phoneNumber: sms.phoneNumber,
          status: 'REJECTED',
          message: this.truncateSms(`Invalid pick '${pick}' for match ${mCode}. Allowed: 1, X, 2.`)
        };
      }

      legs.push({
        eventId: mapping.eventId,
        marketId: mapping.marketId,
        selectionId,
        odds
      });
    }

    const desc = legs.length === 1 ? 'Single Bet' : `${legs.length}-Leg Acca`;
    return await this.placeSmsBet(sms, stakeKes, legs, desc);
  }

  private async placeSmsBet(
    sms: InboundSms,
    stakeKes: number,
    legs: SlipLegInput[],
    desc: string
  ): Promise<OutboundSmsReply> {
    if (stakeKes <= 0) {
      return {
        phoneNumber: sms.phoneNumber,
        status: 'REJECTED',
        message: this.truncateSms('Stake must be at least KES 10.')
      };
    }

    const user = await this.getOrCreateUserByPhone(sms.tenantId, sms.phoneNumber);
    const stakeCents = BigInt(stakeKes) * 100n;

    // Check balance
    const ctx = this.db.getContext();
    const wallet = await ctx.wallets.findFirst(sms.tenantId, { userId: user.id });
    if (!wallet || wallet.availableCents < stakeCents) {
      const availKes = wallet ? (Number(wallet.availableCents) / 100).toFixed(0) : '0';
      return {
        phoneNumber: sms.phoneNumber,
        status: 'REJECTED',
        message: this.truncateSms(
          `Insufficient balance! Req: KES ${stakeKes}, Bal: KES ${availKes}. Deposit via M-Pesa Paybill 123456.`
        )
      };
    }

    if (this.bettingService) {
      try {
        const placeRes = await this.bettingService.placeBet({
          tenantId: sms.tenantId,
          userId: user.id,
          type: legs.length === 1 ? 'SINGLE' : 'ACCUMULATOR',
          stakeCents,
          legs,
          idempotencyKey: `sms-${sms.phoneNumber}-${Date.now()}`
        });

        const potWin = (Number(placeRes.bet.potentialPayoutCents) / 100).toFixed(2);
        const remBal = (Number(placeRes.remainingAvailableCents) / 100).toFixed(2);

        return {
          phoneNumber: sms.phoneNumber,
          status: 'ACCEPTED',
          message: this.truncateSms(
            `Bet #${placeRes.bet.id.slice(0, 6)} accepted! ${desc}, Staked KES ${stakeKes} @ ${placeRes.bet.odds.toFixed(2)}. Pot. Win: KES ${potWin}. Bal: KES ${remBal}.`
          )
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Bet placement failed';
        return {
          phoneNumber: sms.phoneNumber,
          status: 'REJECTED',
          message: this.truncateSms(`Bet failed: ${msg}.`)
        };
      }
    }

    return {
      phoneNumber: sms.phoneNumber,
      status: 'ACCEPTED',
      message: this.truncateSms(`Bet accepted for KES ${stakeKes}.`)
    };
  }

  public async getOrCreateUserByPhone(tenantId: TenantId, phoneNumber: string): Promise<UserEntity> {
    const ctx = this.db.getContext();
    let user = await ctx.users.findFirst(tenantId, { phoneNumber });

    if (!user) {
      const userId = generateId();
      user = await ctx.users.create(tenantId, {
        id: userId,
        tenantId,
        phoneNumber,
        passwordHash: 'sms_auto_provisioned',
        status: 'ACTIVE',
        kycTier: 1,
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await ctx.wallets.create(tenantId, {
        id: generateId(),
        tenantId,
        userId,
        currency: 'KES',
        availableCents: 0n,
        heldCents: 0n,
        bonusCents: 0n,
        version: 1n,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    return user;
  }

  private truncateSms(str: string): string {
    if (str.length <= 160) return str;
    return str.slice(0, 157) + '...';
  }
}
