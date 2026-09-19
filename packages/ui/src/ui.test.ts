import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SportsbookUI } from './components.js';

describe('SportsbookUI Components', () => {
  test('renders badge with correct status and color', () => {
    const liveBadge = SportsbookUI.renderBadge('LIVE');
    assert.ok(liveBadge.includes('LIVE'));
    assert.ok(liveBadge.includes('#ef4444'));

    const schedBadge = SportsbookUI.renderBadge('SCHEDULED');
    assert.ok(schedBadge.includes('SCHEDULED'));
    assert.ok(schedBadge.includes('#3b82f6'));
  });

  test('renders odds button with price or lock when suspended', () => {
    const btn = SportsbookUI.renderOddsButton({
      selectionId: 'sel-1',
      label: 'Arsenal',
      odds: 2.10
    });
    assert.ok(btn.includes('Arsenal'));
    assert.ok(btn.includes('2.10'));
    assert.ok(!btn.includes('disabled'));

    const suspendedBtn = SportsbookUI.renderOddsButton({
      selectionId: 'sel-2',
      label: 'Draw',
      odds: 3.40,
      suspended: true
    });
    assert.ok(suspendedBtn.includes('disabled'));
    assert.ok(suspendedBtn.includes('🔒'));
  });

  test('renders header with brand name and balance', () => {
    const header = SportsbookUI.renderHeader('Kazi Sports', 'KES 1,500.00');
    assert.ok(header.includes('Kazi Sports'));
    assert.ok(header.includes('KES 1,500.00'));
    assert.ok(header.includes('SANDBOX'));
  });
});
