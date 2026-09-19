import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { CashoutEngine } from '@kazibet/settlement';
import { LedgerEngine } from '@kazibet/ledger';
import { UssdSimulator, MatchCodeMapping } from './ussd-simulator.js';
import { SmsBettingParser } from './sms-parser.js';

describe('Kenya Localization: USSD Simulator & SMS Betting Suite', () => {
  const tenantId = 'tenant-ke-test';
  const phoneNumber = '+254711222333';

  async function setup() {
    const db = new InMemoryDatabase();
    const ledger = new LedgerEngine(db);
    const oddsEngine = new OddsEngine(() => db.getContext());
    const bettingService = new BetPlacementService(db, oddsEngine);
    const cashoutEngine = new CashoutEngine(db, ledger);
    const ussdSimulator = new UssdSimulator(db, bettingService);
    const smsParser = new SmsBettingParser(db, bettingService, cashoutEngine);
    const ctx = db.getContext();

    // Create tenant
    await ctx.tenants.create({
      id: tenantId,
      code: 'ke-test',
      name: 'Kenya Sportsbook',
      domain: 'ke.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Create events and markets
    const event1 = await ctx.events.create(tenantId, {
      id: 'evt-ars-che',
      tenantId,
      competitionId: 'pl',
      homeTeamId: 'ARS',
      awayTeamId: 'CHE',
      scheduledStart: new Date(),
      status: 'LIVE',
      homeScore: 0,
      awayScore: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const mkt1 = await ctx.markets.create(tenantId, {
      id: 'mkt-ars-che',
      tenantId,
      eventId: event1.id,
      marketType: '1X2',
      name: 'Match Winner',
      status: 'ACTIVE',
      parameters: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel1Home = await ctx.selections.create({
      id: 'sel-ars-win',
      marketId: mkt1.id,
      name: 'Arsenal',
      currentOdds: 2.10,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel1Draw = await ctx.selections.create({
      id: 'sel-ars-draw',
      marketId: mkt1.id,
      name: 'Draw',
      currentOdds: 3.20,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel1Away = await ctx.selections.create({
      id: 'sel-che-win',
      marketId: mkt1.id,
      name: 'Chelsea',
      currentOdds: 3.50,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const event2 = await ctx.events.create(tenantId, {
      id: 'evt-liv-mci',
      tenantId,
      competitionId: 'pl',
      homeTeamId: 'LIV',
      awayTeamId: 'MCI',
      scheduledStart: new Date(),
      status: 'LIVE',
      homeScore: 0,
      awayScore: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const mkt2 = await ctx.markets.create(tenantId, {
      id: 'mkt-liv-mci',
      tenantId,
      eventId: event2.id,
      marketType: '1X2',
      name: 'Match Winner',
      status: 'ACTIVE',
      parameters: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel2Home = await ctx.selections.create({
      id: 'sel-liv-win',
      marketId: mkt2.id,
      name: 'Liverpool',
      currentOdds: 2.40,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel2Draw = await ctx.selections.create({
      id: 'sel-liv-draw',
      marketId: mkt2.id,
      name: 'Draw',
      currentOdds: 3.30,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const sel2Away = await ctx.selections.create({
      id: 'sel-mci-win',
      marketId: mkt2.id,
      name: 'Man City',
      currentOdds: 2.80,
      version: 1,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Register match codes in USSD and SMS
    const match101: MatchCodeMapping = {
      code: '101',
      eventId: event1.id,
      marketId: mkt1.id,
      homeSelectionId: sel1Home.id,
      drawSelectionId: sel1Draw.id,
      awaySelectionId: sel1Away.id,
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      homeOdds: 2.10,
      drawOdds: 3.20,
      awayOdds: 3.50
    };

    const match102: MatchCodeMapping = {
      code: '102',
      eventId: event2.id,
      marketId: mkt2.id,
      homeSelectionId: sel2Home.id,
      drawSelectionId: sel2Draw.id,
      awaySelectionId: sel2Away.id,
      homeTeam: 'Liverpool',
      awayTeam: 'Man City',
      homeOdds: 2.40,
      drawOdds: 3.30,
      awayOdds: 2.80
    };

    ussdSimulator.registerMatchCode(match101);
    ussdSimulator.registerMatchCode(match102);

    smsParser.registerMatch(match101, ['ARS', 'ARSENAL']);
    smsParser.registerMatch(match102, ['LIV', 'LIVERPOOL', 'MCI']);

    // Pre-seed user with 1,000 KES (100,000 cents)
    const user = await ussdSimulator.getOrCreateUserByPhone(tenantId, phoneNumber);
    const wallet = await ctx.wallets.findFirst(tenantId, { userId: user.id });
    await ctx.wallets.update(tenantId, wallet!.id, {
      availableCents: 100000n
    });

    return { db, ctx, ussdSimulator, smsParser, user };
  }

  test('USSD full navigation: root menu, browse matches, place bet, check balance, withdraw', async () => {
    const { ussdSimulator } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'ke-test', domain: 'ke.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        // 1. Dial *123# -> Root Menu
        const r1 = await ussdSimulator.handleRequest({
          sessionId: 'sess-1',
          serviceCode: '*123#',
          phoneNumber,
          text: '',
          tenantId
        });
        assert.equal(r1.action, 'CON');
        assert.ok(r1.message.includes('1. Today\'s Matches'));
        assert.ok(r1.message.length <= 160);

        // 2. Browse Matches: choice '1'
        const r2 = await ussdSimulator.handleRequest({
          sessionId: 'sess-1',
          serviceCode: '*123#',
          phoneNumber,
          text: '1',
          tenantId
        });
        assert.equal(r2.action, 'CON');
        assert.ok(r2.message.includes('101'));
        assert.ok(r2.message.includes('Arsenal'));
        assert.ok(r2.message.length <= 160);

        // 3. Place Bet: multi-step navigation
        // Step 2.1: Dial '2'
        const r3 = await ussdSimulator.handleRequest({
          sessionId: 'sess-1',
          serviceCode: '*123#',
          phoneNumber,
          text: '2',
          tenantId
        });
        assert.equal(r3.action, 'CON');
        assert.ok(r3.message.includes('Enter Match & Pick'));

        // Step 2.2: Enter match 101#1
        const r4 = await ussdSimulator.handleRequest({
          sessionId: 'sess-1',
          serviceCode: '*123#',
          phoneNumber,
          text: '2*101#1',
          tenantId
        });
        assert.equal(r4.action, 'CON');
        assert.ok(r4.message.includes('Enter stake'));

        // Step 2.3: Enter stake KES 100 -> Bet placed!
        const r5 = await ussdSimulator.handleRequest({
          sessionId: 'sess-1',
          serviceCode: '*123#',
          phoneNumber,
          text: '2*101#1*100',
          tenantId
        });
        assert.equal(r5.action, 'END');
        assert.ok(r5.message.includes('Bet placed'));
        assert.ok(r5.message.includes('Arsenal Win'));
        assert.ok(r5.message.length <= 160);

        // 4. Check Balance: choice '4'
        const r6 = await ussdSimulator.handleRequest({
          sessionId: 'sess-2',
          serviceCode: '*123#',
          phoneNumber,
          text: '4',
          tenantId
        });
        assert.equal(r6.action, 'END');
        assert.ok(r6.message.includes('KaziBet Bal: KES 900.00')); // 1,000 - 100 = 900
        assert.ok(r6.message.length <= 160);

        // 5. Withdraw: choice '5*200'
        const r7 = await ussdSimulator.handleRequest({
          sessionId: 'sess-3',
          serviceCode: '*123#',
          phoneNumber,
          text: '5*200',
          tenantId
        });
        assert.equal(r7.action, 'END');
        assert.ok(r7.message.includes('Withdrawal request of KES 200 received'));
        assert.ok(r7.message.length <= 160);
      }
    );
  });

  test('SMS Betting Parser: handles team alias, multi-match acca, balance, and cashout', async () => {
    const { smsParser, ctx, user } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'ke-test', domain: 'ke.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        // 1. 'BET 100 on ARS' -> Single bet on Arsenal
        const s1 = await smsParser.handleSms({
          phoneNumber,
          message: 'BET 100 on ARS',
          tenantId
        });
        assert.equal(s1.status, 'ACCEPTED');
        assert.ok(s1.message.includes('accepted'));
        assert.ok(s1.message.includes('Arsenal Win'));
        assert.ok(s1.message.length <= 160);

        // 2. 'BET 500 101#1 102#2' -> 2-leg accumulator
        const s2 = await smsParser.handleSms({
          phoneNumber,
          message: 'BET 500 101#1 102#2',
          tenantId
        });
        assert.equal(s2.status, 'ACCEPTED');
        assert.ok(s2.message.includes('2-Leg Acca'));
        assert.ok(s2.message.length <= 160);

        // 3. 'BAL' -> Balance query
        const s3 = await smsParser.handleSms({
          phoneNumber,
          message: 'BAL',
          tenantId
        });
        assert.equal(s3.status, 'PROCESSED');
        assert.ok(s3.message.includes('KaziBet Bal: KES 400.00')); // 1,000 - 100 - 500 = 400
        assert.ok(s3.message.length <= 160);

        // 4. 'CANCEL <betId>'
        const allBets = await ctx.bets.findMany(tenantId, { userId: user.id });
        assert.ok(allBets.length >= 2);
        const betToCashout = allBets[0]!;

        const s4 = await smsParser.handleSms({
          phoneNumber,
          message: `CANCEL ${betToCashout.id}`,
          tenantId
        });
        assert.equal(s4.status, 'PROCESSED');
        assert.ok(s4.message.includes('cashed out successfully'));
        assert.ok(s4.message.length <= 160);
      }
    );
  });

  test('SMS Edge Cases: handles invalid match ID, insufficient funds, and malformed SMS', async () => {
    const { smsParser, ctx, user } = await setup();

    await TenantContextHolder.run(
      { tenantId, code: 'ke-test', domain: 'ke.local', currency: 'KES', capabilityStatus: 'SANDBOX' },
      async () => {
        // 1. Invalid match ID
        const e1 = await smsParser.handleSms({
          phoneNumber,
          message: 'BET 100 9999#1',
          tenantId
        });
        assert.equal(e1.status, 'REJECTED');
        assert.ok(e1.message.includes('Match code \'9999\' not found'));
        assert.ok(e1.message.length <= 160);

        // 2. Insufficient balance
        const e2 = await smsParser.handleSms({
          phoneNumber,
          message: 'BET 50000 101#1', // 50,000 KES bet when balance is only 1,000
          tenantId
        });
        assert.equal(e2.status, 'REJECTED');
        assert.ok(e2.message.includes('Insufficient balance'));
        assert.ok(e2.message.length <= 160);

        // 3. Malformed SMS
        const e3 = await smsParser.handleSms({
          phoneNumber,
          message: 'HELLO PLEASE BET FOR ME ARSENAL',
          tenantId
        });
        assert.equal(e3.status, 'REJECTED');
        assert.ok(e3.message.includes('Invalid SMS format'));
        assert.ok(e3.message.length <= 160);
      }
    );
  });
});
