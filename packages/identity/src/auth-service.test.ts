import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { AuthService } from './auth-service.js';
import { RbacEvaluator, PERMISSIONS } from './rbac.js';
import { TotpService } from './totp.js';

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

  test('TotpService: token verification and single-use backup code consumption', () => {
    const { secret, backupCodes, hashedBackupCodes } = TotpService.generateSecret('operator@kazibet.com');

    // 1. Generate current OTP
    const currentStep = Math.floor(Date.now() / 1000 / 30);
    const validOtp = TotpService.generateOtpForStep(secret, currentStep);

    // Valid code accepted
    assert.equal(TotpService.verifyToken(secret, validOtp), true);

    // Invalid code rejected
    assert.equal(TotpService.verifyToken(secret, '000000'), false);

    // Far past / future code rejected
    const distantPastOtp = TotpService.generateOtpForStep(secret, currentStep - 10);
    assert.equal(TotpService.verifyToken(secret, distantPastOtp), false);

    // 2. Backup code consumption: works once and cannot be reused
    const testCode = backupCodes[0]!;
    assert.equal(backupCodes.length, 8);

    const consume1 = TotpService.verifyAndConsumeBackupCode(testCode, hashedBackupCodes);
    assert.equal(consume1.valid, true);
    assert.equal(consume1.remainingHashedCodes.length, 7);

    // Replay attempt with same backup code fails
    const consume2 = TotpService.verifyAndConsumeBackupCode(testCode, consume1.remainingHashedCodes);
    assert.equal(consume2.valid, false);
    assert.equal(consume2.remainingHashedCodes.length, 7);
  });

  test('AuthService 2FA TOTP enforcement for admin role and backup codes', async () => {
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
        // Register admin
        const admin = await authService.register({
          tenantId,
          email: 'admin@test.com',
          password: 'AdminPassword123!',
          roles: ['ADMIN']
        });

        // Setup 2FA
        const setup = await authService.setup2fa(tenantId, admin.id);
        assert.ok(setup.secret);
        assert.equal(setup.backupCodes.length, 8);

        // Generate valid token and enable 2FA
        const currentStep = Math.floor(Date.now() / 1000 / 30);
        const validToken = TotpService.generateOtpForStep(setup.secret, currentStep);
        await authService.enable2fa(tenantId, admin.id, validToken);

        // 1. Attempt login without 2FA -> Rejects with MFA_REQUIRED
        await assert.rejects(
          async () =>
            await authService.login({
              tenantId,
              identifier: 'admin@test.com',
              password: 'AdminPassword123!',
              roles: ['ADMIN']
            }),
          /Two-factor authentication code is required/
        );

        // 2. Login with invalid TOTP code -> 401
        await assert.rejects(
          async () =>
            await authService.login({
              tenantId,
              identifier: 'admin@test.com',
              password: 'AdminPassword123!',
              roles: ['ADMIN'],
              totpCode: '111111'
            }),
          /Invalid two-factor authentication code/
        );

        // 3. Login with valid TOTP code -> 200 OK
        const successLogin = await authService.login({
          tenantId,
          identifier: 'admin@test.com',
          password: 'AdminPassword123!',
          roles: ['ADMIN'],
          totpCode: validToken
        });
        assert.ok(successLogin.token);

        // 4. Login with single-use backup code
        const backupCode = setup.backupCodes[0]!;
        const backupLogin = await authService.login({
          tenantId,
          identifier: 'admin@test.com',
          password: 'AdminPassword123!',
          roles: ['ADMIN'],
          backupCode
        });
        assert.ok(backupLogin.token);

        // 5. Using the same backup code again is rejected!
        await assert.rejects(
          async () =>
            await authService.login({
              tenantId,
              identifier: 'admin@test.com',
              password: 'AdminPassword123!',
              roles: ['ADMIN'],
              backupCode
            }),
          /Invalid or previously consumed backup code/
        );
      }
    );
  });
});
