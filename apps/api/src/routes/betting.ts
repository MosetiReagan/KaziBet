import { Router } from '../router.js';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { KaziBetError } from '@kazibet/shared';

export function registerSportsAndBettingRoutes(
  router: Router,
  sportsService: SportsService,
  oddsEngine: OddsEngine,
  bettingService: BetPlacementService
): void {
  router.get('/api/v1/sports', async (_req, res) => {
    const sports = await sportsService.getActiveSports();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sports }));
  });

  router.get('/api/v1/events', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    const events = await sportsService.listEvents(req.tenant.tenantId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events }));
  });

  router.post('/api/v1/bets/place', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required to place wagers.', 401);
    }

    const { type, stakeCents, legs } = req.body as {
      type: 'SINGLE' | 'ACCUMULATOR' | 'SYSTEM';
      stakeCents: number | string;
      legs: { selectionId: string; marketId: string; eventId: string; odds: number }[];
    };

    const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body?.['idempotencyKey'] as string);
    if (!idempotencyKey) {
      throw new KaziBetError('VALIDATION_FAILED', 'Idempotency-Key header or property is mandatory for bet placement.');
    }

    const result = await bettingService.placeBet({
      tenantId: req.tenant.tenantId,
      userId: req.user.userId,
      type,
      stakeCents: BigInt(stakeCents),
      legs,
      idempotencyKey
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      betSlip: {
        id: result.betSlip.id,
        type: result.betSlip.type,
        totalStakeCents: result.betSlip.totalStakeCents.toString(),
        potentialPayoutCents: result.betSlip.potentialPayoutCents.toString(),
        status: result.betSlip.status
      },
      bet: {
        id: result.bet.id,
        odds: result.bet.odds,
        potentialPayoutCents: result.bet.potentialPayoutCents.toString()
      },
      remainingAvailableCents: result.remainingAvailableCents.toString()
    }));
  });
}
