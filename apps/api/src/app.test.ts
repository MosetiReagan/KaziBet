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
});
