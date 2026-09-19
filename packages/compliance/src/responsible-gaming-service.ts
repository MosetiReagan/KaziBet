import {
  generateId,
  TenantId,
  UserId,
  ResponsibleGamingViolationError,
  KaziBetError
} from '@kazibet/shared';
import { DatabaseTransactionContext, InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';

export class ResponsibleGamingService {
  constructor(private readonly db: InMemoryDatabase) {}

  public async validateDepositLimit(
    tenantId: TenantId,
    userId: UserId,
    newDepositCents: bigint,
    dailyLimitCents: bigint
  ): Promise<void> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();

    // Check user status
    const user = await ctx.users.findById(tenantId, userId);
    if (user?.status === 'SELF_EXCLUDED') {
      throw new ResponsibleGamingViolationError('Deposits rejected: User is currently self-excluded.');
    }

    // Sum deposits in past 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const payments = await ctx.payments.findMany(tenantId, { userId, type: 'DEPOSIT', status: 'SUCCESS' });
    const recentDeposits = payments.filter(p => new Date(p.createdAt) >= oneDayAgo);

    let total24h = 0n;
    for (const dep of recentDeposits) {
      total24h += dep.amountCents;
    }

    if (total24h + newDepositCents > dailyLimitCents) {
      throw new ResponsibleGamingViolationError(
        `Daily deposit limit exceeded. Limit: ${dailyLimitCents} cents, Attempted total: ${total24h + newDepositCents} cents.`
      );
    }
  }

  public async triggerCoolingOff(
    tenantId: TenantId,
    userId: UserId,
    coolingOffHours: number,
    reason = 'Cooling off period requested'
  ): Promise<void> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.db.getContext();

    const user = await ctx.users.findById(tenantId, userId);
    if (!user) {
      throw new KaziBetError('NOT_FOUND', `User ${userId} not found.`);
    }

    await ctx.users.update(tenantId, userId, {
      status: 'SUSPENDED',
      updatedAt: new Date()
    });

    await ctx.auditLogs.create(tenantId, {
      id: generateId(),
      tenantId,
      actorId: userId,
      actorType: 'USER',
      action: 'COOLING_OFF_ACTIVATED',
      resourceType: 'USER',
      resourceId: userId,
      beforeState: { status: user.status },
      afterState: { status: 'SUSPENDED', coolingOffHours, reason },
      createdAt: new Date()
    });
  }
}
