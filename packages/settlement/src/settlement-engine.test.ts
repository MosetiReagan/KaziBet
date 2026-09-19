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

  test('Asian handicap: settles HALF_WON (quarter line +0.25 on a 0-0 draw) with exact tax and balanced ledger', async () => {
    const { settlement, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'settle-test', domain: 'settle.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        const ahMarket = await ctx.markets.create(tenantId, {
          id: 'mkt-ah-halfwin',
          tenantId,
          eventId: 'evt-settle-1',
          marketType: 'ASIAN_HANDICAP',
          name: 'Asian Handicap +0.25',
          status: 'ACTIVE',
          parameters: { handicap: 0.25 },
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const sel = await ctx.selections.create({
          id: 'sel-ah-halfwin',
          marketId: ahMarket.id,
          name: 'Home (+0.25)',
          currentOdds: 2.0,
          version: 1,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-ah-halfwin',
          tenantId,
          betSlipId: 'slip-ah-1',
          userId,
          stakeCents: 20000n, // 200 KES
          odds: 2.0,
          potentialPayoutCents: 40000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        await ctx.betLegs.create({
          id: 'leg-ah-1',
          betId: bet.id,
          eventId: 'evt-settle-1',
          marketId: ahMarket.id,
          selectionId: sel.id,
          acceptedOdds: 2.0,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // 0-0 Draw -> +0.25 gives E = +0.25 -> HALF_WON
        await settlement.settleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          result: { homeScore: 0, awayScore: 0, status: 'FINISHED' }
        });

        const settledBet = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(settledBet?.status, 'HALF_WON');
        // Gross: 100 * 2.0 + 100 = 300 KES (30,000 cents)
        // Net Winnings: 10,000 cents
        // 20% WHT: 2,000 cents
        // Net Payout: 28,000 cents
        assert.equal(settledBet?.payoutCents, 28000n);

        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 28000n);

        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
      }
    );
  });

  test('Asian handicap: settles HALF_LOST (quarter line -0.25 on a 0-0 draw) with balanced ledger', async () => {
    const { settlement, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'settle-test', domain: 'settle.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        const ahMarket = await ctx.markets.create(tenantId, {
          id: 'mkt-ah-halfloss',
          tenantId,
          eventId: 'evt-settle-1',
          marketType: 'ASIAN_HANDICAP',
          name: 'Asian Handicap -0.25',
          status: 'ACTIVE',
          parameters: { handicap: -0.25 },
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const sel = await ctx.selections.create({
          id: 'sel-ah-halfloss',
          marketId: ahMarket.id,
          name: 'Home (-0.25)',
          currentOdds: 2.0,
          version: 1,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-ah-halfloss',
          tenantId,
          betSlipId: 'slip-ah-2',
          userId,
          stakeCents: 20000n, // 200 KES
          odds: 2.0,
          potentialPayoutCents: 40000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        await ctx.betLegs.create({
          id: 'leg-ah-2',
          betId: bet.id,
          eventId: 'evt-settle-1',
          marketId: ahMarket.id,
          selectionId: sel.id,
          acceptedOdds: 2.0,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // 0-0 Draw -> -0.25 gives E = -0.25 -> HALF_LOST
        await settlement.settleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          result: { homeScore: 0, awayScore: 0, status: 'FINISHED' }
        });

        const settledBet = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(settledBet?.status, 'HALF_LOST');
        // Half stake (100 KES = 10,000 cents) refunded, other half lost to GGR
        assert.equal(settledBet?.payoutCents, 10000n);

        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 10000n);

        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
      }
    );
  });

  test('Dead heat rule: settles tied selections with reduced payout and balanced ledger', async () => {
    const { settlement, ctx, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'settle-test', domain: 'settle.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        const dhMarket = await ctx.markets.create(tenantId, {
          id: 'mkt-dh-1',
          tenantId,
          eventId: 'evt-settle-1',
          marketType: 'DEAD_HEAT',
          name: 'Top Goalscorer',
          status: 'ACTIVE',
          parameters: {},
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const selSalah = await ctx.selections.create({
          id: 'sel-salah',
          marketId: dhMarket.id,
          name: 'Mohamed Salah',
          currentOdds: 3.0,
          version: 1,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-dh-salah',
          tenantId,
          betSlipId: 'slip-dh-1',
          userId,
          stakeCents: 20000n, // 200 KES
          odds: 3.0,
          potentialPayoutCents: 60000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        await ctx.betLegs.create({
          id: 'leg-dh-1',
          betId: bet.id,
          eventId: 'evt-settle-1',
          marketId: dhMarket.id,
          selectionId: selSalah.id,
          acceptedOdds: 3.0,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // Salah and Haaland tie for 1st place -> deadHeatPlaces: 1, winners: 2 -> factor: 0.5
        await settlement.settleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          result: {
            homeScore: 0,
            awayScore: 0,
            status: 'FINISHED',
            winningSelectionNames: ['Mohamed Salah', 'Erling Haaland'],
            deadHeatPlaces: 1
          }
        });

        const settledBet = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(settledBet?.status, 'WON');
        // Effective stake: 10,000 cents. Gross: 30,000 cents.
        // Net Winnings on effective stake: 20,000 cents. 20% WHT: 4,000 cents.
        // Net Payout: 26,000 cents.
        assert.equal(settledBet?.payoutCents, 26000n);

        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
      }
    );
  });

  test('Voided / Abandoned events: refunds stake cleanly via ledger reversal', async () => {
    const { settlement, ctx, homeSel, market, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'settle-test', domain: 'settle.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-abandoned-1',
          tenantId,
          betSlipId: 'slip-ab-1',
          userId,
          stakeCents: 20000n,
          odds: 3.5,
          potentialPayoutCents: 70000n,
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        await ctx.betLegs.create({
          id: 'leg-ab-1',
          betId: bet.id,
          eventId: 'evt-settle-1',
          marketId: market.id,
          selectionId: homeSel.id,
          acceptedOdds: 3.5,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // Event abandoned without completion
        await settlement.settleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          result: { homeScore: 0, awayScore: 0, status: 'ABANDONED' }
        });

        const settledBet = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(settledBet?.status, 'VOIDED');
        assert.equal(settledBet?.payoutCents, 20000n);

        const wallet = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(wallet?.availableCents, 20000n);

        const audit = await ledger.auditSystemBalance(tenantId);
        assert.equal(audit.balanced, true);
      }
    );
  });

  test('Result correction and resettlement: reverses wrongful payout without mutating history, posts correct journal, and maintains sum DR == sum CR invariant', async () => {
    const { settlement, ctx, homeSel, market, ledger } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'settle-test', domain: 'settle.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        const bet = await ctx.bets.create(tenantId, {
          id: 'bet-resettle-1',
          tenantId,
          betSlipId: 'slip-resettle-1',
          userId,
          stakeCents: 20000n, // 200 KES
          odds: 3.0,
          potentialPayoutCents: 60000n, // 600 KES
          payoutCents: 0n,
          status: 'PLACED',
          createdAt: new Date()
        });

        await ctx.betLegs.create({
          id: 'leg-resettle-1',
          betId: bet.id,
          eventId: 'evt-settle-1',
          marketId: market.id,
          selectionId: homeSel.id,
          acceptedOdds: 3.0,
          oddsVersion: 1,
          status: 'PENDING'
        });

        // 1. Initial Wrong Settlement: Home won 1-0
        await settlement.settleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          result: { homeScore: 1, awayScore: 0, status: 'FINISHED' }
        });

        const initialBet = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(initialBet?.status, 'WON');
        // Gross: 60,000, Net Winnings: 40,000, Tax: 8,000, Payout: 52,000 cents
        assert.equal(initialBet?.payoutCents, 52000n);

        const walletAfterWrongWin = await ctx.wallets.findFirst(tenantId, { userId });
        assert.equal(walletAfterWrongWin?.availableCents, 52000n);

        // User withdraws 400 KES (40,000 cents) from wrongful winnings!
        await ctx.wallets.update(tenantId, walletAfterWrongWin!.id, {
          availableCents: 12000n // 52,000 - 40,000 = 12,000 remaining
        });

        // Initial ledger audit check
        const auditInitial = await ledger.auditSystemBalance(tenantId);
        assert.equal(auditInitial.balanced, true);

        // 2. Result Correction Resettlement: Official result was actually 1-1 Draw (Home lost!)
        const resettleReport = await settlement.resettleEventMarkets({
          tenantId,
          eventId: 'evt-settle-1',
          correctedResult: { homeScore: 1, awayScore: 1, status: 'FINISHED' },
          operatorId: 'operator-compliance-01',
          reason: 'Official VAR match correction from Premier League',
          force: true
        });

        assert.equal(resettleReport.resettledBetsCount, 1);

        // 3. Assert bet status is now LOST
        const betAfterResettle = await ctx.bets.findById(tenantId, bet.id);
        assert.equal(betAfterResettle?.status, 'LOST');
        assert.equal(betAfterResettle?.payoutCents, 0n);

        // 4. Assert wallet has negative balance (-28,000 cents = 12,000 - 52,000 + 12,000)
        const walletAfterResettle = await ctx.wallets.findFirst(tenantId, { userId });
        assert.ok(walletAfterResettle!.availableCents < 0n);

        // 5. Assert operator risk case was generated for negative balance
        const riskCases = await ctx.riskCases.findMany(tenantId, {
          userId,
          signalType: 'NEGATIVE_BALANCE_AFTER_RESETTLEMENT'
        });
        assert.equal(riskCases.length, 1);
        assert.equal(riskCases[0]?.severity, 'HIGH');

        // 6. Assert audit log entry was created
        const auditLogs = await ctx.auditLogs.findMany(tenantId, { action: 'EVENT_RESETTLED' });
        assert.equal(auditLogs.length, 1);
        assert.equal(auditLogs[0]?.actorId, 'operator-compliance-01');

        // 7. Critical Invariant: Ledger balance invariant (sum DR == sum CR) across all journals
        const auditFinal = await ledger.auditSystemBalance(tenantId);
        assert.equal(auditFinal.balanced, true);
        assert.equal(auditFinal.totalDebits, auditFinal.totalCredits);
      }
    );
  });

  test('DOUBLE_CHANCE market: correctly resolves 1X, X2, 12 across match outcomes', async () => {
    const { ctx } = await setup();
    const dcMarket = await ctx.markets.create(tenantId, {
      id: 'mkt-dc-1',
      tenantId,
      eventId: 'evt-settle-1',
      marketType: 'DOUBLE_CHANCE',
      name: 'Double Chance',
      status: 'ACTIVE',
      parameters: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel1X = { id: 'sel-1x', name: '1X' };
    const selX2 = { id: 'sel-x2', name: 'X2' };
    const sel12 = { id: 'sel-12', name: '12' };
    const selections = [sel1X, selX2, sel12];

    const { SettlementRuleEvaluator } = await import('./rule-evaluator.js');

    // 1. Home Win (2 - 1) -> 1X WON, X2 LOST, 12 WON
    const homeWinOutcomes = SettlementRuleEvaluator.evaluateMarket(
      'DOUBLE_CHANCE',
      {},
      selections,
      { homeScore: 2, awayScore: 1, status: 'FINISHED' }
    );
    assert.equal(homeWinOutcomes.get('sel-1x'), 'WON');
    assert.equal(homeWinOutcomes.get('sel-x2'), 'LOST');
    assert.equal(homeWinOutcomes.get('sel-12'), 'WON');

    // 2. Draw (1 - 1) -> 1X WON, X2 WON, 12 LOST
    const drawOutcomes = SettlementRuleEvaluator.evaluateMarket(
      'DOUBLE_CHANCE',
      {},
      selections,
      { homeScore: 1, awayScore: 1, status: 'FINISHED' }
    );
    assert.equal(drawOutcomes.get('sel-1x'), 'WON');
    assert.equal(drawOutcomes.get('sel-x2'), 'WON');
    assert.equal(drawOutcomes.get('sel-12'), 'LOST');

    // 3. Away Win (0 - 3) -> 1X LOST, X2 WON, 12 WON
    const awayWinOutcomes = SettlementRuleEvaluator.evaluateMarket(
      'DOUBLE_CHANCE',
      {},
      selections,
      { homeScore: 0, awayScore: 3, status: 'FINISHED' }
    );
    assert.equal(awayWinOutcomes.get('sel-1x'), 'LOST');
    assert.equal(awayWinOutcomes.get('sel-x2'), 'WON');
    assert.equal(awayWinOutcomes.get('sel-12'), 'WON');
  });

  test('DRAW_NO_BET market: voids on draw and pays out on outright win', async () => {
    const selHome = { id: 'sel-dnb-1', name: 'Home' };
    const selAway = { id: 'sel-dnb-2', name: 'Away' };
    const selections = [selHome, selAway];

    const { SettlementRuleEvaluator } = await import('./rule-evaluator.js');

    // 1. Draw -> both VOID
    const drawOutcomes = SettlementRuleEvaluator.evaluateMarket(
      'DRAW_NO_BET',
      {},
      selections,
      { homeScore: 2, awayScore: 2, status: 'FINISHED' }
    );
    assert.equal(drawOutcomes.get('sel-dnb-1'), 'VOID');
    assert.equal(drawOutcomes.get('sel-dnb-2'), 'VOID');

    // 2. Home win -> Home WON, Away LOST
    const homeWinOutcomes = SettlementRuleEvaluator.evaluateMarket(
      'DRAW_NO_BET',
      {},
      selections,
      { homeScore: 1, awayScore: 0, status: 'FINISHED' }
    );
    assert.equal(homeWinOutcomes.get('sel-dnb-1'), 'WON');
    assert.equal(homeWinOutcomes.get('sel-dnb-2'), 'LOST');

    // 3. Away win -> Home LOST, Away WON
    const awayWinOutcomes = SettlementRuleEvaluator.evaluateMarket(
      'DRAW_NO_BET',
      {},
      selections,
      { homeScore: 0, awayScore: 2, status: 'FINISHED' }
    );
    assert.equal(awayWinOutcomes.get('sel-dnb-1'), 'LOST');
    assert.equal(awayWinOutcomes.get('sel-dnb-2'), 'WON');
  });
});

