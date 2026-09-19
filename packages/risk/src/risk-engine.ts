import {
  generateId,
  TenantId,
  UserId,
  RiskAction,
  KaziBetError
} from '@kazibet/shared';
import { IDatabase, RiskCaseEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import {
  DetectedSignal,
  RiskEvaluationResult,
  UserDeviceProfile
} from './signals.js';

export interface ExposureValidationResult {
  allowed: boolean;
  currentExposureCents: bigint;
  projectedExposureCents: bigint;
  marketSuspended: boolean;
  limitCents: bigint;
}

export interface SelectionExposureResult {
  totalStakeCents: bigint;
  totalPotentialPayoutCents: bigint;
  netLiabilityCents: bigint;
}

export interface MarketExposureResult {
  marketId: string;
  totalStakeCents: bigint;
  maxLiabilityCents: bigint;
  selectionExposures: Map<string, SelectionExposureResult>;
}

export class RiskEngine {
  private deviceProfiles: UserDeviceProfile[] = [];

  constructor(private readonly db: IDatabase) {}

  public async evaluateUserActivity(tenantId: TenantId, userId: UserId): Promise<RiskEvaluationResult> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();
    const signals: DetectedSignal[] = [];

    // 1. Check betting velocity in last 60 seconds
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const recentBets = await ctx.bets.findMany(tenantId, { userId });
    const veryRecentBets = recentBets.filter(b => new Date(b.createdAt) >= oneMinAgo);

    if (veryRecentBets.length >= 5) {
      signals.push({
        type: 'RAPID_BET_VELOCITY',
        severity: 'HIGH',
        score: 0.85,
        description: `Unusual betting velocity: ${veryRecentBets.length} wagers placed in under 60 seconds.`,
        metadata: { count: veryRecentBets.length }
      });
    }

    // 2. Check failed payments
    const failedPayments = await ctx.payments.findMany(tenantId, { userId, status: 'FAILED' });
    if (failedPayments.length >= 3) {
      signals.push({
        type: 'SUSPICIOUS_PAYMENT_REVERSAL',
        severity: 'MEDIUM',
        score: 0.65,
        description: `Multiple failed payment attempts: ${failedPayments.length} failures recorded.`,
        metadata: { failedCount: failedPayments.length }
      });
    }

    // Calculate composite score
    let compositeScore = 0.0;
    if (signals.length > 0) {
      const maxScore = Math.max(...signals.map(s => s.score));
      compositeScore = Number(maxScore.toFixed(2));
    }

    let recommendedAction: RiskAction = 'ALLOW';
    let requiresManualReview = false;

    if (compositeScore >= 0.8) {
      recommendedAction = 'REVIEW';
      requiresManualReview = true;
    } else if (compositeScore >= 0.5) {
      recommendedAction = 'LIMIT';
      requiresManualReview = false;
    }

    // Persist Risk Case if action is REVIEW or above
    if (signals.length > 0 && compositeScore >= 0.7) {
      const highestSignal = signals.reduce((prev, curr) => (curr.score > prev.score ? curr : prev), signals[0]!);
      const riskCase: RiskCaseEntity = {
        id: generateId(),
        tenantId,
        userId,
        signalType: highestSignal.type,
        severity: highestSignal.severity,
        score: compositeScore,
        status: 'OPEN',
        explanation: highestSignal.description,
        metadata: { signals },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await ctx.riskCases.create(tenantId, riskCase);
    }

    return {
      compositeScore,
      recommendedAction,
      signals,
      requiresManualReview
    };
  }

  /**
   * Multi-Account Detection:
   * Records user connection metadata (IP, device fingerprint, M-Pesa account name)
   * and cross-references against known tenant accounts to detect collusive or syndicate multi-accounting.
   */
  public async recordUserSession(params: {
    tenantId: TenantId;
    userId: UserId;
    ipAddress: string;
    deviceFingerprint: string;
    mpesaPhoneName?: string;
  }): Promise<RiskEvaluationResult> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.db.getContext();
    const signals: DetectedSignal[] = [];

    // Search for existing profiles under this tenant from OTHER users
    const matches = this.deviceProfiles.filter(
      p => p.tenantId === params.tenantId && p.userId !== params.userId
    );

    const linkedDeviceUsers = new Set<string>();
    const linkedIpUsers = new Set<string>();
    const linkedPaymentUsers = new Set<string>();

    for (const match of matches) {
      if (match.deviceFingerprint === params.deviceFingerprint) {
        linkedDeviceUsers.add(match.userId);
      }
      if (match.ipAddress === params.ipAddress) {
        linkedIpUsers.add(match.userId);
      }
      if (
        params.mpesaPhoneName &&
        match.mpesaPhoneName &&
        match.mpesaPhoneName.trim().toLowerCase() === params.mpesaPhoneName.trim().toLowerCase()
      ) {
        linkedPaymentUsers.add(match.userId);
      }
    }

    if (linkedDeviceUsers.size > 0) {
      signals.push({
        type: 'MULTI_ACCOUNT_DEVICE_SHARING',
        severity: 'CRITICAL',
        score: 0.95,
        description: `Multi-accounting detected: account shares device fingerprint with user(s) ${Array.from(linkedDeviceUsers).join(', ')}.`,
        metadata: { linkedUserIds: Array.from(linkedDeviceUsers), fingerprint: params.deviceFingerprint }
      });
    }

    if (linkedPaymentUsers.size > 0) {
      signals.push({
        type: 'MULTI_ACCOUNT_PAYMENT_SHARING',
        severity: 'HIGH',
        score: 0.85,
        description: `M-Pesa payment name match: account shares registered payment name '${params.mpesaPhoneName}' with user(s) ${Array.from(linkedPaymentUsers).join(', ')}.`,
        metadata: { linkedUserIds: Array.from(linkedPaymentUsers), mpesaPhoneName: params.mpesaPhoneName }
      });
    }

    if (linkedIpUsers.size > 0) {
      signals.push({
        type: 'MULTI_ACCOUNT_IP_SHARING',
        severity: 'MEDIUM',
        score: 0.60,
        description: `Shared IP address ${params.ipAddress} detected across multiple accounts.`,
        metadata: { linkedUserIds: Array.from(linkedIpUsers), ip: params.ipAddress }
      });
    }

    // Record or update this session
    const existingIdx = this.deviceProfiles.findIndex(
      p => p.tenantId === params.tenantId && p.userId === params.userId
    );
    if (existingIdx >= 0) {
      this.deviceProfiles[existingIdx] = {
        ...this.deviceProfiles[existingIdx]!,
        ipAddress: params.ipAddress,
        deviceFingerprint: params.deviceFingerprint,
        mpesaPhoneName: params.mpesaPhoneName ?? this.deviceProfiles[existingIdx]!.mpesaPhoneName,
        lastSeenAt: new Date()
      };
    } else {
      this.deviceProfiles.push({
        id: generateId(),
        tenantId: params.tenantId,
        userId: params.userId,
        ipAddress: params.ipAddress,
        deviceFingerprint: params.deviceFingerprint,
        mpesaPhoneName: params.mpesaPhoneName,
        lastSeenAt: new Date()
      });
    }

    // Composite score & risk case creation
    let compositeScore = 0.0;
    if (signals.length > 0) {
      compositeScore = Math.max(...signals.map(s => s.score));
    }

    let recommendedAction: RiskAction = 'ALLOW';
    let requiresManualReview = false;

    if (compositeScore >= 0.8) {
      recommendedAction = 'REVIEW';
      requiresManualReview = true;
    } else if (compositeScore >= 0.5) {
      recommendedAction = 'LIMIT';
      requiresManualReview = false;
    }

    if (signals.length > 0 && compositeScore >= 0.7) {
      const highestSignal = signals.reduce((prev, curr) => (curr.score > prev.score ? curr : prev), signals[0]!);
      const allLinkedUsers = Array.from(
        new Set([...linkedDeviceUsers, ...linkedPaymentUsers, ...linkedIpUsers])
      );

      const riskCase: RiskCaseEntity = {
        id: generateId(),
        tenantId: params.tenantId,
        userId: params.userId,
        signalType: highestSignal.type,
        severity: highestSignal.severity,
        score: compositeScore,
        status: 'OPEN',
        explanation: highestSignal.description,
        metadata: { signals, linkedUserIds: allLinkedUsers },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await ctx.riskCases.create(params.tenantId, riskCase);
    }

    return {
      compositeScore,
      recommendedAction,
      signals,
      requiresManualReview
    };
  }

  /**
   * Liability Tracking:
   * Computes the bookmaker's net exposure on a specific selection across all active placed bets.
   */
  public async calculateSelectionExposure(
    tenantId: TenantId,
    selectionId: string
  ): Promise<SelectionExposureResult> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();

    // Query bet legs for this selection
    const legs = await ctx.betLegs.findMany({ selectionId });
    let totalStakeCents = 0n;
    let totalPotentialPayoutCents = 0n;

    for (const leg of legs) {
      const bet = await ctx.bets.findById(tenantId, leg.betId);
      if (bet && bet.status === 'PLACED') {
        totalStakeCents += bet.stakeCents;
        totalPotentialPayoutCents += bet.potentialPayoutCents;
      }
    }

    const netLiabilityCents = totalPotentialPayoutCents > totalStakeCents
      ? totalPotentialPayoutCents - totalStakeCents
      : 0n;

    return {
      totalStakeCents,
      totalPotentialPayoutCents,
      netLiabilityCents
    };
  }

  /**
   * Calculates overall market exposure and maximum liability across all selections.
   */
  public async calculateMarketExposure(
    tenantId: TenantId,
    marketId: string
  ): Promise<MarketExposureResult> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();
    const selections = await ctx.selections.findMany({ marketId });

    let totalStakeCents = 0n;
    let maxLiabilityCents = 0n;
    const selectionExposures = new Map<string, SelectionExposureResult>();

    for (const sel of selections) {
      const exp = await this.calculateSelectionExposure(tenantId, sel.id);
      selectionExposures.set(sel.id, exp);
      totalStakeCents += exp.totalStakeCents;
      if (exp.netLiabilityCents > maxLiabilityCents) {
        maxLiabilityCents = exp.netLiabilityCents;
      }
    }

    return {
      marketId,
      totalStakeCents,
      maxLiabilityCents,
      selectionExposures
    };
  }

  /**
   * Exposure Limits & Market Auto-Suspension:
   * Validates whether a projected wager on a selection breaches the market exposure ceiling.
   * If breached, automatically suspends the market and generates an urgent risk case.
   */
  public async validateAndTrackExposure(params: {
    tenantId: TenantId;
    selectionId: string;
    stakeCents: bigint;
    potentialPayoutCents: bigint;
    maxExposureLimitCents?: bigint;
  }): Promise<ExposureValidationResult> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.db.getContext();

    const selection = await ctx.selections.findById(params.selectionId);
    if (!selection) {
      throw new KaziBetError('NOT_FOUND', `Selection ${params.selectionId} not found.`);
    }

    const market = await ctx.markets.findById(params.tenantId, selection.marketId);
    if (!market) {
      throw new KaziBetError('NOT_FOUND', `Market ${selection.marketId} not found.`);
    }

    // Exposure limit resolution: explicit param > market parameter > default 5,000,000 cents (KES 50,000)
    let limitCents = params.maxExposureLimitCents;
    if (!limitCents && market.parameters && typeof market.parameters['maxExposureCents'] === 'bigint') {
      limitCents = market.parameters['maxExposureCents'] as bigint;
    } else if (!limitCents && market.parameters && typeof market.parameters['maxExposureCents'] === 'number') {
      limitCents = BigInt(market.parameters['maxExposureCents'] as number);
    } else if (!limitCents) {
      limitCents = 5_000_000n; // Default KES 50,000
    }

    const currentExp = await this.calculateSelectionExposure(params.tenantId, params.selectionId);
    const betNetLiability = params.potentialPayoutCents > params.stakeCents
      ? params.potentialPayoutCents - params.stakeCents
      : 0n;

    const projectedExposureCents = currentExp.netLiabilityCents + betNetLiability;

    if (projectedExposureCents > limitCents) {
      // Auto-suspend market
      await ctx.markets.update(params.tenantId, market.id, {
        status: 'SUSPENDED',
        suspensionReason: 'EXPOSURE_LIMIT_EXCEEDED',
        updatedAt: new Date()
      });

      // Create risk case for trading desk
      await ctx.riskCases.create(params.tenantId, {
        id: generateId(),
        tenantId: params.tenantId,
        userId: 'SYSTEM',
        signalType: 'MARKET_EXPOSURE_LIMIT_EXCEEDED',
        severity: 'HIGH',
        score: 0.90,
        status: 'OPEN',
        explanation: `Market '${market.name}' automatically suspended: projected net liability (${projectedExposureCents} cents) exceeds exposure limit (${limitCents} cents) on selection '${selection.name}'.`,
        metadata: {
          marketId: market.id,
          selectionId: selection.id,
          currentExposureCents: currentExp.netLiabilityCents.toString(),
          projectedExposureCents: projectedExposureCents.toString(),
          limitCents: limitCents.toString()
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return {
        allowed: false,
        currentExposureCents: currentExp.netLiabilityCents,
        projectedExposureCents,
        marketSuspended: true,
        limitCents
      };
    }

    return {
      allowed: true,
      currentExposureCents: currentExp.netLiabilityCents,
      projectedExposureCents,
      marketSuspended: false,
      limitCents
    };
  }
}
