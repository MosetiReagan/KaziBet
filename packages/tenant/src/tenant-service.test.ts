import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantService } from './tenant-service.js';
import { TenantContextHolder } from './tenant-context.js';
import { TenantIsolationError } from '@kazibet/shared';

describe('Tenant Service & Context Isolation', () => {
  test('provisions tenant in SANDBOX mode by default', async () => {
    const db = new InMemoryDatabase();
    const service = new TenantService(() => db.getContext());

    const tenant = await service.provisionTenant({
      code: 'alpha-bet',
      name: 'AlphaBet Sports',
      domain: 'alpha.example.com',
      defaultCurrency: 'KES'
    });

    assert.equal(tenant.code, 'alpha-bet');
    assert.equal(tenant.capabilityStatus, 'SANDBOX');
    assert.equal(tenant.defaultCurrency, 'KES');
  });

  test('blocks activation to PRODUCTION_ACTIVE if configuration is missing compliance items', async () => {
    const db = new InMemoryDatabase();
    const service = new TenantService(() => db.getContext());

    const tenant = await service.provisionTenant({
      code: 'demo-bet',
      name: 'Demo Bet',
      domain: 'demo.local', // Invalid domain for prod
      defaultCurrency: 'KES'
    });

    await assert.rejects(
      async () => await service.transitionCapability(tenant.id, 'PRODUCTION_ACTIVE', 'Ready for live launch'),
      /compliance check failed/
    );
  });

  test('assertTenant enforces execution matches context', () => {
    TenantContextHolder.run(
      {
        tenantId: 'tenant-123',
        code: 'tenant-123',
        domain: 'tenant.com',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      () => {
        assert.doesNotThrow(() => TenantContextHolder.assertTenant('tenant-123'));
        assert.throws(() => TenantContextHolder.assertTenant('tenant-999'), TenantIsolationError);
      }
    );
  });
});
