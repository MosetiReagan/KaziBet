import {
  generateId,
  TenantId,
  UserId,
  KaziBetError
} from '@kazibet/shared';
import { IDatabase, WalletEntity } from '@kazibet/database';
import { LedgerEngine, STANDARD_ACCOUNTS } from '@kazibet/ledger';
import { TenantContextHolder } from '@kazibet/tenant';

export type BonusType = 'DEPOSIT_MATCH' | 'FREE_BET' | 'WAGERING_BONUS';
export type BonusStatus = 'ACTIVE' | 'ROLLED_OVER' | 'EXPIRED' | 'FORFEITED';

export interface BonusProgram {
  id: string;
  tenantId: TenantId;
  name: string;
  type: BonusType;
  matchPercentage?: number; // e.g. 100 for 100% match
  maxBonusCents?: bigint;
  wagerRequirementMultiplier: number; // e.g. 3 for 3x
  minOdds: number; // e.g. 1.50
  validityDays: number; // e.g. 30
  createdAt: Date;
}

export interface UserBonus {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  programId?: string;
  type: BonusType;
  initialBonusCents: bigint;
  currentBonusCents: bigint;
  wagerRequirementMultiplier: number;
  requiredWagerCents: bigint;
  wageredCents: bigint;
  minOdds: number;
  status: BonusStatus;
  expiresAt: Date;
  rolledOverAt?: Date;
  forfeitedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GrantDepositBonusParams {
  tenantId: TenantId;
  userId: UserId;
  depositCents: bigint;
  matchPercentage?: number;
  maxBonusCents?: bigint;
  wagerRequirementMultiplier?: number;
  minOdds?: number;
  validityDays?: number;
  programId?: string;
}

export interface GrantFreeBetParams {
  tenantId: TenantId;
  userId: UserId;
  amountCents: bigint;
  minOdds?: number;
  validityDays?: number;
  programId?: string;
}

export interface FreeBetSettlementResult {
  grossWinningsCents: bigint;
  taxWithheldCents: bigint;
  netUserPayoutCents: bigint;
}

export class BonusEngine {
  private programs = new Map<string, BonusProgram>();
  private userBonuses = new Map<string, UserBonus>();

  constructor(
    private readonly db: IDatabase,
    private readonly ledger: LedgerEngine
  ) {}

  public createProgram(params: Omit<BonusProgram, 'id' | 'createdAt'>): BonusProgram {
    TenantContextHolder.assertTenant(params.tenantId);
    const id = generateId();
    const program: BonusProgram = {
      ...params,
      id,
      createdAt: new Date()
    };
    this.programs.set(id, program);
    return program;
  }

  public getProgram(id: string): BonusProgram | undefined {
    return this.programs.get(id);
  }

  public getUserBonus(id: string): UserBonus | undefined {
    return this.userBonuses.get(id);
  }

  public getActiveBonusesForUser(tenantId: TenantId, userId: UserId): UserBonus[] {
    TenantContextHolder.assertTenant(tenantId);
    const res: UserBonus[] = [];
    for (const b of this.userBonuses.values()) {
      if (b.tenantId === tenantId && b.userId === userId && b.status === 'ACTIVE') {
        res.push(b);
      }
    }
    return res;
  }

  /**
   * Grants a deposit match bonus to a user.
   * Credits user's bonus balance and records balancing ledger entries:
   * DR EXPENSE:MARKETING_BONUS
   * CR LIABILITY:USER_BONUS:{userId}
   */
  public async grantDepositMatchBonus(params: GrantDepositBonusParams): Promise<UserBonus> {
    TenantContextHolder.assertTenant(params.tenantId);

    const matchPct = params.matchPercentage ?? 100;
    let bonusCents = (params.depositCents * BigInt(matchPct)) / 100n;
    if (params.maxBonusCents && bonusCents > params.maxBonusCents) {
      bonusCents = params.maxBonusCents;
    }

    if (bonusCents <= 0n) {
      throw new KaziBetError('VALIDATION_FAILED', 'Bonus amount must be strictly positive.');
    }

    const multiplier = params.wagerRequirementMultiplier ?? 3;
    const requiredWagerCents = bonusCents * BigInt(multiplier);
    const minOdds = params.minOdds ?? 1.50;
    const validityDays = params.validityDays ?? 30;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

    const bonusId = generateId();
    const userBonus: UserBonus = {
      id: bonusId,
      tenantId: params.tenantId,
      userId: params.userId,
      programId: params.programId,
      type: 'DEPOSIT_MATCH',
      initialBonusCents: bonusCents,
      currentBonusCents: bonusCents,
      wagerRequirementMultiplier: multiplier,
      requiredWagerCents,
      wageredCents: 0n,
      minOdds,
      status: 'ACTIVE',
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Update wallet bonus balance atomically
    await this.db.transaction(async (tx) => {
      let wallet = await tx.wallets.findFirst(params.tenantId, {
        userId: params.userId,
        currency: 'KES'
      });

      if (!wallet) {
        wallet = await tx.wallets.create(params.tenantId, {
          id: generateId(),
          tenantId: params.tenantId,
          userId: params.userId,
          currency: 'KES',
          availableCents: 0n,
          heldCents: 0n,
          bonusCents,
          version: 1n,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        await tx.wallets.update(params.tenantId, wallet.id, {
          bonusCents: wallet.bonusCents + bonusCents,
          version: wallet.version + 1n,
          updatedAt: new Date()
        });
      }

      // Ledger entries
      const bonusLiabilityDef = STANDARD_ACCOUNTS.USER_BONUS(params.userId);
      const bonusLiabilityAcc = await this.ledger.getOrCreateAccount({
        tenantId: params.tenantId,
        code: bonusLiabilityDef.code,
        type: bonusLiabilityDef.type,
        currency: 'KES'
      });

      const marketingExpenseAcc = await this.ledger.getOrCreateAccount({
        tenantId: params.tenantId,
        code: STANDARD_ACCOUNTS.MARKETING_BONUS.code,
        type: STANDARD_ACCOUNTS.MARKETING_BONUS.type,
        currency: 'KES'
      });

      await this.ledger.postJournal({
        tenantId: params.tenantId,
        idempotencyKey: `bonus-grant-${bonusId}`,
        referenceType: 'BONUS_GRANT',
        referenceId: bonusId,
        description: `Deposit match bonus granted to user ${params.userId}`,
        lines: [
          {
            accountId: marketingExpenseAcc.id,
            direction: 'DR',
            amountCents: bonusCents,
            currency: 'KES'
          },
          {
            accountId: bonusLiabilityAcc.id,
            direction: 'CR',
            amountCents: bonusCents,
            currency: 'KES'
          }
        ]
      });
    });

    this.userBonuses.set(bonusId, userBonus);
    return userBonus;
  }

  /**
   * Grants a Free Bet token to a user.
   */
  public async grantFreeBet(params: GrantFreeBetParams): Promise<UserBonus> {
    TenantContextHolder.assertTenant(params.tenantId);

    if (params.amountCents <= 0n) {
      throw new KaziBetError('VALIDATION_FAILED', 'Free bet amount must be strictly positive.');
    }

    const validityDays = params.validityDays ?? 7;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    const minOdds = params.minOdds ?? 1.50;

    const bonusId = generateId();
    const userBonus: UserBonus = {
      id: bonusId,
      tenantId: params.tenantId,
      userId: params.userId,
      programId: params.programId,
      type: 'FREE_BET',
      initialBonusCents: params.amountCents,
      currentBonusCents: params.amountCents,
      wagerRequirementMultiplier: 1,
      requiredWagerCents: params.amountCents,
      wageredCents: 0n,
      minOdds,
      status: 'ACTIVE',
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Update wallet bonus balance atomically
    await this.db.transaction(async (tx) => {
      let wallet = await tx.wallets.findFirst(params.tenantId, {
        userId: params.userId,
        currency: 'KES'
      });

      if (!wallet) {
        wallet = await tx.wallets.create(params.tenantId, {
          id: generateId(),
          tenantId: params.tenantId,
          userId: params.userId,
          currency: 'KES',
          availableCents: 0n,
          heldCents: 0n,
          bonusCents: params.amountCents,
          version: 1n,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        await tx.wallets.update(params.tenantId, wallet.id, {
          bonusCents: wallet.bonusCents + params.amountCents,
          version: wallet.version + 1n,
          updatedAt: new Date()
        });
      }

      // Ledger: marketing expense -> user bonus liability
      const bonusLiabilityDef = STANDARD_ACCOUNTS.USER_BONUS(params.userId);
      const bonusLiabilityAcc = await this.ledger.getOrCreateAccount({
        tenantId: params.tenantId,
        code: bonusLiabilityDef.code,
        type: bonusLiabilityDef.type,
        currency: 'KES'
      });

      const marketingExpenseAcc = await this.ledger.getOrCreateAccount({
        tenantId: params.tenantId,
        code: STANDARD_ACCOUNTS.MARKETING_BONUS.code,
        type: STANDARD_ACCOUNTS.MARKETING_BONUS.type,
        currency: 'KES'
      });

      await this.ledger.postJournal({
        tenantId: params.tenantId,
        idempotencyKey: `bonus-freebet-${bonusId}`,
        referenceType: 'FREE_BET_GRANT',
        referenceId: bonusId,
        description: `Free bet granted to user ${params.userId}`,
        lines: [
          {
            accountId: marketingExpenseAcc.id,
            direction: 'DR',
            amountCents: params.amountCents,
            currency: 'KES'
          },
          {
            accountId: bonusLiabilityAcc.id,
            direction: 'CR',
            amountCents: params.amountCents,
            currency: 'KES'
          }
        ]
      });
    });

    this.userBonuses.set(bonusId, userBonus);
    return userBonus;
  }

  /**
   * Records a placed wager against active wagering bonuses.
   * If wagering turnover requirement is met, converts bonus funds to available cash:
   * DR LIABILITY:USER_BONUS:{userId}
   * CR LIABILITY:USER_AVAILABLE:{userId}
   */
  public async recordWagerForBonus(params: {
    tenantId: TenantId;
    userId: UserId;
    stakeCents: bigint;
    odds: number;
  }): Promise<{
    eligible: boolean;
    rolledOver: boolean;
    remainingWagerCents: bigint;
  }> {
    TenantContextHolder.assertTenant(params.tenantId);

    // First, check expiration for user
    await this.checkExpiration(params.tenantId, params.userId);

    const activeBonuses = this.getActiveBonusesForUser(params.tenantId, params.userId);
    if (activeBonuses.length === 0) {
      return { eligible: false, rolledOver: false, remainingWagerCents: 0n };
    }

    const bonus = activeBonuses[0]!;

    // Check odds threshold
    if (params.odds < bonus.minOdds) {
      const remaining = bonus.requiredWagerCents > bonus.wageredCents
        ? bonus.requiredWagerCents - bonus.wageredCents
        : 0n;
      return { eligible: false, rolledOver: false, remainingWagerCents: remaining };
    }

    // Accumulate wagering
    bonus.wageredCents += params.stakeCents;
    bonus.updatedAt = new Date();

    let rolledOver = false;
    let remaining = bonus.requiredWagerCents > bonus.wageredCents
      ? bonus.requiredWagerCents - bonus.wageredCents
      : 0n;

    if (bonus.wageredCents >= bonus.requiredWagerCents) {
      rolledOver = true;
      remaining = 0n;
      bonus.status = 'ROLLED_OVER';
      bonus.rolledOverAt = new Date();

      const convertAmountCents = bonus.currentBonusCents;
      if (convertAmountCents > 0n) {
        await this.db.transaction(async (tx) => {
          const wallet = await tx.wallets.findFirst(params.tenantId, {
            userId: params.userId,
            currency: 'KES'
          });

          if (wallet) {
            const newBonus = wallet.bonusCents >= convertAmountCents ? wallet.bonusCents - convertAmountCents : 0n;
            await tx.wallets.update(params.tenantId, wallet.id, {
              bonusCents: newBonus,
              availableCents: wallet.availableCents + convertAmountCents,
              version: wallet.version + 1n,
              updatedAt: new Date()
            });
          }

          // Balance conversion journal:
          // DR LIABILITY:USER_BONUS
          // CR LIABILITY:USER_AVAILABLE
          const bonusLiabilityDef = STANDARD_ACCOUNTS.USER_BONUS(params.userId);
          const availLiabilityDef = STANDARD_ACCOUNTS.USER_AVAILABLE(params.userId);

          const bonusAcc = await this.ledger.getOrCreateAccount({
            tenantId: params.tenantId,
            code: bonusLiabilityDef.code,
            type: bonusLiabilityDef.type,
            currency: 'KES'
          });

          const availAcc = await this.ledger.getOrCreateAccount({
            tenantId: params.tenantId,
            code: availLiabilityDef.code,
            type: availLiabilityDef.type,
            currency: 'KES'
          });

          await this.ledger.postJournal({
            tenantId: params.tenantId,
            idempotencyKey: `bonus-rollover-convert-${bonus.id}`,
            referenceType: 'BONUS_ROLLOVER',
            referenceId: bonus.id,
            description: `Rollover complete: converted bonus to cash for user ${params.userId}`,
            lines: [
              {
                accountId: bonusAcc.id,
                direction: 'DR',
                amountCents: convertAmountCents,
                currency: 'KES'
              },
              {
                accountId: availAcc.id,
                direction: 'CR',
                amountCents: convertAmountCents,
                currency: 'KES'
              }
            ]
          });
        });
      }
    }

    return {
      eligible: true,
      rolledOver,
      remainingWagerCents: remaining
    };
  }

  /**
   * Evaluates bonus expiration dates.
   * If expired before rollover, deducts bonus balance and reverses liability:
   * DR LIABILITY:USER_BONUS:{userId}
   * CR EXPENSE:MARKETING_BONUS
   */
  public async checkExpiration(tenantId: TenantId, userId?: UserId): Promise<UserBonus[]> {
    TenantContextHolder.assertTenant(tenantId);
    const now = new Date();
    const expiredList: UserBonus[] = [];

    for (const bonus of this.userBonuses.values()) {
      if (bonus.tenantId !== tenantId) continue;
      if (userId && bonus.userId !== userId) continue;
      if (bonus.status !== 'ACTIVE') continue;

      if (now > bonus.expiresAt) {
        bonus.status = 'EXPIRED';
        bonus.forfeitedAt = now;
        bonus.updatedAt = now;
        expiredList.push(bonus);

        const forfeitAmountCents = bonus.currentBonusCents;
        if (forfeitAmountCents > 0n) {
          await this.db.transaction(async (tx) => {
            const wallet = await tx.wallets.findFirst(tenantId, {
              userId: bonus.userId,
              currency: 'KES'
            });

            if (wallet && wallet.bonusCents > 0n) {
              const deduction = wallet.bonusCents >= forfeitAmountCents ? forfeitAmountCents : wallet.bonusCents;
              await tx.wallets.update(tenantId, wallet.id, {
                bonusCents: wallet.bonusCents - deduction,
                version: wallet.version + 1n,
                updatedAt: new Date()
              });
            }

            // Ledger reversal: DR LIABILITY:USER_BONUS, CR EXPENSE:MARKETING_BONUS
            const bonusLiabilityDef = STANDARD_ACCOUNTS.USER_BONUS(bonus.userId);
            const bonusAcc = await this.ledger.getOrCreateAccount({
              tenantId,
              code: bonusLiabilityDef.code,
              type: bonusLiabilityDef.type,
              currency: 'KES'
            });

            const marketingExpenseAcc = await this.ledger.getOrCreateAccount({
              tenantId,
              code: STANDARD_ACCOUNTS.MARKETING_BONUS.code,
              type: STANDARD_ACCOUNTS.MARKETING_BONUS.type,
              currency: 'KES'
            });

            await this.ledger.postJournal({
              tenantId,
              idempotencyKey: `bonus-expiration-forfeit-${bonus.id}`,
              referenceType: 'BONUS_EXPIRATION',
              referenceId: bonus.id,
              description: `Expired bonus funds forfeited for user ${bonus.userId}`,
              lines: [
                {
                  accountId: bonusAcc.id,
                  direction: 'DR',
                  amountCents: forfeitAmountCents,
                  currency: 'KES'
                },
                {
                  accountId: marketingExpenseAcc.id,
                  direction: 'CR',
                  amountCents: forfeitAmountCents,
                  currency: 'KES'
                }
              ]
            });
          });
        }
      }
    }

    return expiredList;
  }

  /**
   * Settles a Free Bet wager.
   * In a free bet, the stake is NOT returned to the bettor.
   * Only the net profit is paid out: (odds - 1.0) * stake.
   * Withholding tax (e.g. 20% in Kenya) is applied on the net winnings.
   */
  public static settleFreeBet(
    stakeCents: bigint,
    odds: number,
    taxRate: number = 0.20
  ): FreeBetSettlementResult {
    if (stakeCents <= 0n || odds <= 1.0) {
      return {
        grossWinningsCents: 0n,
        taxWithheldCents: 0n,
        netUserPayoutCents: 0n
      };
    }

    // Profit multiplier: (odds - 1.0)
    const profitFactorBps = BigInt(Math.round((odds - 1.0) * 10000));
    const grossWinningsCents = (stakeCents * profitFactorBps) / 10000n;

    // Tax calculation on net profit
    const taxRateBps = BigInt(Math.round(taxRate * 10000));
    const taxWithheldCents = (grossWinningsCents * taxRateBps) / 10000n;
    const netUserPayoutCents = grossWinningsCents - taxWithheldCents;

    return {
      grossWinningsCents,
      taxWithheldCents,
      netUserPayoutCents
    };
  }
}
