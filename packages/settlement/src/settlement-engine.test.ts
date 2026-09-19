import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { LedgerEngine } from '@kazibet/ledger';
import { SettlementEngine } from './settlement-engine.js';
import { CashoutEngine } from './cashout-engine.js';

describe('SettlementEngine & Cashout Suite', () => {
  const tenantId = 'tenant-settle-test';
  const userId = 'user-settle-1';

  async function setup() {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);
    const settlement = new SettlementEngine(db, ledger);
    const cashout = new CashoutEngine(db, ledger);
    const ctx = db.getContext();

    // Seed tenant
    await ctx.tenants.create({
      id: tenantId,
      code: 'settle-test',
      name: 'Settle Test Sports',
      domain: 'settle.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Seed wallet with 0 available, 200 KES held
    await ctx.wallets.create(tenantId, {
      id: 'w-settle-1',
      tenantId,
      userId,
      currency: 'KES',
      availableCents: 0n,
      heldCents: 20000n, // 200 KES
      bonusCents: 0n,
      version: 1n,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Seed event
    await ctx.events.create(tenantId, {
      id: 'evt-settle-1',
      tenantId,
      competitionId: 'comp-1',
      homeTeamId: 'team-h',
      awayTeamId: 'team-a',
      scheduledStart: new Date(),
      status: 'LIVE',
      homeScore: 0,
      awayScore: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Seed 1X2 market
    const market = await ctx.markets.create(tenantId, {
      id: 'mkt-settle-1',
      tenantId,
      eventId: 'evt-settle-1',
      marketType: '1X2',
      name: 'Match Winner',
      status: 'ACTIVE',
      parameters: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const homeSel = await ctx.selections.create({
      id: 'sel-home-win',
      marketId: market.id,
      name: 'Home',
      currentOdds: 3.5,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { db, ledger, settlement, cashout, market, homeSel, ctx };
  }

  test('settles winning bet, deducts 20% withholding tax, and credits wallet', async () => {
    const { settlement, ctx, homeSel, market, ledger } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'settle-test',
        domain: 'settle.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        // Place bet on Home: Stake 200 KES (20,000 cents), Odds 3.50 -> Return 700 KES (70,000 cents)
        // Net winnings = 500 KES (50,000 cents). Tax 20% = 100 KES (10,000 cents).
        // Net Payout to User = 600 KES (60,000 cents).
        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-win-1',
          tenantId,
          betSlipId: 'slip-1',
          userId,
          stakeCents: 20000n,
          odds: 3.5,
          potentialPayoutCents: 70000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        await ctx.betLegs.create({
          id: 'leg-win-1',
          betId: bet.id,
          eventId: 'evt-settle-1',
          marketId: market.id,
          selectionId: homeSel.id,
          acceptedOdds: 3.5,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // Settle event with Home winning: 2 - 1
        const res = await settlement.settleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          result: { homeScore: 2, awayScore: 1, status: 'FINISHED' },
          taxPercentage: 20.0,
          taxBeneficiary: 'KRA'
        });

        assert.equal(res.settledBetsCount, 1);

        // Verify Bet state
        const settledBet = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(settledBet?.status, 'WON');
        assert.equal(settledBet?.payoutCents, 60000n); // 600 KES after 20% tax on net winnings

        // Verify Wallet state
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 60000n);
        assert.equal(wallet?.heldCents, 0n);

        // Verify system ledger balance invariant
        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
      }
    );
  });

  test('executes early cashout with balanced journal and wallet credit', async () => {
    const { cashout, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'settle-test',
        domain: 'settle.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-cashout-1',
          tenantId,
          betSlipId: 'slip-2',
          userId,
          stakeCents: 20000n, // 200 KES
          odds: 4.0,
          potentialPayoutCents: 80000n, // 800 KES
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        // Quote
        const quote = await cashout.getCashoutQuote(tenantId, bet.id);
        assert.equal(quote.eligible, true);
        assert.equal(quote.cashoutCents, 64000n); // 80% of 80,000 = 64,000

        // Execute Cashout
        const cashedOut = await cashout.executeCashout(tenantId, bet.id, quote.cashoutCents);
        assert.equal(cashedOut.status, 'CASHED_OUT');
        assert.equal(cashedOut.payoutCents, 64000n);

        // Wallet updated
        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 64000n);

        // Ledger invariant intact
        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
      }
    );
  });
});
