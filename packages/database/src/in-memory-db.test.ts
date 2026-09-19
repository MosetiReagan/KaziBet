import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from './in-memory-db.js';
import { TenantIsolationError } from '@kazibet/shared';

describe('InMemoryDatabase with Tenant Isolation', () => {
  test('enforces strict tenant scoping and prevents cross-tenant read', async () => {
    const db = new InMemoryDatabase();
    const ctx = db.getContext();

    const tenantA = 'tenant-aaa-111';
    const tenantB = 'tenant-bbb-222';

    await ctx.users.create(tenantA, {
      id: 'user-1',
      tenantId: tenantA,
      email: 'alice@tenanta.com',
      passwordHash: 'hash1',
      status: 'ACTIVE',
      kycTier: 1,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Tenant A can read user-1
    const user = await ctx.users.findById(tenantA, 'user-1');
    assert.equal(user?.email, 'alice@tenanta.com');

    // Tenant B attempting to read user-1 throws TenantIsolationError
    await assert.rejects(
      async () => await ctx.users.findById(tenantB, 'user-1'),
      TenantIsolationError
    );

    // Tenant B querying many users sees empty list
    const tenantBUsers = await ctx.users.findMany(tenantB);
    assert.equal(tenantBUsers.length, 0);
  });

  test('rolls back all mutations on transaction failure', async () => {
    const db = new InMemoryDatabase();
    const tenantId = 'tenant-1';

    try {
      await db.transaction(async (tx) => {
        await tx.users.create(tenantId, {
          id: 'user-rollback',
          tenantId,
          email: 'bob@example.com',
          passwordHash: 'hash',
          status: 'ACTIVE',
          kycTier: 1,
          mfaEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Deliberately throw an error mid-transaction
        throw new Error('Simulated transaction failure');
      });
    } catch {
      // Expected exception
    }

    const ctx = db.getContext();
    const user = await ctx.users.findById(tenantId, 'user-rollback');
    assert.equal(user, null, 'User must not exist after transaction rollback');
  });
});
