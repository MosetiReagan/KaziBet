import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantService } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { createApp } from './app.js';
import { Server } from 'node:http';

describe('KaziBet API Integration Suite', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'super-secret-integration-jwt-key-32!';

  before(async () => {
    const db = new InMemoryDatabase();
    const ctx = () => db.getContext();
    const tenantService = new TenantService(ctx);
    const authService = new AuthService(ctx, JWT_SECRET);
    const sportsService = new SportsService(ctx);
    const oddsEngine = new OddsEngine(ctx);
    const bettingService = new BetPlacementService(db, oddsEngine);

    // Seed test tenants
    await tenantService.provisionTenant({
      code: 'kazi-test',
      name: 'Kazi Test Sports',
      domain: 'kazi-test.local',
      defaultCurrency: 'KES'
    });

    await tenantService.provisionTenant({
      code: 'rival-bet',
      name: 'Rival Bet',
      domain: 'rival.local',
      defaultCurrency: 'KES'
    });

    const app = createApp({
      tenantService,
      authService,
      sportsService,
      oddsEngine,
      bettingService
    });
    server = app.server;

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('GET /health returns 200 ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string };
    assert.equal(body.status, 'ok');
  });

  test('POST /api/v1/auth/register creates user under tenant', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Code': 'kazi-test'
      },
      body: JSON.stringify({
        email: 'bettor1@example.com',
        password: 'StrongPassword123!'
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json() as { user: { email: string; status: string } };
    assert.equal(body.user.email, 'bettor1@example.com');
    assert.equal(body.user.status, 'ACTIVE');
  });

  test('POST /api/v1/auth/login and cross-tenant token rejection', async () => {
    // 1. Login under kazi-test
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Code': 'kazi-test'
      },
      body: JSON.stringify({
        identifier: 'bettor1@example.com',
        password: 'StrongPassword123!'
      })
    });

    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json() as { token: string };
    assert.ok(loginBody.token);

    // 2. Attempt to use this token against rival-bet -> 403 TENANT_MISMATCH
    const rivalRes = await fetch(`${baseUrl}/api/v1/auth/self-exclude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Code': 'rival-bet',
        'Authorization': `Bearer ${loginBody.token}`
      },
      body: JSON.stringify({ reason: 'testing cross-tenant' })
    });

    assert.equal(rivalRes.status, 403);
    const errBody = await rivalRes.json() as { error: { code: string } };
    assert.equal(errBody.error.code, 'TENANT_MISMATCH');
  });

  test('GET /api/v1/sports returns list of active sports', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sports`);
    assert.equal(res.status, 200);
    const body = await res.json() as { sports: { slug: string }[] };
    assert.ok(body.sports.length >= 5);
    const slugs = body.sports.map(s => s.slug);
    assert.ok(slugs.includes('football'));
    assert.ok(slugs.includes('basketball'));
  });

  test('Security headers: enforces Helmet-equivalent HTTP protection headers', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('strict-transport-security'));
    assert.ok(res.headers.get('content-security-policy'));
  });

  test('Rate limiting: 6th login attempt within 15 minutes returns 429 Too Many Requests', async () => {
    const testIp = '198.51.100.42';

    // First 5 attempts succeed or return 401
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Code': 'kazi-test',
          'X-Forwarded-For': testIp
        },
        body: JSON.stringify({
          identifier: 'bettor1@example.com',
          password: 'WrongPassword!'
        })
      });
      // Should not be 429 yet
      assert.notEqual(res.status, 429, `Attempt ${i + 1} unexpectedly rate limited`);
    }

    // 6th attempt must be 429 Too Many Requests
    const sixthRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Code': 'kazi-test',
        'X-Forwarded-For': testIp
      },
      body: JSON.stringify({
        identifier: 'bettor1@example.com',
        password: 'WrongPassword!'
      })
    });

    assert.equal(sixthRes.status, 429);
    assert.ok(sixthRes.headers.get('retry-after'));
    const body = await sixthRes.json() as { error: { code: string } };
    assert.equal(body.error.code, 'RATE_LIMIT_EXCEEDED');
  });

  test('CORS with Tenant Domain Validation: allows valid origin and rejects unauthorized origin outside sandbox', async () => {
    // 1. Sandbox origin check: local origin allowed
    const sandboxRes = await fetch(`${baseUrl}/health`, {
      headers: {
        'Origin': 'http://localhost:3000',
        'X-Tenant-Code': 'kazi-test'
      }
    });
    assert.equal(sandboxRes.status, 200);
    assert.equal(sandboxRes.headers.get('access-control-allow-origin'), 'http://localhost:3000');

    // 2. Production tenant unauthorized origin rejection -> 403 FORBIDDEN_ORIGIN
    // Seed a production tenant
    const app = createApp({
      tenantService: new TenantService(new InMemoryDatabase().getContext),
      authService: new AuthService(new InMemoryDatabase().getContext, JWT_SECRET)
    });
    // Create server with production tenant
    const db = new InMemoryDatabase();
    const ctx = db.getContext();
    await ctx.tenants.create({
      id: 'tenant-prod-1',
      code: 'prod-sports',
      name: 'Prod Sports',
      domain: 'prodsports.co.ke',
      defaultCurrency: 'KES',
      capabilityStatus: 'PRODUCTION_ACTIVE',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const prodApp = createApp({
      tenantService: new TenantService(() => ctx),
      authService: new AuthService(() => ctx, JWT_SECRET),
      db
    });

    await new Promise<void>((resolve) => prodApp.server.listen(0, resolve));
    const prodPort = (prodApp.server.address() as any).port;
    const prodUrl = `http://127.0.0.1:${prodPort}`;

    // Request from unauthorized foreign origin
    const forbiddenRes = await fetch(`${prodUrl}/health`, {
      headers: {
        'Origin': 'http://malicious-phishing-site.com',
        'X-Tenant-Code': 'prod-sports'
      }
    });

    assert.equal(forbiddenRes.status, 403);
    const errBody = await forbiddenRes.json() as { error: { code: string } };
    assert.equal(errBody.error.code, 'FORBIDDEN_ORIGIN');

    // Request from legitimate tenant origin
    const allowedRes = await fetch(`${prodUrl}/health`, {
      headers: {
        'Origin': 'https://prodsports.co.ke',
        'X-Tenant-Code': 'prod-sports'
      }
    });
    assert.equal(allowedRes.status, 200);
    assert.equal(allowedRes.headers.get('access-control-allow-origin'), 'https://prodsports.co.ke');

    prodApp.server.close();
  });
});
