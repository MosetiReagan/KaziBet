import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { KycService } from './kyc-service.js';
import { MockKycProvider } from './mock-kyc-provider.js';
import { ResponsibleGamingService } from './responsible-gaming-service.js';
import { ResponsibleGamingViolationError } from '@kazibet/shared';

describe('Compliance & Responsible Gaming Suite', () => {
  const tenantId = 'tenant-comp-test';

  async function setup() {
    const db = new InMemoryDatabase();
    const mockKyc = new MockKycProvider();
    const kycService = new KycService(db, mockKyc);
    const rgService = new ResponsibleGamingService(db);
    const ctx = db.getContext();

    await ctx.tenants.create({
      id: tenantId,
      code: 'comp-test',
      name: 'Compliance Test Book',
      domain: 'comp.local',
      defaultCurrency: 'KES',
      capabilityStatus: 'SANDBOX',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { db, ctx, kycService, rgService };
  }

  test('valid document submission upgrades user to KYC_VERIFIED tier 2', async () => {
    const { ctx, kycService } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'comp-test',
        domain: 'comp.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const user = await ctx.users.create(tenantId, {
          id: 'user-kyc-1',
          tenantId,
          email: 'bettor@test.com',
          passwordHash: 'hash',
          status: 'PENDING',
          kycTier: 1,
          mfaEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const res = await kycService.submitVerification({
          tenantId,
          userId: user.id,
          document: {
            documentType: 'NATIONAL_ID',
            documentNumber: '12345678',
            country: 'KE',
            fullName: 'David Mwangi',
            dateOfBirth: '1990-05-15'
          }
        });

        assert.equal(res.status, 'VERIFIED');
        assert.equal(res.tier, 2);
        assert.equal(res.user.status, 'KYC_VERIFIED');
      }
    );
  });

  test('sanctioned identity match automatically suspends account and creates critical risk case', async () => {
    const { ctx, kycService } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'comp-test',
        domain: 'comp.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const user = await ctx.users.create(tenantId, {
          id: 'user-sanction-1',
          tenantId,
          email: 'badactor@test.com',
          passwordHash: 'hash',
          status: 'ACTIVE',
          kycTier: 1,
          mfaEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        const res = await kycService.submitVerification({
          tenantId,
          userId: user.id,
          document: {
            documentType: 'PASSPORT',
            documentNumber: 'P9876543',
            country: 'KE',
            fullName: 'Blocked Sanctioned Entity',
            dateOfBirth: '1985-01-01'
          }
        });

        assert.equal(res.user.status, 'SUSPENDED');

        // Check critical risk case was generated
        const riskCases = await ctx.riskCases.findMany(tenantId, { userId: user.id });
        assert.equal(riskCases.length, 1);
        assert.equal(riskCases[0]?.severity, 'CRITICAL');
        assert.equal(riskCases[0]?.signalType, 'AML_SANCTIONS_MATCH');
      }
    );
  });

  test('responsible gaming blocks deposit exceeding daily limit', async () => {
    const { ctx, rgService } = await setup();

    await TenantContextHolder.run(
      {
        tenantId,
        code: 'comp-test',
        domain: 'comp.local',
        currency: 'KES',
        capabilityStatus: 'SANDBOX'
      },
      async () => {
        const userId = 'user-rg-1';
        await ctx.users.create(tenantId, {
          id: userId,
          tenantId,
          email: 'rg@test.com',
          passwordHash: 'hash',
          status: 'ACTIVE',
          kycTier: 1,
          mfaEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Past deposit: 400 KES (40,000 cents)
        await ctx.payments.create(tenantId, {
          id: 'pay-rg-1',
          tenantId,
          userId,
          provider: 'MOCK',
          type: 'DEPOSIT',
          amountCents: 40000n,
          currency: 'KES',
          status: 'SUCCESS',
          idempotencyKey: 'idem-rg-1',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Daily limit: 500 KES (50,000 cents)
        // New deposit attempt: 200 KES (20,000 cents) -> Total 600 KES > 500 KES limit -> REJECT!
        await assert.rejects(
          async () =>
            await rgService.validateDepositLimit(
              tenantId,
              userId,
              20000n,
              50000n // 500 KES limit
            ),
          ResponsibleGamingViolationError
        );
      }
    );
  });
});
