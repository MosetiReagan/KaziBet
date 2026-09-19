import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { AuthService } from './auth-service.js';
import { RbacEvaluator, PERMISSIONS } from './rbac.js';

describe('AuthService & Identity Security', () => {
  const JWT_SECRET = 'test-secret-at-least-32-characters-long!';
  const tenantId = 'tenant-test-111';

  test('registers and logs in user successfully', async () => {
    const db = new InMemoryDatabase();
    const authService = new AuthService(() => db.getContext(), JWT_SECRET);

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'test-sports',
        domain: 'test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const user = await authService.register({
          tenantId,
          email: 'player1@test.com',
          password: 'SuperSecurePassword123!',
          roles: ['PLAYER']
        });

        assert.equal(user.email, 'player1@test.com');
        assert.notEqual(user.passwordHash, 'SuperSecurePassword123!');

        const loginRes = await authService.login({
          tenantId,
          identifier: 'player1@test.com',
          password: 'SuperSecurePassword123!'
        });

        assert.ok(loginRes.token);
        assert.equal(loginRes.user.email, 'player1@test.com');
        assert.ok(loginRes.user.permissions.includes(PERMISSIONS.BETS_PLACE));

        // Token verification
        const decoded = authService.verifyToken(loginRes.token);
        assert.equal(decoded.userId, user.id);
        assert.equal(decoded.tenantId, tenantId);
      }
    );
  });

  test('blocks login if user has self-excluded', async () => {
    const db = new InMemoryDatabase();
    const authService = new AuthService(() => db.getContext(), JWT_SECRET);

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'test-sports',
        domain: 'test.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const user = await authService.register({
          tenantId,
          email: 'player2@test.com',
          password: 'Password123!'
        });

        // Trigger self-exclusion
        await authService.selfExcludeUser(tenantId, user.id, 'Problem gambling cooling off');

        // Attempting to login must fail
        await assert.rejects(
          async () =>
            await authService.login({
              tenantId,
              identifier: 'player2@test.com',
              password: 'Password123!'
            }),
          /Access blocked: this account is currently under self-exclusion/
        );
      }
    );
  });

  test('RbacEvaluator checks permissions accurately', () => {
    const permissions = RbacEvaluator.getPermissionsForRoles(['TRADING_MANAGER']);
    assert.ok(RbacEvaluator.hasPermission(permissions, PERMISSIONS.MARKETS_SUSPEND));
    assert.ok(!RbacEvaluator.hasPermission(permissions, PERMISSIONS.WITHDRAWALS_APPROVE));
  });
});
