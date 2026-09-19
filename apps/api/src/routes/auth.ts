import { Router } from '../router.js';
import { AuthService } from '@kazibet/identity';
import { KaziBetError } from '@kazibet/shared';

export function registerAuthRoutes(router: Router, authService: AuthService): void {
  router.post('/api/v1/auth/register', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context is missing.');
    }

    const { email, phoneNumber, password, roles } = req.body as {
      email?: string;
      phoneNumber?: string;
      password?: string;
      roles?: string[];
    };

    if (!password) {
      throw new KaziBetError('VALIDATION_FAILED', 'Password is required.');
    }

    const user = await authService.register({
      tenantId: req.tenant.tenantId,
      email,
      phoneNumber,
      password,
      roles
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        phoneNumber: user.phoneNumber,
        status: user.status
      }
    }));
  });

  router.post('/api/v1/auth/login', async (req, res) => {
    if (!req.tenant) {
      throw new KaziBetError('TENANT_MISMATCH', 'Tenant context is missing.');
    }

    const { identifier, password, roles, totpCode, backupCode } = req.body as {
      identifier?: string;
      password?: string;
      roles?: string[];
      totpCode?: string;
      backupCode?: string;
    };

    if (!identifier || !password) {
      throw new KaziBetError('VALIDATION_FAILED', 'Identifier and password are required.');
    }

    const result = await authService.login({
      tenantId: req.tenant.tenantId,
      identifier,
      password,
      roles,
      totpCode,
      backupCode
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });

  router.post('/api/v1/auth/2fa/setup', async (req, res) => {
    if (!req.tenant || !req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const setupResult = await authService.setup2fa(
      req.tenant.tenantId,
      req.user.userId
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(setupResult));
  });

  router.post('/api/v1/auth/2fa/enable', async (req, res) => {
    if (!req.tenant || !req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const { token } = req.body as { token?: string };
    if (!token) {
      throw new KaziBetError('VALIDATION_FAILED', 'Verification token is required.');
    }

    const updatedUser = await authService.enable2fa(
      req.tenant.tenantId,
      req.user.userId,
      token
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Two-factor authentication successfully enabled.',
      mfaEnabled: updatedUser.mfaEnabled
    }));
  });

  router.post('/api/v1/auth/self-exclude', async (req, res) => {
    if (!req.tenant || !req.user) {
      throw new KaziBetError('UNAUTHORIZED', 'Authentication required.', 401);
    }

    const { reason = 'Voluntary cooling-off' } = req.body as { reason?: string };

    const updated = await authService.selfExcludeUser(
      req.tenant.tenantId,
      req.user.userId,
      reason
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Self-exclusion successfully activated. Account is suspended from wagering.',
      status: updated.status
    }));
  });
}
