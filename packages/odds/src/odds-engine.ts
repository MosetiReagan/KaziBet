import {
  generateId,
  TenantId,
  EventId,
  MarketId,
  SelectionId,
  KaziBetError,
  MarketSuspendedError,
  OddsChangedError
} from '@kazibet/shared';
import {
  DatabaseTransactionContext,
  MarketEntity,
  SelectionEntity
} from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { StandardMarketType, SuspensionReason, SelectionInput } from './market-types.js';

export class OddsEngine {
  constructor(private readonly getContext: () => DatabaseTransactionContext) {}

  public async createMarketWithSelections(params: {
    tenantId: TenantId;
    eventId: EventId;
    marketType: StandardMarketType | string;
    name: string;
    parameters?: Record<string, unknown>;
    selections: SelectionInput[];
  }): Promise<{ market: MarketEntity; selections: SelectionEntity[] }> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.getContext();
    const marketId = generateId();

    const market: MarketEntity = {
      id: marketId,
      tenantId: params.tenantId,
      eventId: params.eventId,
      marketType: params.marketType,
      name: params.name,
      status: 'ACTIVE',
      parameters: params.parameters || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const createdMarket = await ctx.markets.create(params.tenantId, market);
    const createdSelections: SelectionEntity[] = [];

    for (const sel of params.selections) {
      if (sel.odds < 1.01) {
        throw new KaziBetError('VALIDATION_FAILED', `Odds must be at least 1.01. Received: ${sel.odds}`);
      }
      const selection: SelectionEntity = {
        id: generateId(),
        marketId,
        name: sel.name,
        currentOdds: Number(sel.odds.toFixed(4)),
        probability: sel.probability,
        version: 1,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const created = await ctx.selections.create(selection);
      createdSelections.push(created);
    }

    return { market: createdMarket, selections: createdSelections };
  }

  public async updateSelectionOdds(
    tenantId: TenantId,
    selectionId: SelectionId,
    newOdds: number,
    reason = 'MARKET_ODDS_UPDATE'
  ): Promise<SelectionEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const selection = await ctx.selections.findById(selectionId);
    if (!selection) {
      throw new KaziBetError('NOT_FOUND', `Selection ${selectionId} not found.`);
    }

    // Verify market belongs to tenant
    const market = await ctx.markets.findById(tenantId, selection.marketId);
    if (!market) {
      throw new KaziBetError('NOT_FOUND', `Market ${selection.marketId} not found under tenant.`);
    }

    if (newOdds < 1.01) {
      throw new KaziBetError('VALIDATION_FAILED', `Odds must be at least 1.01. Received: ${newOdds}`);
    }

    const updated = await ctx.selections.update(selectionId, {
      currentOdds: Number(newOdds.toFixed(4)),
      version: selection.version + 1,
      updatedAt: new Date()
    });

    // Record audit entry
    await ctx.auditLogs.create(tenantId, {
      id: generateId(),
      tenantId,
      actorType: 'SYSTEM',
      action: 'ODDS_UPDATED',
      resourceType: 'SELECTION',
      resourceId: selectionId,
      beforeState: { odds: selection.currentOdds, version: selection.version },
      afterState: { odds: updated.currentOdds, version: updated.version, reason },
      createdAt: new Date()
    });

    return updated;
  }

  public async suspendMarket(
    tenantId: TenantId,
    marketId: MarketId,
    reason: SuspensionReason,
    actorId?: string
  ): Promise<MarketEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const market = await ctx.markets.findById(tenantId, marketId);
    if (!market) {
      throw new KaziBetError('NOT_FOUND', `Market ${marketId} not found.`);
    }

    const updated = await ctx.markets.update(tenantId, marketId, {
      status: 'SUSPENDED',
      suspensionReason: reason,
      updatedAt: new Date()
    });

    await ctx.auditLogs.create(tenantId, {
      id: generateId(),
      tenantId,
      actorId,
      actorType: actorId ? 'ADMIN' : 'SYSTEM',
      action: 'MARKET_SUSPENDED',
      resourceType: 'MARKET',
      resourceId: marketId,
      beforeState: { status: market.status },
      afterState: { status: 'SUSPENDED', reason },
      createdAt: new Date()
    });

    return updated;
  }

  public async resumeMarket(
    tenantId: TenantId,
    marketId: MarketId,
    actorId?: string
  ): Promise<MarketEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const market = await ctx.markets.findById(tenantId, marketId);
    if (!market) {
      throw new KaziBetError('NOT_FOUND', `Market ${marketId} not found.`);
    }

    const updated = await ctx.markets.update(tenantId, marketId, {
      status: 'ACTIVE',
      suspensionReason: undefined,
      updatedAt: new Date()
    });

    return updated;
  }

  /**
   * Asserts that a selection is currently active and within slippage limits.
   */
  public async verifySelectionForBetting(
    tenantId: TenantId,
    selectionId: SelectionId,
    expectedOdds: number,
    expectedVersion?: number
  ): Promise<{ selection: SelectionEntity; market: MarketEntity }> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const selection = await ctx.selections.findById(selectionId);
    if (!selection) {
      throw new KaziBetError('NOT_FOUND', `Selection ${selectionId} not found.`);
    }

    const market = await ctx.markets.findById(tenantId, selection.marketId);
    if (!market) {
      throw new KaziBetError('NOT_FOUND', `Market ${selection.marketId} not found.`);
    }

    if (market.status === 'SUSPENDED') {
      throw new MarketSuspendedError(market.id, `Market '${market.name}' is suspended: ${market.suspensionReason || 'No reason provided'}.`);
    }

    if (selection.status !== 'ACTIVE') {
      throw new KaziBetError('INVALID_SELECTION', `Selection '${selection.name}' is not currently active.`);
    }

    // Check version and odds change
    if (expectedVersion !== undefined && selection.version !== expectedVersion) {
      throw new OddsChangedError(selectionId, expectedOdds, selection.currentOdds);
    }

    if (Math.abs(selection.currentOdds - expectedOdds) > 0.001) {
      throw new OddsChangedError(selectionId, expectedOdds, selection.currentOdds);
    }

    return { selection, market };
  }
}
