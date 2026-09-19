import {
  generateId,
  TenantId,
  UserId,
  KaziBetError
} from '@kazibet/shared';
import { IDatabase, UserEntity, WalletEntity } from '@kazibet/database';
import { BetPlacementService } from '@kazibet/betting-engine';
import { TenantContextHolder } from '@kazibet/tenant';

export interface UssdRequest {
  sessionId: string;
  serviceCode: string; // e.g. "*123#"
  phoneNumber: string;
  text: string;        // input chain, e.g. "", "1", "2*101#1*100"
  tenantId: TenantId;
}

export interface UssdResponse {
  message: string;
  action: 'CON' | 'END';
}

export interface MatchCodeMapping {
  code: string; // e.g. "101"
  eventId: string;
  marketId: string;
  homeSelectionId: string;
  drawSelectionId: string;
  awaySelectionId: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
}

export class UssdSimulator {
  private matchMappings = new Map<string, MatchCodeMapping>();

  constructor(
    private readonly db: IDatabase,
    private readonly bettingService?: BetPlacementService
  ) {}

  public registerMatchCode(mapping: MatchCodeMapping): void {
    this.matchMappings.set(mapping.code, mapping);
  }

  public getMatchCode(code: string): MatchCodeMapping | undefined {
    return this.matchMappings.get(code);
  }

  /**
   * Handles multi-step USSD state machine navigation.
   * Ensures responses conform to telecom 160-character screen limitations.
   */
  public async handleRequest(req: UssdRequest): Promise<UssdResponse> {
    TenantContextHolder.assertTenant(req.tenantId);
    const text = req.text.trim();
    const parts = text.length === 0 ? [] : text.split('*');

    // Root Menu (*123#)
    if (parts.length === 0) {
      return {
        action: 'CON',
        message: this.truncateScreen(
          "CON Welcome to KaziBet\n1. Today's Matches\n2. Place Bet\n3. My Bets\n4. Balance\n5. Withdraw"
        )
      };
    }

    const rootChoice = parts[0];

    switch (rootChoice) {
      case '1': {
        // 1. Today's Matches
        return {
          action: 'CON',
          message: this.formatMatchesScreen()
        };
      }

      case '2': {
        // 2. Place Bet: 2 -> 2*<Match#Pick> -> 2*<Match#Pick>*<Stake>
        if (parts.length === 1) {
          return {
            action: 'CON',
            message: this.truncateScreen(
              "CON Enter Match & Pick (e.g. 101#1, 101#X, 101#2):\n1: Home, X: Draw, 2: Away"
            )
          };
        }

        if (parts.length === 2) {
          const pickStr = parts[1]!.trim().toUpperCase();
          if (!pickStr.includes('#')) {
            return {
              action: 'CON',
              message: this.truncateScreen("CON Invalid format. Use <Match>#<Pick> (e.g. 101#1):")
            };
          }
          return {
            action: 'CON',
            message: this.truncateScreen(`CON Match: ${pickStr}\nEnter stake (KES, min 10):`)
          };
        }

        if (parts.length >= 3) {
          return await this.executeUssdBet(req, parts[1]!, parts[2]!);
        }

        break;
      }

      case '3': {
        // 3. My Bets
        return await this.formatMyBetsScreen(req);
      }

      case '4': {
        // 4. Balance
        return await this.formatBalanceScreen(req);
      }

      case '5': {
        // 5. Withdraw
        if (parts.length === 1) {
          return {
            action: 'CON',
            message: this.truncateScreen("CON Enter withdrawal amount in KES:")
          };
        }
        const amountKes = parseInt(parts[1]!, 10);
        if (isNaN(amountKes) || amountKes <= 0) {
          return {
            action: 'END',
            message: this.truncateScreen("END Invalid withdrawal amount. Dial *123# to retry.")
          };
        }
        return {
          action: 'END',
          message: this.truncateScreen(
            `END Withdrawal request of KES ${amountKes} received for ${req.phoneNumber}. Processing via M-Pesa.`
          )
        };
      }

      default: {
        return {
          action: 'END',
          message: this.truncateScreen("END Invalid choice. Dial *123# to access KaziBet.")
        };
      }
    }

    return {
      action: 'END',
      message: this.truncateScreen("END Session terminated.")
    };
  }

  private async executeUssdBet(
    req: UssdRequest,
    pickInput: string,
    stakeInput: string
  ): Promise<UssdResponse> {
    const [matchCode, pick] = pickInput.trim().toUpperCase().split('#');
    const stakeKes = parseInt(stakeInput.trim(), 10);

    if (!matchCode || !pick || isNaN(stakeKes) || stakeKes <= 0) {
      return {
        action: 'END',
        message: this.truncateScreen("END Invalid bet details. Dial *123# to retry.")
      };
    }

    const mapping = this.matchMappings.get(matchCode);
    if (!mapping) {
      return {
        action: 'END',
        message: this.truncateScreen(`END Match code ${matchCode} not found. Dial *123# to check fixtures.`)
      };
    }

    let selectionId = mapping.homeSelectionId;
    let odds = mapping.homeOdds;
    let pickName = `${mapping.homeTeam} Win`;

    if (pick === 'X') {
      selectionId = mapping.drawSelectionId;
      odds = mapping.drawOdds;
      pickName = 'Draw';
    } else if (pick === '2') {
      selectionId = mapping.awaySelectionId;
      odds = mapping.awayOdds;
      pickName = `${mapping.awayTeam} Win`;
    }

    const user = await this.getOrCreateUserByPhone(req.tenantId, req.phoneNumber);
    const stakeCents = BigInt(stakeKes) * 100n;

    // Check balance
    const ctx = this.db.getContext();
    const wallet = await ctx.wallets.findFirst(req.tenantId, { userId: user.id });
    if (!wallet || wallet.availableCents < stakeCents) {
      const availKes = Number(wallet?.availableCents ?? 0n) / 100;
      return {
        action: 'END',
        message: this.truncateScreen(
          `END Insufficient balance: KES ${availKes.toFixed(2)}. Required: KES ${stakeKes}. Deposit via M-Pesa Paybill.`
        )
      };
    }

    if (this.bettingService) {
      try {
        const placeRes = await this.bettingService.placeBet({
          tenantId: req.tenantId,
          userId: user.id,
          type: 'SINGLE',
          stakeCents,
          legs: [
            {
              eventId: mapping.eventId,
              marketId: mapping.marketId,
              selectionId,
              odds
            }
          ],
          idempotencyKey: `ussd-${req.sessionId}-${Date.now()}`
        });

        const potWinKes = (Number(placeRes.bet.potentialPayoutCents) / 100).toFixed(2);
        const newBalKes = (Number(placeRes.remainingAvailableCents) / 100).toFixed(2);

        return {
          action: 'END',
          message: this.truncateScreen(
            `END Bet placed! ID: #${placeRes.bet.id.slice(0, 6)}.\n${pickName} @ ${odds}.\nPot. Win: KES ${potWinKes}.\nBal: KES ${newBalKes}.`
          )
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Wager placement error';
        return {
          action: 'END',
          message: this.truncateScreen(`END Bet failed: ${msg}.`)
        };
      }
    }

    return {
      action: 'END',
      message: this.truncateScreen(`END Bet placed successfully for KES ${stakeKes}.`)
    };
  }

  private async formatBalanceScreen(req: UssdRequest): Promise<UssdResponse> {
    const user = await this.getOrCreateUserByPhone(req.tenantId, req.phoneNumber);
    const ctx = this.db.getContext();
    const wallet = await ctx.wallets.findFirst(req.tenantId, { userId: user.id });

    const avail = wallet ? (Number(wallet.availableCents) / 100).toFixed(2) : '0.00';
    const bonus = wallet ? (Number(wallet.bonusCents) / 100).toFixed(2) : '0.00';

    return {
      action: 'END',
      message: this.truncateScreen(`END KaziBet Bal: KES ${avail} (Bonus: KES ${bonus}). Dial *123# to play.`)
    };
  }

  private async formatMyBetsScreen(req: UssdRequest): Promise<UssdResponse> {
    const user = await this.getOrCreateUserByPhone(req.tenantId, req.phoneNumber);
    const ctx = this.db.getContext();
    const bets = await ctx.bets.findMany(req.tenantId, { userId: user.id });

    if (bets.length === 0) {
      return {
        action: 'END',
        message: this.truncateScreen("END You have no active wagers. Dial *123# to place a bet.")
      };
    }

    const latest = bets[bets.length - 1]!;
    const stake = (Number(latest.stakeCents) / 100).toFixed(0);
    const win = (Number(latest.potentialPayoutCents) / 100).toFixed(0);

    return {
      action: 'END',
      message: this.truncateScreen(
        `END Last Bet #${latest.id.slice(0, 6)}: ${latest.status}.\nStake: KES ${stake}, Pot. Win: KES ${win}.`
      )
    };
  }

  private formatMatchesScreen(): string {
    if (this.matchMappings.size === 0) {
      return this.truncateScreen("CON No matches scheduled today.\n0. Back");
    }

    let msg = "CON Today's Matches:\n";
    for (const [code, m] of this.matchMappings.entries()) {
      msg += `${code}. ${m.homeTeam} v ${m.awayTeam} (${m.homeOdds}/${m.drawOdds}/${m.awayOdds})\n`;
      if (msg.length >= 130) break;
    }
    msg += "Reply 2 to Bet";
    return this.truncateScreen(msg);
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
        passwordHash: 'ussd_auto_provisioned',
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

  private truncateScreen(str: string): string {
    if (str.length <= 160) return str;
    return str.slice(0, 157) + '...';
  }
}
