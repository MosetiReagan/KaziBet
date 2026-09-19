import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './money.js';

describe('Money Value Object', () => {
  test('creates money from major units correctly', () => {
    const m = Money.fromMajor(100.50, 'KES');
    assert.equal(m.amountCents, 10050n);
    assert.equal(m.toMajor(), 100.50);
    assert.equal(m.toFormattedString(), 'KES 100.50');
  });

  test('adds two Money instances with same currency', () => {
    const a = Money.fromMajor(10.25, 'KES');
    const b = Money.fromMajor(5.75, 'KES');
    const sum = a.add(b);
    assert.equal(sum.amountCents, 1600n);
    assert.equal(sum.toMajor(), 16.00);
  });

  test('prevents arithmetic on mixed currencies', () => {
    const kes = Money.fromMajor(100, 'KES');
    const usd = Money.fromMajor(10, 'USD');
    assert.throws(() => kes.add(usd), /Currency mismatch/);
  });

  test('multiplies by decimal with accurate rounding', () => {
    // 100.00 KES stake * 3.75 odds = 375.00 KES
    const stake = Money.fromMajor(100.00, 'KES');
    const payout = stake.multiplyByDecimal(3.75);
    assert.equal(payout.amountCents, 37500n);
    assert.equal(payout.toMajor(), 375.00);
  });
});
