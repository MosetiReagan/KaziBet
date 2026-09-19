import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BetCalculator, BetSlipLeg } from './bet-calculator.js';
import { CashierManager } from './cashier-manager.js';
import { createWebServer } from './server.js';

describe('Phase 4: Web Bettor UI, Bet Slip Math & Cashier Suite', () => {
  describe('Bet Slip Math & Kenya 20% WHT Calculations', () => {
    test('computes single bet payout with 20% WHT on net winnings accurately', () => {
      // Stake: 1,000 KES (100,000 cents), Odds: 2.50
      // Gross: 2,500 KES (250,000 cents)
      // Net Winnings: 1,500 KES (150,000 cents)
      // WHT (20%): 300 KES (30,000 cents)
      // Net Payout: 2,200 KES (220,000 cents)
      const leg: BetSlipLeg = {
        eventId: 'ev-1',
        marketId: 'm-1',
        selectionId: 's-1',
        name: 'Arsenal',
        odds: 2.50
      };

      const stakeCents = 100000n; // 1,000 KES
      const calc = BetCalculator.calculate([leg], stakeCents);

      assert.equal(calc.isPlaceable, true);
      assert.equal(calc.totalOdds, 2.50);
      assert.equal(calc.grossPayoutCents, 250000n);
      assert.equal(calc.netWinningsCents, 150000n);
      assert.equal(calc.whtCents, 30000n); // 20% of 150,000
      assert.equal(calc.netPayoutCents, 220000n);

      // Verify display formatting
      assert.equal(BetCalculator.formatCentsToKes(calc.grossPayoutCents), 'KES 2,500.00');
      assert.equal(BetCalculator.formatCentsToKes(calc.whtCents), 'KES 300.00');
      assert.equal(BetCalculator.formatCentsToKes(calc.netPayoutCents), 'KES 2,200.00');
    });

    test('computes multi-leg accumulator with compounded odds and tax rounding', () => {
      // 3 legs: 1.85, 2.10, 1.50 -> Total Odds = 5.8275
      // Stake: 500 KES (50,000 cents)
      const legs: BetSlipLeg[] = [
        { eventId: 'ev-1', marketId: 'm-1', selectionId: 's-1', name: 'Gor Mahia', odds: 1.85 },
        { eventId: 'ev-2', marketId: 'm-2', selectionId: 's-2', name: 'Arsenal', odds: 2.10 },
        { eventId: 'ev-3', marketId: 'm-3', selectionId: 's-3', name: 'Real Madrid', odds: 1.50 }
      ];

      const expectedOdds = 1.85 * 2.10 * 1.50; // 5.8275
      const stakeCents = 50000n;
      const calc = BetCalculator.calculate(legs, stakeCents);

      assert.equal(calc.isPlaceable, true);
      assert.equal(calc.totalOdds, Number(expectedOdds.toFixed(4)));

      const expectedGross = (stakeCents * BigInt(Math.round(expectedOdds * 10000))) / 10000n;
      assert.equal(calc.grossPayoutCents, expectedGross);

      const netWinnings = expectedGross - stakeCents;
      const expectedWht = (netWinnings * 2000n + 5000n) / 10000n;
      assert.equal(calc.whtCents, expectedWht);
      assert.equal(calc.netPayoutCents, expectedGross - expectedWht);
    });

    test('withholding tax is 0 when gross payout does not exceed stake', () => {
      const leg: BetSlipLeg = {
        eventId: 'ev-1',
        marketId: 'm-1',
        selectionId: 's-1',
        name: 'Refund/Draw No Bet',
        odds: 1.00
      };

      const stakeCents = 5000n; // 50 KES
      const calc = BetCalculator.calculate([leg], stakeCents);

      assert.equal(calc.grossPayoutCents, 5000n);
      assert.equal(calc.netWinningsCents, 0n);
      assert.equal(calc.whtCents, 0n);
      assert.equal(calc.netPayoutCents, 5000n);
    });

    test('auto-suspends bet slip when any leg market is marked suspended', () => {
      const legs: BetSlipLeg[] = [
        { eventId: 'ev-1', marketId: 'm-1', selectionId: 's-1', name: 'Gor Mahia', odds: 1.85 },
        { eventId: 'ev-2', marketId: 'm-2', selectionId: 's-2', name: 'Arsenal', odds: 2.10, isSuspended: true }
      ];

      const calc = BetCalculator.calculate(legs, 10000n);
      assert.equal(calc.isPlaceable, false);
      assert.match(calc.validationError || '', /suspended/);
    });

    test('rejects bet placement when wallet available funds are insufficient', () => {
      const leg: BetSlipLeg = {
        eventId: 'ev-1',
        marketId: 'm-1',
        selectionId: 's-1',
        name: 'Chelsea',
        odds: 3.50
      };

      const stakeCents = 50000n; // 500 KES
      const userAvailableCents = 20000n; // 200 KES available

      const calc = BetCalculator.calculate([leg], stakeCents, userAvailableCents);
      assert.equal(calc.isPlaceable, false);
      assert.match(calc.validationError || '', /Insufficient available/);
    });
  });

  describe('Cashier Manager & Phone Validation', () => {
    test('parses wallet balance into bigint cents and human-readable KES format', () => {
      const balance = CashierManager.parseBalance({
        currency: 'KES',
        availableCents: 154250n,
        heldCents: 20000n,
        bonusCents: 0n
      });

      assert.equal(balance.availableCents, 154250n);
      assert.equal(balance.availableDisplay, 'KES 1,542.50');
      assert.equal(balance.heldCents, 20000n);
      assert.equal(balance.heldDisplay, 'KES 200.00');
    });

    test('validates and normalizes Safaricom Kenyan mobile numbers', () => {
      const p1 = CashierManager.validateKenyanPhone('0712345678');
      assert.equal(p1.valid, true);
      assert.equal(p1.normalized, '254712345678');

      const p2 = CashierManager.validateKenyanPhone('+254722000111');
      assert.equal(p2.valid, true);
      assert.equal(p2.normalized, '254722000111');

      const p3 = CashierManager.validateKenyanPhone('0110123456');
      assert.equal(p3.valid, true);
      assert.equal(p3.normalized, '254110123456');

      const pBad = CashierManager.validateKenyanPhone('12345');
      assert.equal(pBad.valid, false);
      assert.match(pBad.error || '', /valid Kenyan mobile/);
    });
  });

  describe('Web Server Integration', () => {
    test('responds with 200 OK and sportsbook HTML application', async () => {
      const server = createWebServer('Test KaziBet');
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');

        const html = await res.text();
        assert.ok(html.includes('Test KaziBet'));
        assert.ok(html.includes('Bet Slip'));
        assert.ok(html.includes('Withholding Tax (20%)'));
        assert.ok(html.includes('Cashier'));
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('responds with 200 OK on health check', async () => {
      const server = createWebServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(res.status, 200);
        const json = await res.json() as any;
        assert.equal(json.status, 'ok');
        assert.equal(json.service, 'web');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
