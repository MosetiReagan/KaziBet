import { Router } from '../router.js';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { CashoutEngine } from '@kazibet/settlement';
import { IDatabase } from '@kazibet/database';
import { KaziBetError } from '@kazibet/shared';

export function registerSportsAndBettingRoutes(
  router: Router,
  sportsService: SportsService,
  oddsEngine: OddsEngine,
  bettingService: BetPlacementService,
  db?: IDatabase,
  cashoutEngine?: CashoutEngine
): void {
  // GET /api/v1/sports
  router.get('/api/v1/sports', async (_req, res) => {
    const sports = await sportsService.getActiveSports();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sports }));
  });

  // GET /api/v1/events
  router.get('/api/v1/events', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    const filterStatus = req.query?.status; // 'LIVE', 'SCHEDULED', or undefined
    const allEvents = await sportsService.listEvents(req.tenant.tenantId);

    const filtered = filterStatus && filterStatus !== 'ALL'
      ? allEvents.filter((e) => e.status === filterStatus)
      : allEvents;

    const ctx = db ? db.getContext() : null;

    // Attach markets and selections if DB context is available
    const enrichedEvents = await Promise.all(
      filtered.map(async (event) => {
        if (!ctx) return { ...event, markets: [] };
        const markets = await ctx.markets.findMany(req.tenant!.tenantId, { eventId: event.id });
        const enrichedMarkets = await Promise.all(
          markets.map(async (m) => {
            const selections = await ctx.selections.findMany({ marketId: m.id });
            return {
              ...m,
              selections
            };
          })
        );
        return {
          ...event,
          markets: enrichedMarkets
        };
      })
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: enrichedEvents }));
  });

  // POST /api/v1/bets/place
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

    const idempotencyKey =
      (req.headers['idempotency-key'] as string) || (req.body?.['idempotencyKey'] as string);
    if (!idempotencyKey) {
      throw new KaziBetError(
        'VALIDATION_FAILED',
        'Idempotency-Key header or property is mandatory for bet placement.'
      );
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
    res.end(
      JSON.stringify({
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
      })
    );
  });

  // GET /api/v1/bets (List user bets)
  router.get('/api/v1/bets', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }
    if (!db) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bets: [] }));
      return;
    }

    const ctx = db.getContext();
    const userBets = await ctx.bets.findMany(req.tenant.tenantId, { userId: req.user.userId });
    const enrichedBets = await Promise.all(
      userBets.map(async (bet) => {
        const legs = await ctx.betLegs.findMany({ betId: bet.id });
        return {
          id: bet.id,
          betSlipId: bet.betSlipId,
          stakeCents: bet.stakeCents.toString(),
          odds: bet.odds,
          potentialPayoutCents: bet.potentialPayoutCents.toString(),
          payoutCents: bet.payoutCents ? bet.payoutCents.toString() : '0',
          status: bet.status,
          createdAt: bet.createdAt,
          legs
        };
      })
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bets: enrichedBets }));
  });

  // POST /api/v1/bets/:betId/cashout
  router.post('/api/v1/bets/:betId/cashout', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context required.');
    }
    if (!req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }
    if (!cashoutEngine) {
      throw new KaziBetError('VALIDATION_FAILED', 'Cashout engine is not configured.');
    }

    const betId = req.params?.['betId'];
    if (!betId) {
      throw new KaziBetError('VALIDATION_FAILED', 'betId is required.');
    }

    const quote = await cashoutEngine.getCashoutQuote(req.tenant.tenantId, betId);
    if (!quote.eligible) {
      throw new KaziBetError('VALIDATION_FAILED', quote.reason || 'Bet not eligible for cashout.');
    }

    const result = await cashoutEngine.executeCashout(req.tenant.tenantId, betId, quote.cashoutCents);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        betId,
        payoutCents: result.payoutCents.toString(),
        status: result.status
      })
    );
  });
}
