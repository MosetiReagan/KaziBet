import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { KaziBetCli } from './commands.js';

describe('KaziBet CLI Tools', () => {
  test('initializes and provisions new tenant via CLI', async () => {
    const db = new InMemoryDatabase();
    const cli = new KaziBetCli(db);

    const initRes = await cli.init();
    assert.equal(initRes.success, true);

    const tenantRes = await cli.tenantCreate({
      code: 'lion-bet',
      name: 'Lion Sportsbook',
      domain: 'lion.local'
    });

    assert.equal(tenantRes.success, true);
    assert.ok(tenantRes.tenantId);

    // Verify doctor check
    const docRes = await cli.doctor();
    assert.equal(docRes.checksPassed, true);
    assert.ok(docRes.diagnostics['database']);

    // Verify backup verification
    const backupRes = await cli.backup();
    assert.equal(backupRes.verified, true);
    assert.ok(backupRes.snapshotId.startsWith('bkp-'));
  });
});
