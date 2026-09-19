import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { KycService } from './kyc-service.js';
import { MockKycProvider } from './mock-kyc-provider.js';
import { ResponsibleGamingService } from './responsible-gaming-service.js';
import { ResponsibleGamingViolationError } from '@kazibet/shared';
import { IdValidator } from './id-validator.js';
import { NameMatcher } from './name-matcher.js';
import { SanctionsScreener } from './sanctions-screener.js';
import { SmileIdentityAdapter } from './smile-identity-adapter.js';

import { KycProvider } from './kyc-provider-interface.js';

describe('Compliance, KYC & Sanctions Screening Suite', () => {
  const tenantId = 'tenant-comp-test';

  async function setup(provider: KycProvider = new MockKycProvider()) {
    const db = new InMemoryDatabase();
    const kycService = new KycService(db, provider);
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
    const smileAdapter = new SmileIdentityAdapter();
    const { ctx, kycService } = await setup(smileAdapter);

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
            documentNumber: 'A1234567',
            country: 'KE',
            fullName: 'VIKTOR BOUT',
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

  test('Kenya ID format validation: verifies National ID, Alien ID, and Passport regex patterns', () => {
    // 1. National ID: 7 to 8 digits
    assert.equal(IdValidator.validate('NATIONAL_ID', '1234567').valid, true);
    assert.equal(IdValidator.validate('NATIONAL_ID', '12345678').valid, true);
    assert.equal(IdValidator.validate('NATIONAL_ID', '123456').valid, false); // 6 digits
    assert.equal(IdValidator.validate('NATIONAL_ID', '123456789').valid, false); // 9 digits
    assert.equal(IdValidator.validate('NATIONAL_ID', '1234567A').valid, false); // alphanumeric

    // 2. Alien ID: 9 digits
    assert.equal(IdValidator.validate('ALIEN_ID', '123456789').valid, true);
    assert.equal(IdValidator.validate('ALIEN_ID', '12345678').valid, false);

    // 3. Passport: 1 letter + 7 or 8 digits
    assert.equal(IdValidator.validate('PASSPORT', 'A1234567').valid, true);
    assert.equal(IdValidator.validate('PASSPORT', 'B12345678').valid, true);
    assert.equal(IdValidator.validate('PASSPORT', '12345678').valid, false);
    assert.equal(IdValidator.validate('PASSPORT', 'AB123456').valid, false);
  });

  test('Fuzzy name matching: Levenshtein distance and token similarity', () => {
    // Exact match
    assert.equal(NameMatcher.isMatch('JOHN DOE', 'JOHN DOE'), true);

    // Matching with middle initial: 'JOHN DOE' vs 'JOHN M. DOE' -> should be above 0.8
    const simWithInitial = NameMatcher.calculateSimilarity('JOHN DOE', 'JOHN M. DOE');
    assert.ok(simWithInitial >= 0.8, `Expected >= 0.8, got ${simWithInitial}`);
    assert.equal(NameMatcher.isMatch('JOHN DOE', 'JOHN M. DOE'), true);

    // Different names: 'JOHN DOE' vs 'JANE SMITH' -> should be well below 0.8
    const diffSim = NameMatcher.calculateSimilarity('JOHN DOE', 'JANE SMITH');
    assert.ok(diffSim < 0.8, `Expected < 0.8, got ${diffSim}`);
    assert.equal(NameMatcher.isMatch('JOHN DOE', 'JANE SMITH'), false);

    // Minor spelling variation: 'MOHAMMED KIPROTICH' vs 'MOHAMED KIPROTICH'
    assert.equal(NameMatcher.isMatch('MOHAMMED KIPROTICH', 'MOHAMED KIPROTICH'), true);
  });

  test('Sanctions screener: exact, phonetic Soundex, and PEP screening', () => {
    // 1. Exact match
    const res1 = SanctionsScreener.screen('OSAMA BIN LADEN');
    assert.equal(res1.isSanctioned, true);
    assert.equal(res1.riskScore, 1.0);

    // 2. Phonetic Soundex match: 'VICTOR BOUT' matches 'VIKTOR BOUT'
    const res2 = SanctionsScreener.screen('VICTOR BOUT');
    assert.equal(res2.isSanctioned, true);

    // 3. PEP detection
    const pepRes = SanctionsScreener.screen('CABINET SECRETARY');
    assert.equal(pepRes.isPep, true);
    assert.equal(pepRes.isSanctioned, false);

    // 4. Clean citizen
    const cleanRes = SanctionsScreener.screen('ELIUD KIPCHOGE');
    assert.equal(cleanRes.isSanctioned, false);
    assert.equal(cleanRes.isPep, false);
  });

  test('SmileIdentityAdapter: verifies Kenya ID format, M-Pesa name matching, and underage rejection', async () => {
    const adapter = new SmileIdentityAdapter();

    // 1. Valid Kenya ID + Matching M-Pesa Name -> VERIFIED
    const validRes = await adapter.verifyDocument(
      {
        documentType: 'NATIONAL_ID',
        documentNumber: '29876543',
        country: 'KE',
        fullName: 'KIPCHUMBA JAMES',
        dateOfBirth: '1995-03-12'
      },
      'KIPCHUMBA J. JAMES' // M-Pesa registered name
    );
    assert.equal(validRes.status, 'VERIFIED');
    assert.equal(validRes.tier, 2);

    // 2. Invalid ID format (only 5 digits) -> REJECTED
    const invalidIdRes = await adapter.verifyDocument({
      documentType: 'NATIONAL_ID',
      documentNumber: '12345',
      country: 'KE',
      fullName: 'Valid Name',
      dateOfBirth: '1995-03-12'
    });
    assert.equal(invalidIdRes.status, 'REJECTED');
    assert.ok(invalidIdRes.failureReasons?.[0]?.includes('strictly 7 or 8 digits'));

    // 3. Name mismatch (ID name doesn't match M-Pesa account name) -> REJECTED
    const mismatchRes = await adapter.verifyDocument(
      {
        documentType: 'NATIONAL_ID',
        documentNumber: '29876543',
        country: 'KE',
        fullName: 'KIPCHUMBA JAMES',
        dateOfBirth: '1995-03-12'
      },
      'WANJIKU MARY' // Mismatching M-Pesa account name
    );
    assert.equal(mismatchRes.status, 'REJECTED');
    assert.ok(mismatchRes.failureReasons?.[0]?.includes('Name mismatch'));

    // 4. Underage applicant (< 18) -> REJECTED
    const underageRes = await adapter.verifyDocument({
      documentType: 'NATIONAL_ID',
      documentNumber: '38876543',
      country: 'KE',
      fullName: 'YOUNG APPLICANT',
      dateOfBirth: '2015-01-01' // 11 years old
    });
    assert.equal(underageRes.status, 'REJECTED');
    assert.ok(underageRes.failureReasons?.[0]?.includes('under 18'));
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
