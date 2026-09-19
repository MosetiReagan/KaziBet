import {
  generateId,
  TenantId,
  UserId,
  RiskAction
} from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase, RiskCaseEntity } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { DetectedSignal, RiskEvaluationResult } from './signals.js';

export class RiskEngine {
  constructor(private readonly db: InMemoryDatabase) {}

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
}
